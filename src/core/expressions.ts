import { findLayer } from './composition';
import { allProperties, parentMatrix, worldMatrix } from './layer';
import { applyToPoint, invert } from './matrix';
import {
  rawValueAtTime, registerExpressionEvaluator, valueAtTime, velocityAtTime,
} from './property';
import type {
  Composition, Id, Layer, Project, Property, PropertyValue, Vec2,
} from './types';

/**
 * Expressions.
 *
 * An expression is JavaScript evaluated against a scope that mirrors After
 * Effects': bare `time`, `value`, `thisComp`, `thisLayer`, the interpolation
 * helpers, `wiggle`, `loopOut` and so on. The engine keeps three guarantees:
 *
 * - a property that refers to itself is caught rather than hanging,
 * - the same property at the same time is evaluated once per frame,
 * - a broken expression reports its error and falls back to the keyframed
 *   value, so one bad line never blanks the composition.
 *
 * A property reference evaluates to its value. Vectors come back as arrays
 * carrying `valueAtTime`, `velocityAtTime` and `numKeys`; scalars come back as
 * plain numbers, so for them use the bare `valueAtTime(t)` of the property the
 * expression is on.
 */

export interface ExpressionError {
  propertyId: Id;
  message: string;
}

interface Context {
  project: Project;
  comp: Composition;
}

let context: Context | null = null;
/** Compiled sources, keyed by the source text. */
const compiled = new Map<string, CompiledExpression>();
/** Per-frame results, cleared whenever the frame or the document changes. */
let resultCache = new Map<string, PropertyValue>();
/** Owning layer per property, rebuilt whenever the context changes. */
let ownerCache: Map<Property<PropertyValue>, Layer> | null = null;
const evaluating = new Set<Id>();
const errors = new Map<Id, string>();

type CompiledExpression = (scope: Record<string, unknown>) => unknown;

export function setExpressionContext(project: Project, comp: Composition): void {
  context = { project, comp };
  resultCache = new Map();
  ownerCache = null;
}

/** Call once per rendered frame so cached results do not leak across time. */
export function beginExpressionFrame(): void {
  resultCache = new Map();
}

export function expressionErrors(): ExpressionError[] {
  return [...errors.entries()].map(([propertyId, message]) => ({ propertyId, message }));
}

export function expressionErrorFor(propertyId: Id): string | undefined {
  return errors.get(propertyId);
}

// -- compilation -----------------------------------------------------------

/**
 * After Effects treats the last expression in the source as the result, so a
 * bare `value + 10` and a multi-line script both work. Compilation tries the
 * expression form first and falls back to a statement block.
 */
function compile(source: string): CompiledExpression | null {
  const cached = compiled.get(source);
  if (cached) return cached;

  // Order matters: a statement block compiles even when it returns nothing,
  // so the form that yields a value has to be tried first.
  const attempts = [
    `with($scope){ return (${source}\n); }`,
    `with($scope){ ${asReturnedBlock(source)}\n }`,
    `with($scope){ ${source}\n }`,
  ];

  for (const body of attempts) {
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function('$scope', body) as CompiledExpression;
      compiled.set(source, fn);
      return fn;
    } catch {
      // Try the next shape.
    }
  }
  return null;
}

/** Prefix the last statement with `return` so a script yields a value. */
function asReturnedBlock(source: string): string {
  const lines = source.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (line === '' || line.startsWith('//')) continue;
    if (/^(return|if|for|while|function|var|let|const|\}|\{)/.test(line)) break;
    lines[i] = lines[i].replace(/^(\s*)/, '$1return ');
    return lines.join('\n');
  }
  return source;
}

// -- evaluation ------------------------------------------------------------

function ownerOf(prop: Property<PropertyValue>): Layer | undefined {
  if (!context) return undefined;
  if (!ownerCache) {
    ownerCache = new Map();
    for (const layer of context.comp.layers) {
      for (const descriptor of allProperties(layer)) {
        ownerCache.set(descriptor.property as Property<PropertyValue>, layer);
      }
    }
  }
  return ownerCache.get(prop);
}

