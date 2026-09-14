import { defaultEase, evaluateKeyframes, upperBound } from './interpolation';
import { uid } from './uid';
import type {
  AnyProperty, Keyframe, Property, PropertyKind, PropertyValue, RGBA, Vec2,
} from './types';

/** Two keyframes closer than this are considered to be at the same time. */
export const TIME_EPSILON = 1e-6;

interface PropertyOptions {
  min?: number;
  max?: number;
  unit?: string;
  dimensionNames?: string[];
  speedPerPixel?: number;
}

export function createProperty<T extends PropertyValue>(
  name: string,
  matchName: string,
  kind: PropertyKind,
  value: T,
  options: PropertyOptions = {},
): Property<T> {
  return {
    id: uid('prop'),
    name,
    matchName,
    kind,
    value,
    keyframes: [],
    animated: false,
    expression: null,
    ...options,
  };
}

export function clampToRange(prop: Property, value: PropertyValue): PropertyValue {
  if (prop.min === undefined && prop.max === undefined) return value;
  const lo = prop.min ?? -Infinity;
  const hi = prop.max ?? Infinity;
  if (typeof value === 'number') return Math.min(hi, Math.max(lo, value));
  return (value as number[]).map((v) => Math.min(hi, Math.max(lo, v))) as PropertyValue;
}

/** The property's value at a comp time, honouring the stopwatch. */
export function valueAtTime<T extends PropertyValue>(prop: Property<T>, time: number): T;
export function valueAtTime(prop: AnyProperty, time: number): PropertyValue;
export function valueAtTime(prop: Property<PropertyValue>, time: number): PropertyValue {
  if (!prop.animated || prop.keyframes.length === 0) return prop.value;
  return evaluateKeyframes(prop.keyframes, time) ?? prop.value;
}

/**
 * Instantaneous rate of change in value units per second, measured with a
 * central difference. Drives the speed graph and the Info panel.
 */
export function velocityAtTime(prop: Property, time: number, h = 1 / 240): number {
  const before = valueAtTime(prop, time - h);
  const after = valueAtTime(prop, time + h);
  if (typeof before === 'number' && typeof after === 'number') {
    return (after - before) / (2 * h);
  }
  const a = before as number[];
  const b = after as number[];
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += (b[i] - a[i]) ** 2;
  return Math.sqrt(sum) / (2 * h);
}

export function findKeyframeAt<T extends PropertyValue>(
  prop: Property<T>, time: number, epsilon?: number,
): Keyframe<T> | undefined;
export function findKeyframeAt(
  prop: AnyProperty, time: number, epsilon?: number,
): Keyframe<PropertyValue> | undefined;
export function findKeyframeAt(
  prop: Property<PropertyValue>,
  time: number,
  epsilon = TIME_EPSILON,
): Keyframe<PropertyValue> | undefined {
  return prop.keyframes.find((kf) => Math.abs(kf.time - time) <= epsilon);
}

function sortKeyframes(prop: Property): void {
  prop.keyframes.sort((a, b) => a.time - b.time);
}

/**
 * Add (or overwrite) a keyframe. With no explicit value the property's
 * current animated value at that time is captured, so adding a keyframe never
 * changes what you see — the After Effects behaviour.
 */
export function addKeyframe<T extends PropertyValue>(
  prop: Property<T>, time: number, value?: T,
): Keyframe<T>;
export function addKeyframe(
  prop: AnyProperty, time: number, value?: PropertyValue,
): Keyframe<PropertyValue>;
export function addKeyframe(
  prop: Property<PropertyValue>,
  time: number,
  value?: PropertyValue,
): Keyframe<PropertyValue> {
  const resolved = value ?? valueAtTime(prop, time);
  const existing = findKeyframeAt(prop, time);
  if (existing) {
    existing.value = resolved;
    return existing;
  }
  const kf: Keyframe<PropertyValue> = {
    id: uid('kf'),
    time,
    value: resolved,
    inType: 'linear',
    outType: 'linear',
    easeIn: defaultEase(),
    easeOut: defaultEase(),
  };
  prop.keyframes.splice(upperBound(prop.keyframes, time), 0, kf);
  return kf;
}

