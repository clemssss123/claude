import { IDENTITY, multiply, rotation, scaling, translation } from './matrix';
import type { Matrix } from './matrix';
import { createProperty, valueAtTime } from './property';
import { positionAtTime } from './spatial';
import { uid } from './uid';
import type {
  AdjustmentLayer, AnyProperty, Composition, Id, Layer, LayerBase, NullLayer,
  Property, PropertyValue, RGBA, SolidLayer, TextLayer, TransformGroup, Vec2,
} from './types';

/** Deepest parent chain we will walk before assuming a cycle. */
const MAX_PARENT_DEPTH = 64;

export function createTransform(center: Vec2, anchor: Vec2): TransformGroup {
  return {
    anchorPoint: createProperty<Vec2>('Anchor Point', 'ADBE Anchor Point', 'vec2', anchor, {
      dimensionNames: ['X', 'Y'],
    }),
    position: Object.assign(
      createProperty<Vec2>('Position', 'ADBE Position', 'vec2', center, {
        dimensionNames: ['X', 'Y'],
      }),
      // Position is the one transform property with a motion path.
      { spatial: true },
    ),
    scale: createProperty<Vec2>('Scale', 'ADBE Scale', 'vec2', [100, 100], {
      unit: '%',
      dimensionNames: ['Width', 'Height'],
      speedPerPixel: 0.5,
    }),
    rotation: createProperty<number>('Rotation', 'ADBE Rotate Z', 'angle', 0, {
      unit: '°',
    }),
    opacity: createProperty<number>('Opacity', 'ADBE Opacity', 'percent', 100, {
      min: 0,
      max: 100,
      unit: '%',
      speedPerPixel: 0.5,
    }),
  };
}

interface LayerInit {
  name: string;
  width: number;
  height: number;
  comp: Composition;
  startTime?: number;
}

function baseLayer(init: LayerInit): Omit<LayerBase, 'type'> {
  const start = init.startTime ?? 0;
  return {
    id: uid('layer'),
    name: init.name,
    parentId: null,
    enabled: true,
    solo: false,
    shy: false,
    locked: false,
    motionBlur: false,
    blendMode: 'normal',
    label: 1 + Math.floor(Math.random() * 8),
    startTime: start,
    inPoint: start,
    outPoint: init.comp.duration,
    width: init.width,
    height: init.height,
    transform: createTransform(
      [init.comp.width / 2, init.comp.height / 2],
      [init.width / 2, init.height / 2],
    ),
  };
}

export function createSolidLayer(comp: Composition, name: string, color: RGBA): SolidLayer {
  return {
    ...baseLayer({ name, width: comp.width, height: comp.height, comp }),
    type: 'solid',
    color,
  };
}

export function createNullLayer(comp: Composition, name = 'Null 1'): NullLayer {
  const layer: NullLayer = {
    ...baseLayer({ name, width: 100, height: 100, comp }),
    type: 'null',
  };
  layer.transform.opacity.value = 0;
  return layer;
}

export function createAdjustmentLayer(comp: Composition, name = 'Adjustment Layer 1'): AdjustmentLayer {
  return {
    ...baseLayer({ name, width: comp.width, height: comp.height, comp }),
    type: 'adjustment',
  };
}

export function createTextLayer(comp: Composition, source: string): TextLayer {
  const layer: TextLayer = {
    ...baseLayer({ name: source || 'Text', width: comp.width, height: comp.height, comp }),
    type: 'text',
    text: {
      source,
      fontFamily: 'Inter, Helvetica, Arial, sans-serif',
      fontSize: 96,
      fontWeight: 600,
      fillColor: [1, 1, 1, 1],
      tracking: 0,
      leading: 1.2,
      justification: 'center',
    },
  };
  // Text is anchored at its own origin rather than a source rectangle.
  layer.transform.anchorPoint.value = [0, 0];
  return layer;
}

export function isLayerActiveAt(layer: Layer, time: number): boolean {
  return layer.enabled && time >= layer.inPoint && time < layer.outPoint;
}

/** Layer-local time: comp time shifted by the layer's start time. */
export function layerTime(layer: Layer, compTime: number): number {
  return compTime - layer.startTime;
}

/** Transform of a layer in its parent's space. */
export function localMatrix(layer: Layer, time: number): Matrix {
  const t = layer.transform;
  const anchor = valueAtTime(t.anchorPoint, time);
  const position = positionAtTime(t.position, time);
  const scale = valueAtTime(t.scale, time);
  const rotate = valueAtTime(t.rotation, time);

  let m = translation(position[0], position[1]);
  m = multiply(m, rotation(rotate));
  m = multiply(m, scaling(scale[0] / 100, scale[1] / 100));
  m = multiply(m, translation(-anchor[0], -anchor[1]));
  return m;
}

/**
 * Transform of a layer in composition space, including the parent chain.
 * Opacity and blend modes deliberately do not inherit — only the transform
 * does, which is how After Effects parenting behaves.
 */
