import type { TrackMatteType } from '@/core/types';
import type { Buffer, BufferPool } from './buffers';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Rec. 709 luma weights, the same ones After Effects uses for luma mattes. */
const LUMA = [0.2126, 0.7152, 0.0722];

/**
 * Apply the layer above as a track matte.
 *
 * Alpha mattes are a straight composite; luma mattes need the matte's
 * brightness moved into its alpha channel first, which is a pixel pass. The
 * WebGL pipeline in a later phase turns that into a shader, but the result
 * has to be right before it can be fast.
 */
export function applyTrackMatte(
  layerCtx: Ctx2D,
  matte: Buffer,
  type: TrackMatteType,
  pool: BufferPool,
): void {
  if (type === 'none') return;

  const source = type === 'luma' || type === 'luma-inverted'
    ? lumaToAlpha(matte, pool)
    : matte;

  const inverted = type === 'alpha-inverted' || type === 'luma-inverted';

  layerCtx.save();
  layerCtx.setTransform(1, 0, 0, 1, 0, 0);
  layerCtx.globalAlpha = 1;
  layerCtx.globalCompositeOperation = inverted ? 'destination-out' : 'destination-in';
  layerCtx.drawImage(source.canvas as CanvasImageSource, 0, 0);
  layerCtx.restore();
}

function lumaToAlpha(matte: Buffer, pool: BufferPool): Buffer {
  const { canvas } = matte;
  const width = canvas.width;
  const height = canvas.height;
  if (width === 0 || height === 0) return matte;

  const image = matte.ctx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    // Transparent areas of the matte are black, as they are over a black comp.
    const luma = (LUMA[0] * data[i] + LUMA[1] * data[i + 1] + LUMA[2] * data[i + 2]) * alpha;
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = Math.round(Math.min(255, Math.max(0, luma)));
  }

  const out = pool.clear('matteLuma');
  out.ctx.putImageData(image, 0, 0);
  return out;
}
