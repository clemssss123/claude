import { beginExpressionFrame } from '@/core/expressions';
import {
  allProperties, isLayerActiveAt, layerBounds, renderableLayers, sourceTimeAt, worldMatrix,
} from '@/core/layer';
import { applyToPoint, translation } from '@/core/matrix';
import type { Matrix } from '@/core/matrix';
import { rgbaToCss, valueAtTime } from '@/core/property';
import { buildShapes } from '@/core/shapes';
import type { DrawableShape } from '@/core/shapes';
import {
  fontString, glyphTransform, layoutTextLayer, registerTextMeasurer,
} from '@/core/text';
import type {
  Composition, EffectInstance, Id, Layer, MediaLayer, PrecompLayer, PropertyValue, ShapeLayer,
  TextLayer,
} from '@/core/types';
import { footageDrawable, requestFootageTime } from './assets';
import { canvasBlendMode } from './blendMode';
import { BufferPool } from './buffers';
import type { Buffer } from './buffers';
import { getEffectDefinition } from './effects';
import './effects';
import { applyMasks, hasActiveMasks } from './masks';
import { applyTrackMatte } from './mattes';
import { toPath2D } from './path2d';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface RenderOptions {
  /** Downsample divisor: 1 = full, 2 = half, 4 = quarter. */
  resolution: number;
  /** Draw the checkerboard instead of the composition background colour. */
  showTransparencyGrid: boolean;
  /** Lets precomposition layers find the composition they stand for. */
  resolveComposition?: (id: Id) => Composition | undefined;
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  resolution: 1,
  showTransparencyGrid: false,
};

const CHECKER_SIZE = 16;
/** Cap on the headroom an effect may claim outside a layer, in layer pixels. */
const MAX_EFFECT_MARGIN = 600;
const pool = new BufferPool();
/** How deep into nested compositions the renderer currently is. */
let renderDepth = 0;
/** Guards a time effect from re-sampling itself without end. */
let sampleDepth = 0;
const MAX_SAMPLE_DEPTH = 2;
/** Deepest nesting the renderer will follow before giving up. */
const MAX_PRECOMP_DEPTH = 8;

/** Buffer name scoped to the current nesting depth. */
function scoped(name: string): string {
  return renderDepth === 0 ? name : `${name}@${renderDepth}`;
}

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
  beginExpressionFrame();
  resolveComposition = options.resolveComposition;
  currentFrameRate = comp.frameRate;
  renderDepth = 0;

  pool.resize(ctx.canvas.width, ctx.canvas.height);

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
  ctx.restore();

  renderInto(ctx, comp, time, scale, true);
}

/**
 * Composite a composition's layers onto a context that is already sized and
 * cleared. Nested compositions reuse this, which is what makes precomps work.
 */
function renderInto(
  ctx: CanvasRenderingContext2D,
  comp: Composition,
  time: number,
  scale: number,
  alreadyPrepared: boolean,
): void {
  if (!alreadyPrepared) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

  ctx.save();

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

    if (layer.type === 'adjustment') {
      applyAdjustmentLayer(ctx, comp, layer, time, scale);
      continue;
    }

    const matteLayer = layer.trackMatte !== 'none' && i > 0 ? layers[i - 1] : undefined;
    const samples = motionBlurSamples(comp, layer, time);
    if (samples) compositeMotionBlurred(ctx, comp, layer, matteLayer, time, scale, samples);
    else compositeLayer(ctx, comp, layer, matteLayer, time, scale);
  }

  ctx.restore();
}

// -- motion blur -----------------------------------------------------------

/**
 * The sub-frame times the shutter is open for, or null when this layer is not
 * motion blurred.
 *
 * The shutter opens at `phase` degrees relative to the frame and stays open
 * for `angle` degrees of it, so a 180° shutter at -90° phase is centred on the
 * frame — the physically typical camera After Effects defaults to.
 */
