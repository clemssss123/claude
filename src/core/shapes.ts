import { IDENTITY, multiply, rotation, scaling, translation } from './matrix';
import type { Matrix } from './matrix';
import { createProperty, valueAtTime } from './property';
import {
  clonePath, ellipsePath, offsetPath, rectPath, starPath, trimPath,
} from './path';
import type { BezierPath } from './path';
import { uid } from './uid';
import type {
  EllipseShape, FillStyle, OffsetPathsModifier, PathShape, RGBA, RectShape,
  RepeaterModifier, ShapeGroup, ShapeItem, ShapeTransform, StarShape, StrokeStyle,
  TrimPathsModifier, Vec2,
} from './types';

// -- factories -------------------------------------------------------------

export function createShapeTransform(position: Vec2 = [0, 0]): ShapeTransform {
  return {
    anchorPoint: createProperty<Vec2>('Anchor Point', 'ADBE Vector Anchor', 'vec2', [0, 0], {
      dimensionNames: ['X', 'Y'],
    }),
    position: createProperty<Vec2>('Position', 'ADBE Vector Position', 'vec2', position, {
      dimensionNames: ['X', 'Y'],
    }),
    scale: createProperty<Vec2>('Scale', 'ADBE Vector Scale', 'vec2', [100, 100], {
      unit: '%', dimensionNames: ['Width', 'Height'], speedPerPixel: 0.5,
    }),
    rotation: createProperty<number>('Rotation', 'ADBE Vector Rotation', 'angle', 0, { unit: '°' }),
    opacity: createProperty<number>('Opacity', 'ADBE Vector Opacity', 'percent', 100, {
      min: 0, max: 100, unit: '%', speedPerPixel: 0.5,
    }),
    skew: createProperty<number>('Skew', 'ADBE Vector Skew', 'number', 0),
    skewAxis: createProperty<number>('Skew Axis', 'ADBE Vector Skew Axis', 'angle', 0, { unit: '°' }),
  };
}

function base(name: string) {
  return { id: uid('shape'), name, enabled: true };
}

export function createRectShape(size: Vec2 = [200, 200], position: Vec2 = [0, 0]): RectShape {
  return {
    ...base('Rectangle Path 1'),
    type: 'rect',
    size: createProperty<Vec2>('Size', 'ADBE Vector Rect Size', 'vec2', size, {
      dimensionNames: ['Width', 'Height'],
    }),
    position: createProperty<Vec2>('Position', 'ADBE Vector Rect Position', 'vec2', position, {
      dimensionNames: ['X', 'Y'],
    }),
    roundness: createProperty<number>('Roundness', 'ADBE Vector Rect Roundness', 'number', 0, {
      min: 0,
    }),
  };
}

export function createEllipseShape(size: Vec2 = [200, 200], position: Vec2 = [0, 0]): EllipseShape {
  return {
    ...base('Ellipse Path 1'),
    type: 'ellipse',
    size: createProperty<Vec2>('Size', 'ADBE Vector Ellipse Size', 'vec2', size, {
      dimensionNames: ['Width', 'Height'],
    }),
    position: createProperty<Vec2>('Position', 'ADBE Vector Ellipse Position', 'vec2', position, {
      dimensionNames: ['X', 'Y'],
    }),
  };
}

export function createStarShape(star = true): StarShape {
  return {
    ...base(star ? 'Star Path 1' : 'Polygon Path 1'),
    type: 'star',
    star,
    points: createProperty<number>('Points', 'ADBE Vector Star Points', 'number', 5, { min: 3 }),
    position: createProperty<Vec2>('Position', 'ADBE Vector Star Position', 'vec2', [0, 0], {
      dimensionNames: ['X', 'Y'],
    }),
    rotation: createProperty<number>('Rotation', 'ADBE Vector Star Rotation', 'angle', 0, { unit: '°' }),
    outerRadius: createProperty<number>('Outer Radius', 'ADBE Vector Star Outer Radius', 'number', 140),
    innerRadius: createProperty<number>('Inner Radius', 'ADBE Vector Star Inner Radius', 'number', 70),
  };
}

export function createPathShape(path: BezierPath): PathShape {
  return {
    ...base('Path 1'),
    type: 'path',
    path: createProperty<BezierPath>('Path', 'ADBE Vector Shape', 'path', path),
  };
}

export function createFill(color: RGBA): FillStyle {
  return {
    ...base('Fill 1'),
    type: 'fill',
    color: createProperty<RGBA>('Color', 'ADBE Vector Fill Color', 'color', color),
    opacity: createProperty<number>('Opacity', 'ADBE Vector Fill Opacity', 'percent', 100, {
      min: 0, max: 100, unit: '%', speedPerPixel: 0.5,
    }),
    rule: 'nonzero',
  };
}

