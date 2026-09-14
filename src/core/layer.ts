import { IDENTITY, multiply, rotation, scaling, translation } from './matrix';
import type { Matrix } from './matrix';
import { ellipsePath, rectPath } from './path';
import type { BezierPath } from './path';
import { createProperty, valueAtTime } from './property';
import { createFill, createRectShape, createShapeGroup, createStroke } from './shapes';
import { positionAtTime } from './spatial';
import { layoutTextLayer } from './text';
import { uid } from './uid';
import type {
  AdjustmentLayer, AnyProperty, Composition, Id, Layer, LayerBase, Mask, NullLayer,
  Property, PropertyValue, RGBA, ShapeItem, ShapeLayer, ShapeTransform, SolidLayer,
  TextLayer, TransformGroup, Vec2,
} from './types';
import { MASK_COLORS } from './types';

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
    masks: [],
    effects: [],
    trackMatte: 'none',
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
    animators: [],
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

export function createShapeLayer(comp: Composition, name = 'Shape Layer 1'): ShapeLayer {
  const layer: ShapeLayer = {
    ...baseLayer({ name, width: comp.width, height: comp.height, comp }),
    type: 'shape',
    contents: [],
  };
  // Shape contents are drawn around the layer's own origin.
  layer.transform.anchorPoint.value = [0, 0];
  return layer;
}

export function createShapeLayerWithRect(
  comp: Composition,
  size: Vec2,
  color: RGBA,
): ShapeLayer {
  const layer = createShapeLayer(comp);
  layer.contents = [createShapeGroup([createRectShape(size), createFill(color)])];
  return layer;
}

export function createShapeLayerWithStroke(
  comp: Composition,
  size: Vec2,
  color: RGBA,
): ShapeLayer {
  const layer = createShapeLayer(comp);
  layer.contents = [createShapeGroup([createRectShape(size), createStroke(color)])];
  return layer;
}

/** A new mask on a layer, named and coloured like the next one in AE. */
export function createMask(layer: Layer, path: BezierPath, name?: string): Mask {
  const index = layer.masks.length + 1;
  return {
    id: uid('mask'),
    name: name ?? `Mask ${index}`,
    mode: 'add',
    inverted: false,
    locked: false,
    color: MASK_COLORS[(index - 1) % MASK_COLORS.length],
    path: createProperty<BezierPath>('Mask Path', 'ADBE Mask Shape', 'path', path),
    feather: createProperty<Vec2>('Mask Feather', 'ADBE Mask Feather', 'vec2', [0, 0], {
      dimensionNames: ['Horizontal', 'Vertical'], min: 0, unit: ' px',
    }),
    opacity: createProperty<number>('Mask Opacity', 'ADBE Mask Opacity', 'percent', 100, {
      min: 0, max: 100, unit: '%', speedPerPixel: 0.5,
    }),
    expansion: createProperty<number>('Mask Expansion', 'ADBE Mask Offset', 'number', 0, {
      unit: ' px',
    }),
  };
}

/** A rectangular mask covering the whole layer, the AE double-click default. */
export function fullFrameMaskPath(layer: Layer): BezierPath {
  const b = layerBounds(layer);
  return rectPath(
    [b.x + b.width / 2, b.y + b.height / 2],
    [b.width, b.height],
  );
}