function evaluate(prop: Property<PropertyValue>, time: number): PropertyValue | undefined {
  if (!context || !prop.expression) return undefined;

  const key = `${prop.id}@${time}`;
  const cached = resultCache.get(key);
  if (cached !== undefined) return cached;

  // A property that reads itself would recurse forever; fall back instead.
  if (evaluating.has(prop.id)) return undefined;

  const fn = compile(prop.expression);
  if (!fn) {
    errors.set(prop.id, 'Could not parse this expression.');
    return undefined;
  }

  const layer = ownerOf(prop);
  evaluating.add(prop.id);
  try {
    const scope = buildScope(prop, layer, time, context);
    const result = fn(scope);
    const coerced = coerce(result, rawValueAtTime(prop, time));
    if (coerced === undefined) {
      errors.set(prop.id, 'Expression returned a value of the wrong shape.');
      return undefined;
    }
    errors.delete(prop.id);
    resultCache.set(key, coerced);
    return coerced;
  } catch (error) {
    errors.set(prop.id, error instanceof Error ? error.message : String(error));
    return undefined;
  } finally {
    evaluating.delete(prop.id);
  }
}

/** Fit whatever the expression returned to the property's own shape. */
function coerce(result: unknown, current: PropertyValue): PropertyValue | undefined {
  if (typeof current === 'number') {
    const value = typeof result === 'number' ? result : Number(result);
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(current)) {
    if (typeof result === 'number') return current.map(() => result) as PropertyValue;
    if (!Array.isArray(result)) return undefined;
    const out = current.map((fallback, i) => {
      const value = Number(result[i]);
      return Number.isFinite(value) ? value : fallback;
    });
    return out as PropertyValue;
  }
  // Paths and anything else pass through only if the shape already matches.
  return typeof result === 'object' && result !== null ? (result as PropertyValue) : undefined;
}

registerExpressionEvaluator(evaluate);

// -- scope -----------------------------------------------------------------