export function createStroke(color: RGBA, width = 6): StrokeStyle {
  return {
    ...base('Stroke 1'),
    type: 'stroke',
    color: createProperty<RGBA>('Color', 'ADBE Vector Stroke Color', 'color', color),
    opacity: createProperty<number>('Opacity', 'ADBE Vector Stroke Opacity', 'percent', 100, {
      min: 0, max: 100, unit: '%', speedPerPixel: 0.5,
    }),
    width: createProperty<number>('Stroke Width', 'ADBE Vector Stroke Width', 'number', width, {
      min: 0,
    }),
    cap: 'round',
    join: 'round',
    dashes: createProperty<Vec2>('Dashes', 'ADBE Vector Stroke Dashes', 'vec2', [0, 0], {
      dimensionNames: ['Dash', 'Gap'], min: 0,
    }),
  };
}

export function createTrimPaths(): TrimPathsModifier {
  return {
    ...base('Trim Paths 1'),
    type: 'trim',
    start: createProperty<number>('Start', 'ADBE Vector Trim Start', 'percent', 0, {
      min: 0, max: 100, unit: '%', speedPerPixel: 0.5,
    }),
    end: createProperty<number>('End', 'ADBE Vector Trim End', 'percent', 100, {
      min: 0, max: 100, unit: '%', speedPerPixel: 0.5,
    }),
    offset: createProperty<number>('Offset', 'ADBE Vector Trim Offset', 'angle', 0, { unit: '°' }),
    multipleShapes: false,
  };
}

export function createRepeater(): RepeaterModifier {
  const transform = createShapeTransform([120, 0]);
  return {
    ...base('Repeater 1'),
    type: 'repeater',
    copies: createProperty<number>('Copies', 'ADBE Vector Repeater Copies', 'number', 3, { min: 1 }),
    offset: createProperty<number>('Offset', 'ADBE Vector Repeater Offset', 'number', 0),
    transform,
    startOpacity: createProperty<number>('Start Opacity', 'ADBE Vector Repeater Start Opacity', 'percent', 100, {
      min: 0, max: 100, unit: '%',
    }),
    endOpacity: createProperty<number>('End Opacity', 'ADBE Vector Repeater End Opacity', 'percent', 100, {
      min: 0, max: 100, unit: '%',
    }),
  };
}

export function createOffsetPaths(): OffsetPathsModifier {
  return {
    ...base('Offset Paths 1'),
    type: 'offset',
    amount: createProperty<number>('Amount', 'ADBE Vector Offset Amount', 'number', 0),
  };
}

export function createShapeGroup(items: ShapeItem[], name = 'Shape 1'): ShapeGroup {
  return {
    ...base(name),
    type: 'group',
    items,
    transform: createShapeTransform(),
  };
}

// -- evaluation ------------------------------------------------------------

export interface DrawableStroke {
  color: RGBA;
  opacity: number;
  width: number;
  cap: CanvasLineCap;
  join: CanvasLineJoin;
  dashes: Vec2;
}

export interface DrawableFill {
  color: RGBA;
  opacity: number;
  rule: CanvasFillRule;
}

/** A flattened, render-ready shape: paths plus the styles painting them. */
export interface DrawableShape {
  paths: BezierPath[];
  fill?: DrawableFill;
  strokes: DrawableStroke[];
  matrix: Matrix;
  opacity: number;
}

export function shapeTransformMatrix(transform: ShapeTransform, time: number): Matrix {
  const anchor = valueAtTime(transform.anchorPoint, time);
  const position = valueAtTime(transform.position, time);
  const scale = valueAtTime(transform.scale, time);
  const rotate = valueAtTime(transform.rotation, time);
  const skew = valueAtTime(transform.skew, time);
  const skewAxis = valueAtTime(transform.skewAxis, time);

  let m = translation(position[0], position[1]);
  m = multiply(m, rotation(rotate));
  if (skew !== 0) {
    // Skew is applied along its axis: rotate into the axis, shear, rotate back.
    m = multiply(m, rotation(skewAxis));
    m = multiply(m, { a: 1, b: 0, c: Math.tan((skew * Math.PI) / 180), d: 1, e: 0, f: 0 });
    m = multiply(m, rotation(-skewAxis));
  }
  m = multiply(m, scaling(scale[0] / 100, scale[1] / 100));
  m = multiply(m, translation(-anchor[0], -anchor[1]));
  return m;
}

/**
 * Turn a shape-layer content tree into drawables, in paint order (first drawn
 * first). Within a group, items lower in the list paint first, so the topmost
 * item in the timeline ends up on top — the After Effects convention.
 *
 * Fills and strokes apply to every path in the group that contains them;
 * modifiers (trim, offset, repeater) apply to that same set of paths.
 */