function motionBlurSamples(comp: Composition, layer: Layer, time: number): number[] | null {
  const settings = comp.motionBlur;
  if (!settings.enabled || !layer.motionBlur) return null;

  const frame = 1 / comp.frameRate;
  const duration = (settings.shutterAngle / 360) * frame;
  if (duration <= 0) return null;
  const open = time + (settings.shutterPhase / 360) * frame;

  // Adaptive sampling: a layer that travels further across the shutter needs
  // more samples before the trail stops looking like separate copies.
  const start = applyToPoint(worldMatrix(comp, layer, open), [0, 0]);
  const end = applyToPoint(worldMatrix(comp, layer, open + duration), [0, 0]);
  const travel = Math.hypot(end[0] - start[0], end[1] - start[1]);
  const count = Math.min(
    Math.max(2, Math.round(settings.adaptiveSampleLimit)),
    Math.max(2, Math.round(Math.max(settings.samplesPerFrame, travel / 2))),
  );

  const times: number[] = [];
  for (let i = 0; i < count; i += 1) {
    times.push(open + duration * (i / (count - 1)));
  }
  return times;
}

/**
 * Whether the layer's own content looks the same at every sub-frame time.
 * When it does — the usual case of a layer that simply moves — the content is
 * rendered once and only the transform is re-sampled.
 */
function contentIsTimeInvariant(layer: Layer): boolean {
  return allProperties(layer).every((descriptor) => {
    if (descriptor.path.startsWith('transform.')) return true;
    return !descriptor.property.animated && !descriptor.property.expression;
  });
}

function compositeMotionBlurred(
  target: CanvasRenderingContext2D,
  comp: Composition,
  layer: Layer,
  matteLayer: Layer | undefined,
  time: number,
  scale: number,
  samples: number[],
): void {
  if (layer.type === 'null') return;

  const width = target.canvas.width;
  const height = target.canvas.height;
  const accumulator = pool.sized(scoped('mbAccumulate'), width, height);
  const frame = pool.sized(scoped('mbFrame'), width, height);

  // Re-rendering content per sample is only necessary when it changes.
  const invariant = contentIsTimeInvariant(layer);
  const cached = invariant ? renderLayerInLayerSpace(layer, time, scale, scoped('mbLayer')) : null;
  if (invariant && !cached) return;

  const weight = 1 / samples.length;
  for (const sampleTime of samples) {
    const rendered = cached ?? renderLayerInLayerSpace(layer, sampleTime, scale, scoped('mbLayer'));
    if (!rendered) continue;

    frame.ctx.setTransform(1, 0, 0, 1, 0, 0);
    frame.ctx.globalCompositeOperation = 'copy';
    frame.ctx.globalAlpha = 1;
    frame.ctx.clearRect(0, 0, width, height);
    frame.ctx.globalCompositeOperation = 'source-over';

    const matrix = worldMatrix(comp, layer, sampleTime);
    frame.ctx.save();
    frame.ctx.globalAlpha = Math.max(
      0, Math.min(1, valueAtTime(layer.transform.opacity, sampleTime) / 100),
    );
    frame.ctx.scale(scale, scale);
    frame.ctx.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
    drawBufferInLayerSpace(frame.ctx, rendered);
    frame.ctx.restore();

    // Adding the weighted samples averages them, which is what a shutter does.
    accumulator.ctx.globalCompositeOperation = 'lighter';
    accumulator.ctx.globalAlpha = weight;
    accumulator.ctx.drawImage(frame.canvas as CanvasImageSource, 0, 0);
  }
  accumulator.ctx.globalCompositeOperation = 'source-over';
  accumulator.ctx.globalAlpha = 1;

  if (matteLayer) {
    const matte = pool.sized(scoped('matte'), width, height);
    if (time >= matteLayer.inPoint && time < matteLayer.outPoint) {
      const matteRendered = renderLayerInLayerSpace(matteLayer, time, scale, scoped('matteSrc'));
      if (matteRendered) {
        const matteMatrix = worldMatrix(comp, matteLayer, time);
        matte.ctx.save();
        matte.ctx.globalAlpha = valueAtTime(matteLayer.transform.opacity, time) / 100;
        matte.ctx.scale(scale, scale);
        matte.ctx.transform(
          matteMatrix.a, matteMatrix.b, matteMatrix.c,
          matteMatrix.d, matteMatrix.e, matteMatrix.f,
        );
        drawBufferInLayerSpace(matte.ctx, matteRendered);
        matte.ctx.restore();
      }
    }
    applyTrackMatte(accumulator.ctx, matte, layer.trackMatte, pool);
  }

  target.save();
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.globalAlpha = 1;
  target.globalCompositeOperation = canvasBlendMode(layer.blendMode);
  target.drawImage(accumulator.canvas as CanvasImageSource, 0, 0);
  target.restore();
}