function buildScope(
  prop: Property<PropertyValue>,
  layer: Layer | undefined,
  time: number,
  ctx: Context,
): Record<string, unknown> {
  const seed = hashString(prop.id);
  let randomState = seed ^ Math.round(time * 1000);
  let timeless = false;

  const nextRandom = () => {
    randomState = (randomState * 1664525 + 1013904223) >>> 0;
    return randomState / 4294967296;
  };

  const scope: Record<string, unknown> = {
    time,
    value: rawValueAtTime(prop, time),
    thisProperty: propertyHandle(prop, time),
    thisComp: compHandle(ctx.comp, time),
    thisLayer: layer ? layerHandle(ctx.comp, layer, time) : undefined,
    index: layer ? ctx.comp.layers.indexOf(layer) + 1 : 1,
    comp: (name: string) => {
      const found = ctx.project.compositions.find((c) => c.name === name);
      return found ? compHandle(found, time) : undefined;
    },

    // -- interpolation helpers
    linear: interpolator((t) => t),
    ease: interpolator(smoothEase),
    easeIn: interpolator((t) => t * t),
    easeOut: interpolator((t) => 1 - (1 - t) * (1 - t)),
    clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
    degreesToRadians: (d: number) => (d * Math.PI) / 180,
    radiansToDegrees: (r: number) => (r * 180) / Math.PI,
    length: (a: number | number[], b?: number | number[]) => vectorLength(a, b),
    add: (a: number[] | number, b: number[] | number) => componentWise(a, b, (x, y) => x + y),
    sub: (a: number[] | number, b: number[] | number) => componentWise(a, b, (x, y) => x - y),
    mul: (a: number[] | number, k: number) => componentWise(a, k, (x, y) => x * y),
    div: (a: number[] | number, k: number) => componentWise(a, k, (x, y) => x / y),

    // -- randomness
    seedRandom: (value: number, isTimeless = false) => {
      timeless = isTimeless;
      randomState = (hashString(prop.id) ^ Math.round(value * 7919)) >>> 0;
      if (!timeless) randomState = (randomState ^ Math.round(time * 1000)) >>> 0;
    },
    random: (a?: number | number[], b?: number | number[]) => randomRange(nextRandom, a, b),
    gaussRandom: (a?: number, b?: number) => {
      const u = Math.max(1e-9, nextRandom());
      const v = nextRandom();
      const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * 0.25 + 0.5;
      return randomRange(() => Math.min(1, Math.max(0, g)), a, b);
    },
    noise: (x: number | number[]) => {
      const point = Array.isArray(x) ? x : [x, 0];
      return valueNoise(point[0], point[1] ?? 0, seed) * 2 - 1;
    },
    wiggle: (
      frequency = 5, amplitude = 20, octaves = 1, amplitudeMultiplier = 0.5, at = time,
    ) => wiggle(rawValueAtTime(prop, at), seed, frequency, amplitude, octaves, amplitudeMultiplier, at),

    // -- time sampling of this property
    valueAtTime: (t: number) => rawValueAtTime(prop, t),
    velocityAtTime: (t: number) => velocityAtTime(prop, t),
    speedAtTime: (t: number) => Math.abs(velocityAtTime(prop, t)),
    numKeys: prop.keyframes.length,
    loopOut: (type = 'cycle', numKeyframes = 0) => loop(prop, time, type, numKeyframes, 'out'),
    loopIn: (type = 'cycle', numKeyframes = 0) => loop(prop, time, type, numKeyframes, 'in'),

    // -- spaces
    toComp: (point: Vec2) => (layer ? applyToPoint(worldMatrix(ctx.comp, layer, time), point) : point),
    fromComp: (point: Vec2) => (
      layer ? applyToPoint(invert(worldMatrix(ctx.comp, layer, time)), point) : point
    ),
    toWorld: (point: Vec2) => (layer ? applyToPoint(worldMatrix(ctx.comp, layer, time), point) : point),
    fromWorld: (point: Vec2) => (
      layer ? applyToPoint(invert(worldMatrix(ctx.comp, layer, time)), point) : point
    ),

    Math,
    // Shadow the obvious ways out of the sandbox. This is a guard against
    // accidents, not a security boundary — expressions are the user's own code.
    window: undefined,
    document: undefined,
    globalThis: undefined,
    fetch: undefined,
    XMLHttpRequest: undefined,
    localStorage: undefined,
    eval: undefined,
    Function: undefined,
    importScripts: undefined,
  };

  if (layer) {
    // A layer's own properties are addressable without a prefix, as in AE.
    Object.assign(scope, transformScope(ctx.comp, layer, time));
  }
  return scope;
}

function interpolator(shape: (t: number) => number) {
  return (
    t: number, a: number | number[], b: number | number[],
    c?: number | number[], d?: number | number[],
  ) => {
    // Three-argument form maps 0..1; five-argument form maps tMin..tMax.
    const [tMin, tMax, from, to] = c === undefined
      ? [0, 1, a, b]
      : [a as number, b as number, c, d as number | number[]];
    const span = (tMax as number) - (tMin as number);
    const raw = span === 0 ? 0 : (t - (tMin as number)) / span;
    const k = shape(Math.min(1, Math.max(0, raw)));
    return componentWise(from as number | number[], to as number | number[], (x, y) => x + (y - x) * k);
  };
}

function smoothEase(t: number): number {
  return t * t * (3 - 2 * t);
}

function componentWise(
  a: number | number[],
  b: number | number[],
  fn: (x: number, y: number) => number,
): number | number[] {
  if (Array.isArray(a)) {
    return a.map((x, i) => fn(x, Array.isArray(b) ? (b[i] ?? 0) : b));
  }
  if (Array.isArray(b)) return b.map((y) => fn(a, y));
  return fn(a, b);
}

function vectorLength(a: number | number[], b?: number | number[]): number {
  if (b === undefined) {
    return Array.isArray(a) ? Math.hypot(...a) : Math.abs(a);
  }
  const difference = componentWise(a, b, (x, y) => x - y);
  return Array.isArray(difference) ? Math.hypot(...difference) : Math.abs(difference);
}

