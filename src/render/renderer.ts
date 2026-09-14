import { isLayerActiveAt, renderableLayers, worldMatrix } from '@/core/layer';
import { rgbaToCss, valueAtTime } from '@/core/property';
import type { Composition, Layer, TextLayer } from '@/core/types';
import { canvasBlendMode } from './blendMode';

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

/**
 * Draw one frame of a composition into a 2D context.
 *
 * The context is expected to be sized `comp.width / resolution` by
 * `comp.height / resolution`; this function scales into composition
 * coordinates itself, so every layer transform is expressed in comp pixels.
 *
 * Phase 1 composites straight to the target with per-layer blend modes.
 * Effects, track mattes, adjustment layers and motion blur arrive in later
 * phases and will need an offscreen pass per layer.
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
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  if (options.showTransparencyGrid) {
    drawCheckerboard(ctx, ctx.canvas.width, ctx.canvas.height);
  } else {
    ctx.fillStyle = rgbaToCss(comp.bgColor);
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  ctx.scale(scale, scale);

  const layers = renderableLayers(comp);
  // Bottom of the stack first: index 0 is the topmost layer.
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const layer = layers[i];
    if (!isLayerActiveAt(layer, time)) continue;
    drawLayer(ctx, comp, layer, time);
  }

  ctx.restore();
}

function drawLayer(
  ctx: CanvasRenderingContext2D,
  comp: Composition,
  layer: Layer,
  time: number,
): void {
  const opacity = valueAtTime(layer.transform.opacity, time) / 100;
  if (opacity <= 0) return;
  // Nulls and adjustment layers are controls, not content. Adjustment layers
  // become real render passes once the effect engine lands.
  if (layer.type === 'null' || layer.type === 'adjustment') return;

  const m = worldMatrix(comp, layer, time);

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = canvasBlendMode(layer.blendMode);
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);

  switch (layer.type) {
    case 'solid':
      ctx.fillStyle = rgbaToCss(layer.color);
      ctx.fillRect(0, 0, layer.width, layer.height);
      break;
    case 'text':
      drawText(ctx, layer);
      break;
    default:
      break;
  }

  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, layer: TextLayer): void {
  const { text } = layer;
  ctx.font = `${text.fontWeight} ${text.fontSize}px ${text.fontFamily}`;
  ctx.fillStyle = rgbaToCss(text.fillColor);
  ctx.textAlign = text.justification;
  ctx.textBaseline = 'alphabetic';

  const lines = text.source.split('\n');
  const lineHeight = text.fontSize * text.leading;
  lines.forEach((line, index) => {
    const y = index * lineHeight;
    if (text.tracking === 0) {
      ctx.fillText(line, 0, y);
      return;
    }
    drawTrackedLine(ctx, line, y, text.tracking, text.justification);
  });
}

/** Per-character placement, needed because canvas has no letter-spacing. */
function drawTrackedLine(
  ctx: CanvasRenderingContext2D,
  line: string,
  y: number,
  tracking: number,
  justification: CanvasTextAlign,
): void {
  const chars = [...line];
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((sum, w) => sum + w, 0) + tracking * (chars.length - 1);

  let x = 0;
  if (justification === 'center') x = -total / 2;
  else if (justification === 'right') x = -total;

  const previousAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  chars.forEach((ch, i) => {
    ctx.fillText(ch, x, y);
    x += widths[i] + tracking;
  });
  ctx.textAlign = previousAlign;
}

function drawCheckerboard(ctx: CanvasRenderingContext2D, width: number, height: number): void {
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

/** Measure a text layer's drawn bounds, used for selection handles. */
export function measureTextLayer(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
): { x: number; y: number; width: number; height: number } {
  const { text } = layer;
  ctx.save();
  ctx.font = `${text.fontWeight} ${text.fontSize}px ${text.fontFamily}`;
  const lines = text.source.split('\n');
  const widths = lines.map(
    (line) => ctx.measureText(line).width + text.tracking * Math.max(0, [...line].length - 1),
  );
  ctx.restore();

  const width = Math.max(1, ...widths);
  const lineHeight = text.fontSize * text.leading;
  const height = lineHeight * lines.length;
  const x = text.justification === 'center' ? -width / 2
    : text.justification === 'right' ? -width : 0;
  return { x, y: -text.fontSize * 0.8, width, height };
}