export function buildShapes(
  items: ShapeItem[],
  time: number,
  parentMatrix: Matrix = { ...IDENTITY },
  parentOpacity = 1,
): DrawableShape[] {
  const paths: BezierPath[] = [];
  const strokes: DrawableStroke[] = [];
  let fill: DrawableFill | undefined;
  let trim: TrimPathsModifier | undefined;
  let offset: OffsetPathsModifier | undefined;
  let repeater: RepeaterModifier | undefined;
  const nested: DrawableShape[] = [];

  // Nested groups are gathered bottom-up: the last group in the list paints
  // first, so the topmost entry in the timeline ends up on top.
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (!item.enabled || item.type !== 'group') continue;
    const matrix = multiply(parentMatrix, shapeTransformMatrix(item.transform, time));
    const opacity = parentOpacity * (valueAtTime(item.transform.opacity, time) / 100);
    nested.push(...buildShapes(item.items, time, matrix, opacity));
  }

  for (const item of items) {
    if (!item.enabled) continue;
    switch (item.type) {
      case 'group':
        break;
      case 'rect':
        paths.push(rectPath(
          valueAtTime(item.position, time),
          valueAtTime(item.size, time),
          valueAtTime(item.roundness, time),
        ));
        break;
      case 'ellipse':
        paths.push(ellipsePath(
          valueAtTime(item.position, time),
          valueAtTime(item.size, time),
        ));
        break;
      case 'star':
        paths.push(starPath(
          valueAtTime(item.position, time),
          valueAtTime(item.points, time),
          valueAtTime(item.outerRadius, time),
          valueAtTime(item.innerRadius, time),
          valueAtTime(item.rotation, time),
          item.star,
        ));
        break;
      case 'path':
        paths.push(clonePath(valueAtTime(item.path, time)));
        break;
      case 'fill':
        fill = {
          color: valueAtTime(item.color, time),
          opacity: valueAtTime(item.opacity, time) / 100,
          rule: item.rule,
        };
        break;
      case 'stroke':
        strokes.push({
          color: valueAtTime(item.color, time),
          opacity: valueAtTime(item.opacity, time) / 100,
          width: valueAtTime(item.width, time),
          cap: item.cap,
          join: item.join,
          dashes: valueAtTime(item.dashes, time),
        });
        break;
      case 'trim':
        trim = item;
        break;
      case 'offset':
        offset = item;
        break;
      case 'repeater':
        repeater = item;
        break;
      default:
        break;
    }
  }

  let finalPaths = paths;
  if (offset) {
    const amount = valueAtTime(offset.amount, time);
    finalPaths = finalPaths.map((p) => offsetPath(p, amount));
  }
  if (trim) {
    const start = valueAtTime(trim.start, time) / 100;
    const end = valueAtTime(trim.end, time) / 100;
    const trimOffset = valueAtTime(trim.offset, time) / 360;
    finalPaths = finalPaths.map((p) => trimPath(p, start, end, trimOffset));
  }

  const own: DrawableShape[] = finalPaths.length > 0
    ? [{ paths: finalPaths, fill, strokes, matrix: parentMatrix, opacity: parentOpacity }]
    : [];

  // A group's own paths sit above the groups nested inside it.
  const combined = [...nested, ...own];
  if (!repeater) return combined;

  return applyRepeater(combined, repeater, time);
}

function applyRepeater(
  shapes: DrawableShape[],
  repeater: RepeaterModifier,
  time: number,
): DrawableShape[] {
  const copies = Math.max(1, Math.round(valueAtTime(repeater.copies, time)));
  const offsetCount = valueAtTime(repeater.offset, time);
  const startOpacity = valueAtTime(repeater.startOpacity, time) / 100;
  const endOpacity = valueAtTime(repeater.endOpacity, time) / 100;
  const step = shapeTransformMatrix(repeater.transform, time);

  // Copies are emitted last-first so copy 1 — the original — ends up on top,
  // which is After Effects' default "composite below" behaviour.
  const out: DrawableShape[] = [];
  for (let i = copies - 1; i >= 0; i -= 1) {
    const index = i + offsetCount;
    let matrix: Matrix = { ...IDENTITY };
    // Each copy is the step transform applied one more time than the last.
    const whole = Math.round(index);
    for (let r = 0; r < Math.abs(whole); r += 1) matrix = multiply(matrix, step);

    const mix = copies === 1 ? 1 : i / (copies - 1);
    const opacity = startOpacity + (endOpacity - startOpacity) * mix;
    for (const shape of shapes) {
      out.push({
        ...shape,
        matrix: multiply(matrix, shape.matrix),
        opacity: shape.opacity * opacity,
      });
    }
  }
  return out;
}