export function worldMatrix(comp: Composition, layer: Layer, time: number): Matrix {
  const chain: Layer[] = [];
  let current: Layer | undefined = layer;
  const seen = new Set<Id>();
  while (current && chain.length < MAX_PARENT_DEPTH) {
    if (seen.has(current.id)) break; // defensive: a cycle would hang the render
    seen.add(current.id);
    chain.push(current);
    current = current.parentId
      ? comp.layers.find((l) => l.id === current!.parentId)
      : undefined;
  }

  let m: Matrix = { ...IDENTITY };
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    m = multiply(m, localMatrix(chain[i], time));
  }
  return m;
}

/**
 * The matrix a layer's own transform is expressed in: its parent's world
 * transform, or the identity when it has no parent. Position keyframes and
 * motion-path handles live in this space.
 */
export function parentMatrix(comp: Composition, layer: Layer, time: number): Matrix {
  if (!layer.parentId) return { ...IDENTITY };
  const parent = comp.layers.find((l) => l.id === layer.parentId);
  return parent ? worldMatrix(comp, parent, time) : { ...IDENTITY };
}

/** Would setting `parentId` on `layer` create a parenting cycle? */
export function wouldCreateCycle(comp: Composition, layerId: Id, parentId: Id | null): boolean {
  let current = parentId;
  let depth = 0;
  while (current && depth < MAX_PARENT_DEPTH) {
    if (current === layerId) return true;
    current = comp.layers.find((l) => l.id === current)?.parentId ?? null;
    depth += 1;
  }
  return false;
}

export interface Bounds { x: number; y: number; width: number; height: number }

/**
 * A layer's drawn extent in its own coordinates.
 *
 * Text is anchored at its baseline origin rather than at a source rectangle,
 * so its box is estimated from the glyph metrics. The estimate uses an average
 * advance width; phase 3 replaces it with real measurement once text layers
 * get their own layout pass.
 */
export function layerBounds(layer: Layer): Bounds {
  if (layer.type !== 'text') {
    return { x: 0, y: 0, width: layer.width, height: layer.height };
  }
  const { text } = layer;
  const lines = text.source.split('\n');
  const averageAdvance = text.fontSize * 0.55;
  const widths = lines.map((line) => {
    const count = [...line].length;
    return count * averageAdvance + text.tracking * Math.max(0, count - 1);
  });
  const width = Math.max(text.fontSize * 0.5, ...widths);
  const height = text.fontSize * text.leading * lines.length;
  const x = text.justification === 'center' ? -width / 2
    : text.justification === 'right' ? -width : 0;
  return { x, y: -text.fontSize * 0.8, width, height };
}

/** The four corners of the layer's drawn extent, in comp space. */
export function layerCorners(comp: Composition, layer: Layer, time: number): Vec2[] {
  const m = worldMatrix(comp, layer, time);
  const b = layerBounds(layer);
  const pts: Vec2[] = [
    [b.x, b.y],
    [b.x + b.width, b.y],
    [b.x + b.width, b.y + b.height],
    [b.x, b.y + b.height],
  ];
  return pts.map(([x, y]): Vec2 => [
    m.a * x + m.c * y + m.e,
    m.b * x + m.d * y + m.f,
  ]);
}

/** Property paths addressable from the UI, in timeline reveal order. */
export interface PropertyDescriptor {
  path: string;
  property: AnyProperty;
  /** Single-key After Effects reveal shortcut, if the property has one. */
  revealKey?: string;
}

export function transformProperties(layer: Layer): PropertyDescriptor[] {
  const t = layer.transform;
  return [
    ...expand('transform.anchorPoint', t.anchorPoint, 'a'),
    ...expand('transform.position', t.position, 'p'),
    ...expand('transform.scale', t.scale, 's'),
    ...expand('transform.rotation', t.rotation, 'r'),
    ...expand('transform.opacity', t.opacity, 't'),
  ];
}

/** A separated vector contributes its dimensions in place of itself. */
function expand(path: string, property: AnyProperty, revealKey: string): PropertyDescriptor[] {
  if (!property.separated || !property.dimensions) {
    return [{ path, property, revealKey }];
  }
  return property.dimensions.map((dim, axis) => ({
    path: `${path}.dimensions.${axis}`,
    property: dim as AnyProperty,
    revealKey,
  }));
}

/** Every animatable property on a layer. Grows as later phases add groups. */
export function allProperties(layer: Layer): PropertyDescriptor[] {
  return transformProperties(layer);
}

export function getProperty(layer: Layer, path: string): AnyProperty | undefined {
  let node: unknown = layer;
  for (const key of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  const prop = node as Property<PropertyValue> | undefined;
  return prop && typeof prop === 'object' && 'keyframes' in prop
    ? (prop as AnyProperty)
    : undefined;
}

/** Layers actually drawn, accounting for the solo switch. */
export function renderableLayers(comp: Composition): Layer[] {
  const soloed = comp.layers.filter((l) => l.solo);
  return soloed.length > 0 ? soloed : comp.layers;
}