// -- effects ---------------------------------------------------------------

function activeEffects(layer: Layer): EffectInstance[] {
  return layer.effects.filter(
    (effect) => effect.enabled && getEffectDefinition(effect.matchName) !== undefined,
  );
}

function paramReader(effect: EffectInstance, time: number) {
  return <T extends PropertyValue>(key: string): T => {
    const property = effect.params[key];
    return (property ? valueAtTime(property, time) : 0) as T;
  };
}

/** Headroom the layer's effects need outside its own bounds. */
function effectMargin(layer: Layer, time: number): number {
  let margin = 0;
  for (const effect of activeEffects(layer)) {
    const definition = getEffectDefinition(effect.matchName);
    if (!definition?.margin) continue;
    margin = Math.max(margin, definition.margin(paramReader(effect, time)));
  }
  return Math.min(MAX_EFFECT_MARGIN, Math.max(0, margin));
}

/**
 * Run a layer's effect chain over a buffer, ping-ponging between two scratch
 * buffers so each effect reads a finished image and writes a fresh one.
 */
function runEffects(
  layer: Layer,
  time: number,
  input: Buffer,
  width: number,
  height: number,
  scale: number,
  prefix: string,
  sampleAtTime?: (t: number) => Buffer | null,
): Buffer {
  const effects = activeEffects(layer);
  if (effects.length === 0) return input;

  const ping = pool.sized(`${prefix}FxA`, width, height);
  const pong = pool.sized(`${prefix}FxB`, width, height);

  let source = input;
  for (const effect of effects) {
    const definition = getEffectDefinition(effect.matchName);
    if (!definition) continue;
    const dest = source === ping ? pong : ping;
    dest.ctx.setTransform(1, 0, 0, 1, 0, 0);
    dest.ctx.globalAlpha = 1;
    dest.ctx.globalCompositeOperation = 'source-over';
    dest.ctx.filter = 'none';
    dest.ctx.clearRect(0, 0, width, height);

    definition.apply({
      source,
      dest,
      width,
      height,
      scale,
      time,
      pool,
      frameRate: currentFrameRate,
      get: paramReader(effect, time),
      sampleAtTime,
    });
    source = dest;
  }
  return source;
}

/**
 * An adjustment layer effects everything already drawn beneath it, limited by
 * its own masks. It has no content of its own, so the frame is its input.
 */