function randomRange(
  next: () => number,
  a?: number | number[],
  b?: number | number[],
): number | number[] {
  if (a === undefined) return next();
  if (b === undefined) {
    if (Array.isArray(a)) return a.map((max) => next() * max);
    return next() * a;
  }
  return componentWise(a, b, (min, max) => min + next() * (max - min));
}

// -- handles ---------------------------------------------------------------

function propertyHandle(prop: Property<PropertyValue>, time: number) {
  return {
    value: rawValueAtTime(prop, time),
    numKeys: prop.keyframes.length,
    valueAtTime: (t: number) => rawValueAtTime(prop, t),
    velocityAtTime: (t: number) => velocityAtTime(prop, t),
    key: (n: number) => {
      const kf = prop.keyframes[Math.max(0, Math.round(n) - 1)];
      return kf ? { time: kf.time, value: kf.value, index: Math.round(n) } : undefined;
    },
    name: prop.name,
  };
}

/** Property references evaluate to their value; vectors keep their methods. */
function referenced(prop: Property<PropertyValue>, time: number): unknown {
  const value = valueAtTime(prop, time);
  if (!Array.isArray(value)) return value;
  const array = [...value] as number[] & Record<string, unknown>;
  Object.defineProperties(array, {
    valueAtTime: { value: (t: number) => valueAtTime(prop, t), enumerable: false },
    velocityAtTime: { value: (t: number) => velocityAtTime(prop, t), enumerable: false },
    numKeys: { value: prop.keyframes.length, enumerable: false },
  });
  return array;
}

function transformScope(comp: Composition, layer: Layer, time: number): Record<string, unknown> {
  const transform = {
    anchorPoint: referenced(layer.transform.anchorPoint, time),
    position: referenced(layer.transform.position, time),
    scale: referenced(layer.transform.scale, time),
    rotation: referenced(layer.transform.rotation, time),
    opacity: referenced(layer.transform.opacity, time),
  };
  return {
    transform,
    ...transform,
    effect: effectAccessor(layer, time),
    marker: { numKeys: comp.markers.length },
  };
}

function effectAccessor(layer: Layer, time: number) {
  return (nameOrIndex: string | number) => {
    const effect = typeof nameOrIndex === 'number'
      ? layer.effects[Math.round(nameOrIndex) - 1]
      : layer.effects.find((e) => e.name === nameOrIndex);
    if (!effect) return undefined;

    // AE style: effect("Name")("Parameter"), and parameters by key as well.
    const accessor = (param: string | number) => {
      const key = typeof param === 'number'
        ? Object.keys(effect.params)[Math.round(param) - 1]
        : Object.keys(effect.params).find(
          (k) => k === param || effect.params[k].name === param,
        );
      const property = key ? effect.params[key] : undefined;
      return property ? referenced(property, time) : undefined;
    };
    for (const [key, property] of Object.entries(effect.params)) {
      (accessor as unknown as Record<string, unknown>)[key] = referenced(property, time);
    }
    return accessor;
  };
}

function layerHandle(comp: Composition, layer: Layer, time: number): Record<string, unknown> {
  return {
    name: layer.name,
    index: comp.layers.indexOf(layer) + 1,
    width: layer.width,
    height: layer.height,
    inPoint: layer.inPoint,
    outPoint: layer.outPoint,
    startTime: layer.startTime,
    hasParent: layer.parentId !== null,
    parent: layer.parentId
      ? (() => {
        const parent = findLayer(comp, layer.parentId as Id);
        return parent ? layerHandle(comp, parent, time) : undefined;
      })()
      : undefined,
    toComp: (point: Vec2) => applyToPoint(worldMatrix(comp, layer, time), point),
    fromComp: (point: Vec2) => applyToPoint(invert(worldMatrix(comp, layer, time)), point),
    toWorld: (point: Vec2) => applyToPoint(worldMatrix(comp, layer, time), point),
    fromComp2: undefined,
    parentMatrix: () => parentMatrix(comp, layer, time),
    ...transformScope(comp, layer, time),
  };
}