export function removeKeyframe(prop: Property, kfId: string): void {
  const index = prop.keyframes.findIndex((kf) => kf.id === kfId);
  if (index >= 0) prop.keyframes.splice(index, 1);
}

export function moveKeyframe(prop: Property, kfId: string, time: number): void {
  const kf = prop.keyframes.find((k) => k.id === kfId);
  if (!kf) return;
  // Moving onto another keyframe replaces it, matching timeline drag behaviour.
  const collision = prop.keyframes.find(
    (k) => k.id !== kfId && Math.abs(k.time - time) <= TIME_EPSILON,
  );
  if (collision) removeKeyframe(prop, collision.id);
  kf.time = time;
  sortKeyframes(prop);
}

/**
 * Set the property's value at a time. While animating this creates or updates
 * a keyframe; otherwise it edits the static value.
 */
export function setValueAtTime<T extends PropertyValue>(
  prop: Property<T>, time: number, value: T,
): void;
export function setValueAtTime(
  prop: AnyProperty, time: number, value: PropertyValue,
): void;
export function setValueAtTime(
  prop: Property<PropertyValue>,
  time: number,
  value: PropertyValue,
): void {
  const clamped = clampToRange(prop, value);
  if (prop.animated) {
    addKeyframe(prop, time, clamped);
    prop.value = clamped;
  } else {
    prop.value = clamped;
  }
}

/**
 * Toggle the stopwatch. Turning it on captures the current value as the first
 * keyframe; turning it off discards the track and freezes the value at `time`.
 */
export function setAnimated(prop: Property, time: number, animated: boolean): void {
  if (prop.animated === animated) return;
  if (animated) {
    prop.animated = true;
    if (prop.keyframes.length === 0) addKeyframe(prop, time, prop.value);
  } else {
    prop.value = valueAtTime(prop, time);
    prop.keyframes = [];
    prop.animated = false;
  }
}

export function nextKeyframeTime(prop: Property, time: number): number | null {
  if (!prop.animated) return null;
  const kf = prop.keyframes.find((k) => k.time > time + TIME_EPSILON);
  return kf ? kf.time : null;
}

export function prevKeyframeTime(prop: Property, time: number): number | null {
  if (!prop.animated) return null;
  for (let i = prop.keyframes.length - 1; i >= 0; i -= 1) {
    if (prop.keyframes[i].time < time - TIME_EPSILON) return prop.keyframes[i].time;
  }
  return null;
}

export function isVec2Property(prop: Property): prop is Property<Vec2> {
  return prop.kind === 'vec2';
}

export function isColorProperty(prop: Property): prop is Property<RGBA> {
  return prop.kind === 'color';
}

/** Human-readable value for the timeline and Info panel. */
export function formatValue(prop: Property, value: PropertyValue): string {
  const unit = prop.unit ?? '';
  if (typeof value === 'number') {
    return `${round(value)}${unit}`;
  }
  if (prop.kind === 'color') {
    const [r, g, b] = value as RGBA;
    return rgbToHex(r, g, b);
  }
  return (value as number[]).map((v) => `${round(v)}${unit}`).join(', ');
}

function round(v: number): string {
  return (Math.round(v * 100) / 100).toString();
}

export function rgbToHex(r: number, g: number, b: number): string {
  const to255 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `#${[to255(r), to255(g), to255(b)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

export function hexToRgba(hex: string, alpha = 1): RGBA {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  return [
    ((num >> 16) & 255) / 255,
    ((num >> 8) & 255) / 255,
    (num & 255) / 255,
    alpha,
  ];
}

export function rgbaToCss(color: RGBA): string {
  const to255 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgba(${to255(color[0])}, ${to255(color[1])}, ${to255(color[2])}, ${color[3]})`;
}
