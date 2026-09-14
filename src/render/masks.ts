import type { Matrix } from '@/core/matrix';
import { offsetPath } from '@/core/path';
import { valueAtTime } from '@/core/property';
import type { Layer, Mask, MaskMode } from '@/core/types';
import type { BufferPool } from './buffers';
import { tracePath } from './path2d';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Canvas composite operation that produces each After Effects mask mode. */
const MASK_COMPOSITE: Record<Exclude<MaskMode, 'none'>, GlobalCompositeOperation> = {
  add: 'source-over',
  subtract: 'destination-out',
  intersect: 'destination-in',
  lighten: 'lighten',
  darken: 'darken',
  difference: 'xor',
};

/** How far the feather squeeze may stretch a buffer when the axes differ. */
const MAX_FEATHER_RATIO = 8;

export function hasActiveMasks(layer: Layer): boolean {
  return layer.masks.some((mask) => mask.mode !== 'none');
}

/**
 * Multiply a layer's alpha by its mask stack.
 *
 * The masks are combined into one alpha channel first — each with its own
 * mode, feather, expansion, opacity and inversion — and that channel is then
 * intersected with the layer.
 */
export function applyMasks(
  layerCtx: Ctx2D,
  layer: Layer,
  time: number,
  pool: BufferPool,
  scale: number,
  matrix: Matrix,
): void {
  const masks = layer.masks.filter((mask) => mask.mode !== 'none');
  if (masks.length === 0) return;

  const combined = pool.clear('mask');
  const single = pool.get('maskSingle');

  for (const mask of masks) {
    drawSingleMask(single, mask, time, scale, matrix, pool);
    combined.ctx.globalCompositeOperation = MASK_COMPOSITE[mask.mode as Exclude<MaskMode, 'none'>];
    combined.ctx.globalAlpha = 1;
    combined.ctx.drawImage(single.canvas as CanvasImageSource, 0, 0);
  }

  layerCtx.save();
  layerCtx.setTransform(1, 0, 0, 1, 0, 0);
  layerCtx.globalAlpha = 1;
  layerCtx.globalCompositeOperation = 'destination-in';
  layerCtx.drawImage(combined.canvas as CanvasImageSource, 0, 0);
  layerCtx.restore();
}

function drawSingleMask(
  target: { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: Ctx2D },
  mask: Mask,
  time: number,
  scale: number,
  matrix: Matrix,
  pool: BufferPool,
): void {
  const { ctx, canvas } = target;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const expansion = valueAtTime(mask.expansion, time);
  const source = valueAtTime(mask.path, time);
  const path = expansion !== 0 ? offsetPath(source, expansion) : source;

  ctx.save();
  ctx.scale(scale, scale);
  ctx.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
  ctx.beginPath();
  tracePath(ctx, path);
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = Math.max(0, Math.min(1, valueAtTime(mask.opacity, time) / 100));

  if (mask.inverted) {
    // Fill everything, then punch the shape out.
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, valueAtTime(mask.opacity, time) / 100));
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1;
    ctx.beginPath();
    tracePath(ctx, path);
    ctx.fill();
  } else {
    ctx.fill();
  }
  ctx.restore();

  // Feather is measured in layer pixels, so it follows the layer's own scale.
  const layerScale = Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c)) || 1;
  const feather = valueAtTime(mask.feather, time);
  featherBuffer(target, feather[0] * scale * layerScale, feather[1] * scale * layerScale, pool);
}

/**
 * Blur a mask buffer in place.
 *
 * Canvas filters only offer an isotropic blur, so a mask with different
 * horizontal and vertical feather is squeezed along one axis, blurred, and
 * stretched back — the squeeze is capped so an extreme ratio cannot blow up
 * the intermediate buffer.
 */
function featherBuffer(
  target: { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: Ctx2D },
  fx: number,
  fy: number,
  pool: BufferPool,
): void {
  if (fx <= 0.01 && fy <= 0.01) return;

  const { ctx, canvas } = target;
  const temp = pool.clear('maskFeather');

  if (Math.abs(fx - fy) < 0.01 || fx <= 0.01 || fy <= 0.01) {
    const radius = Math.max(fx, fy);
    temp.ctx.filter = `blur(${radius / 2}px)`;
    temp.ctx.drawImage(canvas as CanvasImageSource, 0, 0);
    temp.ctx.filter = 'none';
  } else {
    // Squeeze the axis that needs less blur so one isotropic pass covers both.
    const radius = Math.min(fx, fy);
    const squeezeX = clampRatio(radius / fx);
    const squeezeY = clampRatio(radius / fy);
    const squeezed = pool.clear('maskSqueeze');
    squeezed.ctx.drawImage(
      canvas as CanvasImageSource,
      0, 0, canvas.width, canvas.height,
      0, 0, canvas.width * squeezeX, canvas.height * squeezeY,
    );
    temp.ctx.filter = `blur(${radius / 2}px)`;
    temp.ctx.drawImage(
      squeezed.canvas as CanvasImageSource,
      0, 0, canvas.width * squeezeX, canvas.height * squeezeY,
      0, 0, canvas.width, canvas.height,
    );
    temp.ctx.filter = 'none';
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'copy';
  ctx.globalAlpha = 1;
  ctx.drawImage(temp.canvas as CanvasImageSource, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
}

function clampRatio(value: number): number {
  return Math.min(1, Math.max(1 / MAX_FEATHER_RATIO, value));
}