function applyAdjustmentLayer(
  target: CanvasRenderingContext2D,
  comp: Composition,
  layer: Layer,
  time: number,
  scale: number,
): void {
  if (activeEffects(layer).length === 0) return;
  const opacity = valueAtTime(layer.transform.opacity, time) / 100;
  if (opacity <= 0) return;

  const width = target.canvas.width;
  const height = target.canvas.height;

  const below = pool.sized(scoped('adjustBelow'), width, height);
  below.ctx.drawImage(target.canvas as CanvasImageSource, 0, 0);

  const result = runEffects(layer, time, below, width, height, scale, scoped('adjust'));
  const matrix = worldMatrix(comp, layer, time);

  // Masks confine the adjustment; without them it covers the whole frame.
  const limited = pool.sized(scoped('adjustOut'), width, height);
  limited.ctx.drawImage(result.canvas as CanvasImageSource, 0, 0);
  applyMasks(limited.ctx, layer, time, pool, scale, matrix, width, height);

  target.save();
  target.setTransform(1, 0, 0, 1, 0, 0);

  // A Normal adjustment layer *replaces* the frame it covers. Laying the
  // processed copy over the untouched original instead would let the
  // original show through wherever the result is not fully opaque — a
  // blurred edge would keep the hard edge underneath it, and an effect
  // that removes pixels would remove nothing. Erasing by the same coverage
  // and opacity first is what makes the result the frame.
  //
  // Opacity still fades the effect in, because erasing 40% of the original
  // and drawing 40% of the result mixes the two exactly as AE does. Any
  // other blend mode means to combine with what is below, so it composites
  // over the original untouched.
  if (layer.blendMode === 'normal') {
    const coverage = pool.sized(scoped('adjustCoverage'), width, height);
    coverage.ctx.fillStyle = '#ffffff';
    coverage.ctx.fillRect(0, 0, width, height);
    applyMasks(coverage.ctx, layer, time, pool, scale, matrix, width, height);
    target.globalAlpha = opacity;
    target.globalCompositeOperation = 'destination-out';
    target.drawImage(coverage.canvas as CanvasImageSource, 0, 0);
  }

  target.globalAlpha = opacity;
  target.globalCompositeOperation = canvasBlendMode(layer.blendMode);
  target.drawImage(limited.canvas as CanvasImageSource, 0, 0);
  target.restore();
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
  // Nulls are parenting controls, not content.
  if (layer.type === 'null') return;

  const effects = activeEffects(layer);
  const needsBuffer = hasActiveMasks(layer) || effects.length > 0 || matteLayer !== undefined;
  const matrix = worldMatrix(comp, layer, time);

  if (!needsBuffer) {
    target.save();
    target.globalAlpha = opacity;
    target.globalCompositeOperation = canvasBlendMode(layer.blendMode);
    target.scale(scale, scale);
    target.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
    drawLayerContent(target, layer, time, scale);
    target.restore();
    return;
  }

  const rendered = renderLayerInLayerSpace(layer, time, scale, scoped('layer'));
  if (!rendered) return;

  if (!matteLayer) {
    target.save();
    target.globalAlpha = opacity;
    target.globalCompositeOperation = canvasBlendMode(layer.blendMode);
    target.scale(scale, scale);
    target.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
    drawBufferInLayerSpace(target, rendered);
    target.restore();
    return;
  }

  // A track matte lives in composition space, so the layer has to land there
  // before its alpha can be intersected with the matte's.
  const width = target.canvas.width;
  const height = target.canvas.height;
  const composed = pool.sized(scoped('layerComp'), width, height);
  composed.ctx.save();
  composed.ctx.scale(scale, scale);
  composed.ctx.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
  drawBufferInLayerSpace(composed.ctx, rendered);
  composed.ctx.restore();

  const matte = pool.sized(scoped('matte'), width, height);
  // The matte layer's own visibility switch is irrelevant — After Effects
  // turns it off when the matte is assigned — but its timing still counts.
  if (time >= matteLayer.inPoint && time < matteLayer.outPoint) {
    const matteRendered = renderLayerInLayerSpace(matteLayer, time, scale, scoped('matteSrc'));
    if (matteRendered) {
      const matteMatrix = worldMatrix(comp, matteLayer, time);
      matte.ctx.save();
      matte.ctx.globalAlpha = valueAtTime(matteLayer.transform.opacity, time) / 100;
      matte.ctx.scale(scale, scale);
      matte.ctx.transform(
        matteMatrix.a, matteMatrix.b, matteMatrix.c,
        matteMatrix.d, matteMatrix.e, matteMatrix.f,
      );
      drawBufferInLayerSpace(matte.ctx, matteRendered);
      matte.ctx.restore();
    }
  }
  applyTrackMatte(composed.ctx, matte, layer.trackMatte, pool);

  target.save();
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.globalAlpha = opacity;
  target.globalCompositeOperation = canvasBlendMode(layer.blendMode);
  target.drawImage(composed.canvas as CanvasImageSource, 0, 0);
  target.restore();
}

interface LayerRender {
  buffer: Buffer;
  /** The area of layer space the buffer covers. */
  bounds: { x: number; y: number; width: number; height: number };
}

/**
 * Draw a layer's content, masks and effects into a buffer in the layer's own
 * coordinates. Effects run before the transform, as they do in After Effects,
 * so a blur is a blur of the source rather than of the scaled result.
 */