export function ellipseMaskPath(layer: Layer): BezierPath {
  const b = layerBounds(layer);
  return ellipsePath([b.x + b.width / 2, b.y + b.height / 2], [b.width, b.height]);
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
 * so its box comes from laying the glyphs out and measuring them.
 */
export function layerBounds(layer: Layer): Bounds {
  if (layer.type !== 'text') {
    return { x: 0, y: 0, width: layer.width, height: layer.height };
  }
  const { text } = layer;
  const layout = layoutTextLayer(layer, 0);
  const width = Math.max(text.fontSize * 0.5, layout.width);
  const x = text.justification === 'center' ? -width / 2
    : text.justification === 'right' ? -width : 0;
  return { x, y: -text.fontSize * 0.8, width, height: layout.height };
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

/**
 * A row in the timeline's property outline: either a twirl-down group or an
 * animatable property. Groups carry the paths of everything beneath them so
 * the timeline can show a group whenever one of its children is revealed.
 */
export type OutlineNode =
  | {
      kind: 'group';
      key: string;
      name: string;
      depth: number;
      /** Paths of every property under this group. */
      childPaths: string[];
      /** Identifies the thing the group stands for, for context menus. */
      target?: {
        type: 'mask' | 'animator' | 'selector' | 'shape' | 'effect';
        path: string;
      };
    }
  | {
      kind: 'prop';
      key: string;
      path: string;
      property: AnyProperty;
      name: string;
      depth: number;
      revealKey?: string;
    };

function isPropNode(node: OutlineNode): node is Extract<OutlineNode, { kind: 'prop' }> {
  return node.kind === 'prop';
}

function propPaths(nodes: OutlineNode[]): string[] {
  return nodes.filter(isPropNode).map((n) => n.path);
}

function propNode(
  path: string, property: AnyProperty, depth: number, revealKey?: string,
): OutlineNode {
  return { kind: 'prop', key: path, path, property, name: property.name, depth, revealKey };
}

function transformNodes(transform: TransformGroup, prefix: string, depth: number): OutlineNode[] {
  const entries: [keyof TransformGroup, string | undefined][] = [
    ['anchorPoint', 'a'], ['position', 'p'], ['scale', 's'],
    ['rotation', 'r'], ['opacity', 't'],
  ];
  return entries.flatMap(([key, revealKey]) => {
    const property = transform[key] as AnyProperty;
    return expand(`${prefix}.${key}`, property, revealKey ?? '').map(
      (d) => propNode(d.path, d.property, depth, revealKey),
    );
  });
}

function shapeTransformNodes(prefix: string, depth: number, transform: ShapeTransform): OutlineNode[] {
  return (Object.keys(transform) as (keyof ShapeTransform)[]).map((key) => (
    propNode(`${prefix}.${key}`, transform[key] as AnyProperty, depth)
  ));
}

/** Properties of one shape item, excluding nested groups. */
function shapeItemNodes(item: ShapeItem, path: string, depth: number): OutlineNode[] {
  const nodes: OutlineNode[] = [];
  const add = (key: string) => {
    const property = (item as unknown as Record<string, AnyProperty>)[key];
    if (property && typeof property === 'object' && 'keyframes' in property) {
      nodes.push(propNode(`${path}.${key}`, property, depth));
    }
  };
  for (const key of Object.keys(item)) {
    if (key === 'transform' || key === 'items') continue;
    add(key);
  }
  return nodes;
}

function shapeNodes(items: ShapeItem[], prefix: string, depth: number): OutlineNode[] {
  const nodes: OutlineNode[] = [];
  items.forEach((item, index) => {
    const path = `${prefix}.${index}`;
    const children = item.type === 'group'
      ? [
        ...shapeNodes(item.items, `${path}.items`, depth + 1),
        ...shapeTransformNodes(`${path}.transform`, depth + 1, item.transform),
      ]
      : shapeItemNodes(item, path, depth + 1);

    nodes.push({
      kind: 'group',
      key: path,
      name: item.name,
      depth,
      childPaths: propPaths(children),
      target: { type: 'shape', path },
    });
    nodes.push(...children);
  });
  return nodes;
}

function animatorNodes(layer: TextLayer): OutlineNode[] {
  const nodes: OutlineNode[] = [];
  layer.animators.forEach((animator, index) => {
    const path = `animators.${index}`;
    const children: OutlineNode[] = [];

    animator.selectors.forEach((selector, selectorIndex) => {
      const selectorPath = `${path}.selectors.${selectorIndex}`;
      const selectorProps = (['start', 'end', 'offset', 'amount', 'easeHigh', 'easeLow'] as const)
        .map((key) => propNode(`${selectorPath}.${key}`, selector[key] as AnyProperty, 4));
      children.push({
        kind: 'group',
        key: selectorPath,
        name: selector.name,
        depth: 3,
        childPaths: propPaths(selectorProps),
        target: { type: 'selector', path: selectorPath },
      });
      children.push(...selectorProps);
    });

    const { properties } = animator;
    for (const key of ['position', 'scale', 'rotation', 'opacity', 'tracking', 'fillColor'] as const) {
      if (!properties.enabled[key]) continue;
      children.push(propNode(`${path}.properties.${key}`, properties[key] as AnyProperty, 3));
    }

    nodes.push({
      kind: 'group',
      key: path,
      name: animator.name,
      depth: 2,
      childPaths: propPaths(children),
      target: { type: 'animator', path },
    });
    nodes.push(...children);
  });
  return nodes;
}

function effectNodes(layer: Layer): OutlineNode[] {
  const nodes: OutlineNode[] = [];
  layer.effects.forEach((effect, index) => {
    const path = `effects.${index}`;
    const children = Object.keys(effect.params).map((key) => (
      propNode(`${path}.params.${key}`, effect.params[key], 3, 'e')
    ));
    nodes.push({
      kind: 'group',
      key: path,
      name: effect.name,
      depth: 2,
      childPaths: propPaths(children),
      target: { type: 'effect', path },
    });
    nodes.push(...children);
  });
  return nodes;
}

function maskNodes(layer: Layer): OutlineNode[] {
  const nodes: OutlineNode[] = [];
  layer.masks.forEach((mask, index) => {
    const path = `masks.${index}`;
    const children = [
      propNode(`${path}.path`, mask.path as AnyProperty, 3, 'm'),
      propNode(`${path}.feather`, mask.feather as AnyProperty, 3, 'f'),
      propNode(`${path}.opacity`, mask.opacity as AnyProperty, 3, 'tt'),
      propNode(`${path}.expansion`, mask.expansion as AnyProperty, 3),
    ];
    nodes.push({
      kind: 'group',
      key: path,
      name: mask.name,
      depth: 2,
      childPaths: propPaths(children),
      target: { type: 'mask', path },
    });
    nodes.push(...children);
  });
  return nodes;
}

/**
 * The layer's full property tree, in After Effects' section order:
 * Text, Contents, Masks, Transform.
 */
export function layerOutline(layer: Layer): OutlineNode[] {
  const nodes: OutlineNode[] = [];

  if (layer.type === 'text' && layer.animators.length > 0) {
    const animators = animatorNodes(layer);
    nodes.push({
      kind: 'group',
      key: 'animators',
      name: 'Text',
      depth: 1,
      childPaths: propPaths(animators),
    });
    nodes.push(...animators);
  }

  if (layer.type === 'shape' && layer.contents.length > 0) {
    const contents = shapeNodes(layer.contents, 'contents', 2);
    nodes.push({
      kind: 'group',
      key: 'contents',
      name: 'Contents',
      depth: 1,
      childPaths: propPaths(contents),
    });
    nodes.push(...contents);
  }

  if (layer.masks.length > 0) {
    const masks = maskNodes(layer);
    nodes.push({
      kind: 'group',
      key: 'masks',
      name: 'Masks',
      depth: 1,
      childPaths: propPaths(masks),
    });
    nodes.push(...masks);
  }

  if (layer.effects.length > 0) {
    const effects = effectNodes(layer);
    nodes.push({
      kind: 'group',
      key: 'effects',
      name: 'Effects',
      depth: 1,
      childPaths: propPaths(effects),
    });
    nodes.push(...effects);
  }

  const transform = transformNodes(layer.transform, 'transform', 2);
  nodes.push({
    kind: 'group',
    key: 'transform',
    name: 'Transform',
    depth: 1,
    childPaths: propPaths(transform),
  });
  nodes.push(...transform);

  return nodes;
}

/** Every animatable property on a layer, flattened. */
export function allProperties(layer: Layer): PropertyDescriptor[] {
  return layerOutline(layer)
    .filter(isPropNode)
    .map((node) => ({
      path: node.path,
      property: node.property,
      revealKey: node.revealKey,
    }));
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
