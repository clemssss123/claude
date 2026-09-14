import { isLayerActiveAt, renderableLayers, worldMatrix } from '@/core/layer';
import type { Matrix } from '@/core/matrix';
import { rgbaToCss, valueAtTime } from '@/core/property';
import { buildShapes } from '@/core/shapes';
import type { DrawableShape } from '@/core/shapes';
import {
  fontString, glyphTransform, layoutTextLayer, registerTextMeasurer,
} from '@/core/text';
import type { Composition, Layer, ShapeLayer, TextLayer } from '@/core/types';
import { canvasBlendMode } from './blendMode';
import { BufferPool } from './buffers';
import { applyMasks, hasActiveMasks } from './masks';
import { applyTrackMatte } from './mattes';
import { toPath2D } from './path2d';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface RenderOptions {
  /** Downsample divisor: 1 = full, 2 = half, 4 = quarter. */
  resolution: number;
  /** Draw the checkerboard instead of the composition background colour. */
  showTransparencyGrid: boolean;
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  resolution: 1,
  showTransparencyGrid: false,
};

const CHECKER_SIZE = 16;
const pool = new BufferPool();

/**
 * Draw one frame of a composition into a 2D context.
 *
 * The context is expected to be sized `comp.width / resolution` by
 * `comp.height / resolution`; the renderer scales into composition
 * coordinates itself, so every layer transform is expressed in comp pixels.
 *
 * Layers that need no masking or matting composite straight onto the frame.
 * Anything else is drawn into a scratch buffer first, because a mask or a
 * track matte has to modify the layer's alpha before it meets the frame.
 */
export function renderComposition(
  ctx: CanvasRenderingContext2D,
  comp: Composition,
  time: number,
  options: RenderOptions = DEFAULT_RENDER_OPTIONS,
): void {
  const scale = 1 / options.resolution;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  if (options.showTransparencyGrid) {
    drawCheckerboard(ctx, ctx.canvas.width, ctx.canvas.height);
  } else {
    ctx.fillStyle = rgbaToCss(comp.bgColor);
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  pool.resize(ctx.canvas.width, ctx.canvas.height);

  const layers = renderableLayers(comp);
  // A layer with a track matte consumes the layer directly above it, which is
  // therefore not drawn in its own right.
  const consumed = new Set<number>();
  layers.forEach((layer, index) => {
    if (layer.trackMatte !== 'none' && index > 0) consumed.add(index - 1);
  });

  // Bottom of the stack first: index 0 is the topmost layer.
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    if (consumed.has(i)) continue;
    const layer = layers[i];
    if (!isLayerActiveAt(layer, time)) continue;

    const matteLayer = layer.trackMatte !== 'none' && i > 0 ? layers[i - 1] : undefined;
    compositeLayer(ctx, comp, layer, matteLayer, time, scale);
  }

  ctx.restore();
}

function compositeLayer(
  target: CanvasRenderingContext2D,
  comp: Composition,
  layer: Layer,
  matteLayer: Layer | undefined,
  time: number,
  scale: number,
): void {
  const opacity = valueAtTime(layer.transform.opacity, time) / 100;
  if (opacity <= 0) return;
  // Nulls and adjustment layers are controls, not content. Adjustment layers
  // become real render passes once the effect engine lands.
  if (layer.type === 'null' || layer.type === 'adjustment') return;

  const needsBuffer = hasActiveMasks(layer) || matteLayer !== undefined;
  const matrix = worldMatrix(comp, layer, time);

  if (!needsBuffer) {
    target.save();
    target.globalAlpha = opacity;
    target.globalCompositeOperation = canvasBlendMode(layer.blendMode);
    target.scale(scale, scale);
    target.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
    drawLayerContent(target, layer, time);
    target.restore();
    return;
  }

  const buffer = pool.clear('layer');
  buffer.ctx.save();
  buffer.ctx.scale(scale, scale);
  buffer.ctx.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
  drawLayerContent(buffer.ctx, layer, time);
  buffer.ctx.restore();

  applyMasks(buffer.ctx, layer, time, pool, scale, matrix);

  if (matteLayer) {
    const matte = pool.clear('matte');
    // The matte layer's own visibility switch is irrelevant — After Effects
    // turns it off when the matte is assigned — but its timing still counts.
    if (time >= matteLayer.inPoint && time < matteLayer.outPoint) {
      const matteMatrix = worldMatrix(comp, matteLayer, time);
      matte.ctx.save();
      matte.ctx.globalAlpha = valueAtTime(matteLayer.transform.opacity, time) / 100;
      matte.ctx.scale(scale, scale);
      matte.ctx.transform(
        matteMatrix.a, matteMatrix.b, matteMatrix.c,
        matteMatrix.d, matteMatrix.e, matteMatrix.f,
      );
      drawLayerContent(matte.ctx, matteLayer, time);
      matte.ctx.restore();
      applyMasks(matte.ctx, matteLayer, time, pool, scale, matteMatrix);
    }
    applyTrackMatte(buffer.ctx, matte, layer.trackMatte, pool);
  }

  target.save();
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.globalAlpha = opacity;
  target.globalCompositeOperation = canvasBlendMode(layer.blendMode);
  target.drawImage(buffer.canvas as CanvasImageSource, 0, 0);
  target.restore();
}