function renderLayerInLayerSpace(
  layer: Layer,
  time: number,
  scale: number,
  prefix: string,
): LayerRender | null {
  const margin = effectMargin(layer, time);
  const base = layerBounds(layer);
  const bounds = {
    x: base.x - margin,
    y: base.y - margin,
    width: base.width + margin * 2,
    height: base.height + margin * 2,
  };
  if (bounds.width <= 0 || bounds.height <= 0) return null;

  const width = Math.max(1, Math.ceil(bounds.width * scale));
  const height = Math.max(1, Math.ceil(bounds.height * scale));

  const buffer = pool.sized(prefix, width, height);
  buffer.ctx.save();
  buffer.ctx.setTransform(scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale);
  drawLayerContent(buffer.ctx, layer, time, scale);
  buffer.ctx.restore();

  applyMasks(
    buffer.ctx, layer, time, pool, scale,
    translation(-bounds.x, -bounds.y), width, height,
  );

  // Time effects re-render the layer's content at another time into the same
  // working area, which is what lets Echo and Posterize Time exist at all.
  const sampleAtTime = (t: number): Buffer | null => {
    if (sampleDepth >= MAX_SAMPLE_DEPTH) return null;
    const sample = pool.sized(`${prefix}Sample${sampleDepth}`, width, height);
    sampleDepth += 1;
    try {
      sample.ctx.save();
      sample.ctx.setTransform(scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale);
      drawLayerContent(sample.ctx, layer, t, scale);
      sample.ctx.restore();
      applyMasks(
        sample.ctx, layer, t, pool, scale,
        translation(-bounds.x, -bounds.y), width, height,
      );
    } finally {
      sampleDepth -= 1;
    }
    return sample;
  };

  const result = runEffects(layer, time, buffer, width, height, scale, prefix, sampleAtTime);
  return { buffer: result, bounds };
}

/** Draw a layer-space buffer back at its place in layer coordinates. */
function drawBufferInLayerSpace(ctx: Ctx2D, rendered: LayerRender): void {
  ctx.drawImage(
    rendered.buffer.canvas as CanvasImageSource,
    rendered.bounds.x, rendered.bounds.y,
    rendered.bounds.width, rendered.bounds.height,
  );
}

/** Resolver for the composition currently being rendered, set per frame. */
let resolveComposition: ((id: Id) => Composition | undefined) | undefined;
/** Frame rate of the composition being rendered, for effects that need it. */
let currentFrameRate = 30;

/** Paint a layer's own content, with the layer transform already applied. */
function drawLayerContent(ctx: Ctx2D, layer: Layer, time: number, scale: number): void {
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
    case 'precomp':
      drawPrecompLayer(ctx, layer, time, scale);
      break;
    case 'media':
      drawMediaLayer(ctx, layer, time);
      break;
    default:
      break;
  }
}

/**
 * Imported footage. A still draws directly; a video is asked for the frame
 * at its source time and draws whichever frame it currently holds, so
 * scrubbing stays responsive and the viewer repaints once the seek lands.
 * Time Remapping works here for free, through `sourceTimeAt`.
 */
function drawMediaLayer(ctx: Ctx2D, layer: MediaLayer, time: number): void {
  requestFootageTime(layer.assetId, sourceTimeAt(layer, time));
  const drawable = footageDrawable(layer.assetId);
  if (!drawable) return;
  ctx.drawImage(drawable, 0, 0, layer.width, layer.height);
}

/**
 * A precomposition renders its source composition into its own frame and
 * draws that frame as the layer's content. Time Remapping, when it is on,
 * decides which frame of the source that is.
 */
function drawPrecompLayer(ctx: Ctx2D, layer: PrecompLayer, time: number, scale: number): void {
  const source = resolveComposition?.(layer.compId);
  if (!source || renderDepth >= MAX_PRECOMP_DEPTH) return;

  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const buffer = pool.sized(`precomp@${renderDepth}`, width, height);

  const sourceTime = Math.max(0, Math.min(source.duration, sourceTimeAt(layer, time)));

  renderDepth += 1;
  try {
    renderInto(
      buffer.ctx as CanvasRenderingContext2D, source, sourceTime, scale,
      // A nested composition contributes its own layers, not its background.
      false,
    );
  } finally {
    renderDepth -= 1;
  }

  ctx.drawImage(
    buffer.canvas as CanvasImageSource,
    0, 0, width, height,
    0, 0, source.width, source.height,
  );
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