function compHandle(comp: Composition, time: number): Record<string, unknown> {
  return {
    name: comp.name,
    width: comp.width,
    height: comp.height,
    duration: comp.duration,
    frameDuration: 1 / comp.frameRate,
    numLayers: comp.layers.length,
    layer: (nameOrIndex: string | number) => {
      const found = typeof nameOrIndex === 'number'
        ? comp.layers[Math.round(nameOrIndex) - 1]
        : comp.layers.find((l) => l.name === nameOrIndex);
      return found ? layerHandle(comp, found, time) : undefined;
    },
    marker: { numKeys: comp.markers.length },
  };
}

// -- looping ---------------------------------------------------------------

function loop(
  prop: Property<PropertyValue>,
  time: number,
  type: string,
  numKeyframes: number,
  side: 'in' | 'out',
): PropertyValue {
  const keys = prop.keyframes;
  if (keys.length < 2) return rawValueAtTime(prop, time);

  const first = keys[0].time;
  const last = keys[keys.length - 1].time;
  const edge = side === 'out' ? last : first;
  if (side === 'out' ? time <= last : time >= first) return rawValueAtTime(prop, time);

  // numKeyframes limits the loop to the last (or first) N segments.
  const span = numKeyframes > 0
    ? Math.abs(
      (side === 'out'
        ? last - keys[Math.max(0, keys.length - 1 - numKeyframes)].time
        : keys[Math.min(keys.length - 1, numKeyframes)].time - first),
    )
    : last - first;
  if (span <= 0) return rawValueAtTime(prop, edge);

  const delta = side === 'out' ? time - edge : edge - time;
  const cycles = Math.floor(delta / span);
  const phase = delta - cycles * span;

  if (type === 'continue') {
    const velocity = velocityAtTime(prop, edge);
    const base = rawValueAtTime(prop, edge);
    const drift = velocity * (side === 'out' ? time - edge : time - edge);
    return componentWise(base as number | number[], drift, (x, y) => x + y) as PropertyValue;
  }

  const loopStart = side === 'out' ? last - span : first;
  let sample: number;
  if (type === 'pingpong' && cycles % 2 === 0) {
    sample = side === 'out' ? edge - phase : edge + phase;
  } else {
    sample = side === 'out' ? loopStart + phase : first + span - phase;
  }

  const value = rawValueAtTime(prop, sample);
  if (type !== 'offset') return value;

  // Offset stacks the whole cycle's change on each repeat.
  const cycleDelta = componentWise(
    rawValueAtTime(prop, side === 'out' ? last : first) as number | number[],
    rawValueAtTime(prop, side === 'out' ? last - span : first + span) as number | number[],
    (x, y) => x - y,
  );
  const total = componentWise(cycleDelta, cycles + 1, (x, y) => x * y);
  return componentWise(value as number | number[], total, (x, y) => x + y) as PropertyValue;
}

// -- noise -----------------------------------------------------------------

function hashString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hash2(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 0.0001) * 43758.5453;
  return n - Math.floor(n);
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return top + (bottom - top) * sy;
}

/**
 * Smooth random motion around the property's own value, layered in octaves
 * the way After Effects' wiggle is.
 */
function wiggle(
  base: PropertyValue,
  seed: number,
  frequency: number,
  amplitude: number,
  octaves: number,
  amplitudeMultiplier: number,
  time: number,
): PropertyValue {
  if (typeof base !== 'number' && !Array.isArray(base)) return base;
  const dimensions = Array.isArray(base) ? base.length : 1;
  const offsets: number[] = [];
  for (let d = 0; d < dimensions; d += 1) {
    let sum = 0;
    let amp = amplitude;
    let freq = frequency;
    for (let o = 0; o < Math.max(1, Math.round(octaves)); o += 1) {
      sum += (valueNoise(time * freq, d * 13.7 + o * 5.1, seed) * 2 - 1) * amp;
      amp *= amplitudeMultiplier;
      freq *= 2;
    }
    offsets.push(sum);
  }
  if (!Array.isArray(base)) return base + offsets[0];
  return base.map((v, i) => v + offsets[i]) as PropertyValue;
}