/** Paint a layer's own content, with the layer transform already applied. */
function drawLayerContent(ctx: Ctx2D, layer: Layer, time: number): void {
  switch (layer.type) {
    case 'solid':
      ctx.fillStyle = rgbaToCss(layer.color);
      ctx.fillRect(0, 0, layer.width, layer.height);
      break;
    case 'text':
      drawText(ctx, layer, time);
      break;
    case 'shape':
      drawShapeLayer(ctx, layer, time);
      break;
    default:
      break;
  }
}

// -- shape layers ----------------------------------------------------------

function drawShapeLayer(ctx: Ctx2D, layer: ShapeLayer, time: number): void {
  for (const shape of buildShapes(layer.contents, time)) {
    drawShape(ctx, shape);
  }
}

function drawShape(ctx: Ctx2D, shape: DrawableShape): void {
  if (shape.paths.length === 0) return;
  const path = toPath2D(shape.paths);
  const { matrix } = shape;

  ctx.save();
  ctx.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
  const baseAlpha = ctx.globalAlpha * shape.opacity;

  if (shape.fill) {
    ctx.globalAlpha = baseAlpha * shape.fill.opacity;
    ctx.fillStyle = rgbaToCss(shape.fill.color);
    ctx.fill(path, shape.fill.rule);
  }

  for (const stroke of shape.strokes) {
    if (stroke.width <= 0) continue;
    ctx.globalAlpha = baseAlpha * stroke.opacity;
    ctx.strokeStyle = rgbaToCss(stroke.color);
    ctx.lineWidth = stroke.width;
    ctx.lineCap = stroke.cap;
    ctx.lineJoin = stroke.join;
    const [dash, gap] = stroke.dashes;
    ctx.setLineDash(dash > 0 ? [dash, gap > 0 ? gap : dash] : []);
    ctx.stroke(path);
    ctx.setLineDash([]);
  }

  ctx.restore();
}

// -- text ------------------------------------------------------------------

function drawText(ctx: Ctx2D, layer: TextLayer, time: number): void {
  const { text } = layer;
  ctx.font = fontString(text);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const layout = layoutTextLayer(layer, time);
  const baseColor = rgbaToCss(text.fillColor);
  const baseAlpha = ctx.globalAlpha;

  if (layer.animators.length === 0) {
    ctx.fillStyle = baseColor;
    for (const glyph of layout.glyphs) ctx.fillText(glyph.character, glyph.x, glyph.y);
    return;
  }

  // Each character carries its own animator transform, so it gets its own
  // save/restore around a translate–rotate–scale about the glyph origin.
  for (const glyph of layout.glyphs) {
    const transform = glyphTransform(layer, time, glyph.index, layout.count);
    if (transform.opacity <= 0) continue;

    ctx.save();
    ctx.translate(glyph.x + transform.position[0], glyph.y + transform.position[1]);
    if (transform.rotation !== 0) ctx.rotate((transform.rotation * Math.PI) / 180);
    if (transform.scale[0] !== 100 || transform.scale[1] !== 100) {
      ctx.scale(transform.scale[0] / 100, transform.scale[1] / 100);
    }
    ctx.globalAlpha = baseAlpha * Math.max(0, Math.min(1, transform.opacity / 100));
    ctx.fillStyle = transform.fillColor ? rgbaToCss(transform.fillColor) : baseColor;
    ctx.fillText(glyph.character, 0, 0);
    ctx.restore();
  }
}

// -- misc ------------------------------------------------------------------

function drawCheckerboard(ctx: Ctx2D, width: number, height: number): void {
  ctx.fillStyle = '#2b2b2b';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#383838';
  for (let y = 0; y < height; y += CHECKER_SIZE) {
    for (let x = 0; x < width; x += CHECKER_SIZE) {
      if (((x / CHECKER_SIZE) + (y / CHECKER_SIZE)) % 2 === 0) {
        ctx.fillRect(x, y, CHECKER_SIZE, CHECKER_SIZE);
      }
    }
  }
}

/**
 * Give the text layout engine real glyph widths. Called once at start-up;
 * until then layout falls back to an average-advance estimate.
 */
export function installTextMeasurer(): void {
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(1, 1)
    : document.createElement('canvas');
  const ctx = canvas.getContext('2d') as Ctx2D | null;
  if (!ctx) return;

  const cache = new Map<string, number>();
  registerTextMeasurer((textRun, font) => {
    const key = `${font}|${textRun}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    ctx.font = font;
    const width = ctx.measureText(textRun).width;
    // Bounded so a long session cannot grow the cache without limit.
    if (cache.size > 4096) cache.clear();
    cache.set(key, width);
    return width;
  });
}

export function matrixToArray(m: Matrix): [number, number, number, number, number, number] {
  return [m.a, m.b, m.c, m.d, m.e, m.f];
}
