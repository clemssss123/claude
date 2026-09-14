import type { Buffer, BufferPool } from '../buffers';
import type { RGBA } from '@/core/types';

/** Helpers shared by the pixel-level effects. */

export type PixelFn = (
  r: number, g: number, b: number, a: number,
  x: number, y: number,
) => void;

/**
 * Run a function over every pixel of `source`, writing into `dest`.
 * The callback writes through `out`, which avoids allocating per pixel.
 */
export function mapPixels(
  source: Buffer,
  dest: Buffer,
  width: number,
  height: number,
  fn: (r: number, g: number, b: number, a: number, x: number, y: number, out: Float32Array) => void,
): void {
  if (width <= 0 || height <= 0) return;
  const image = source.ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const out = new Float32Array(4);

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const x = p % width;
    const y = (p / width) | 0;
    out[0] = data[i];
    out[1] = data[i + 1];
    out[2] = data[i + 2];
    out[3] = data[i + 3];
    fn(data[i], data[i + 1], data[i + 2], data[i + 3], x, y, out);
    data[i] = clamp255(out[0]);
    data[i + 1] = clamp255(out[1]);
    data[i + 2] = clamp255(out[2]);
    data[i + 3] = clamp255(out[3]);
  }

  dest.ctx.putImageData(image, 0, 0);
}

/**
 * Resample `source` into `dest` through a coordinate remap: for each output
 * pixel the callback returns where to read from. Used by the distortions.
 */
export function remapPixels(
  source: Buffer,
  dest: Buffer,
  width: number,
  height: number,
  fn: (x: number, y: number, out: Float32Array) => void,
  wrap = false,
): void {
  if (width <= 0 || height <= 0) return;
  const input = source.ctx.getImageData(0, 0, width, height);
  const output = dest.ctx.createImageData(width, height);
  const src = input.data;
  const dst = output.data;
  const coord = new Float32Array(2);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      coord[0] = x;
      coord[1] = y;
      fn(x, y, coord);
      let sx = Math.round(coord[0]);
      let sy = Math.round(coord[1]);
      const i = (y * width + x) * 4;

      if (wrap) {
        sx = ((sx % width) + width) % width;
        sy = ((sy % height) + height) % height;
      } else if (sx < 0 || sy < 0 || sx >= width || sy >= height) {
        dst[i + 3] = 0;
        continue;
      }

      const j = (sy * width + sx) * 4;
      dst[i] = src[j];
      dst[i + 1] = src[j + 1];
      dst[i + 2] = src[j + 2];
      dst[i + 3] = src[j + 3];
    }
  }

  dest.ctx.putImageData(output, 0, 0);
}

export function copyBuffer(source: Buffer, dest: Buffer, width: number, height: number): void {
  dest.ctx.setTransform(1, 0, 0, 1, 0, 0);
  dest.ctx.globalAlpha = 1;
  dest.ctx.globalCompositeOperation = 'copy';
  dest.ctx.filter = 'none';
  dest.ctx.drawImage(source.canvas as CanvasImageSource, 0, 0);
  dest.ctx.globalCompositeOperation = 'source-over';
  void width;
  void height;
}

/** How far a squeeze may stretch a buffer when the blur axes differ. */
const MAX_BLUR_RATIO = 8;

/**
 * Blur `source` into `dest`. Canvas only offers an isotropic blur, so when
 * the two radii differ one axis is squeezed, blurred and stretched back.
 */
export function blurBuffer(
  source: Buffer,
  dest: Buffer,
  width: number,
  height: number,
  radiusX: number,
  radiusY: number,
  pool: BufferPool,
): void {
  if (radiusX <= 0.01 && radiusY <= 0.01) {
    copyBuffer(source, dest, width, height);
    return;
  }

  dest.ctx.setTransform(1, 0, 0, 1, 0, 0);
  dest.ctx.globalAlpha = 1;
  dest.ctx.globalCompositeOperation = 'copy';

  if (Math.abs(radiusX - radiusY) < 0.01 || radiusX <= 0.01 || radiusY <= 0.01) {
    dest.ctx.filter = `blur(${Math.max(radiusX, radiusY) / 2}px)`;
    dest.ctx.drawImage(source.canvas as CanvasImageSource, 0, 0);
  } else {
    const radius = Math.min(radiusX, radiusY);
    const squeezeX = clampRatio(radius / radiusX);
    const squeezeY = clampRatio(radius / radiusY);
    const squeezed = pool.sized('fxSqueeze', width * squeezeX, height * squeezeY);
    squeezed.ctx.drawImage(
      source.canvas as CanvasImageSource,
      0, 0, width, height,
      0, 0, width * squeezeX, height * squeezeY,
    );
    dest.ctx.filter = `blur(${radius / 2}px)`;
    dest.ctx.drawImage(
      squeezed.canvas as CanvasImageSource,
      0, 0, width * squeezeX, height * squeezeY,
      0, 0, width, height,
    );
  }

  dest.ctx.filter = 'none';
  dest.ctx.globalCompositeOperation = 'source-over';
}

function clampRatio(value: number): number {
  return Math.min(1, Math.max(1 / MAX_BLUR_RATIO, value));
}

export function clamp255(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Rec. 709 luminance of 0..255 channels. */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function rgbaTo255(color: RGBA): [number, number, number, number] {
  return [color[0] * 255, color[1] * 255, color[2] * 255, color[3] * 255];
}

// -- noise -----------------------------------------------------------------

/** Deterministic hash in 0..1, the basis of the value noise below. */
export function hashNoise(x: number, y: number, z: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
}

export function valueNoise(x: number, y: number, z = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smoothStep(x - xi);
  const yf = smoothStep(y - yi);

  const a = hashNoise(xi, yi, z);
  const b = hashNoise(xi + 1, yi, z);
  const c = hashNoise(xi, yi + 1, z);
  const d = hashNoise(xi + 1, yi + 1, z);
  const top = a + (b - a) * xf;
  const bottom = c + (d - c) * xf;
  return top + (bottom - top) * yf;
}

/** Summed octaves of value noise, each finer and quieter than the last. */
export function fractalNoise(x: number, y: number, z: number, octaves: number): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  for (let i = 0; i < octaves; i += 1) {
    value += valueNoise(x * frequency, y * frequency, z + i * 7.31) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / total;
}

/** Monotone-ish Catmull-Rom through evenly spaced control points. */
export function splineAt(points: number[], t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  const last = points.length - 1;
  const scaled = clamped * last;
  const i = Math.min(last - 1, Math.floor(scaled));
  const f = scaled - i;
  const p0 = points[Math.max(0, i - 1)];
  const p1 = points[i];
  const p2 = points[i + 1];
  const p3 = points[Math.min(last, i + 2)];
  return 0.5 * (
    2 * p1
    + (p2 - p0) * f
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f
    + (3 * p1 - 3 * p2 + p3 - p0) * f * f * f
  );
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    hueToChannel(p, q, h + 1 / 3) * 255,
    hueToChannel(p, q, h) * 255,
    hueToChannel(p, q, h - 1 / 3) * 255,
  ];
}

function hueToChannel(p: number, q: number, t: number): number {
  let x = t;
  if (x < 0) x += 1;
  if (x > 1) x -= 1;
  if (x < 1 / 6) return p + (q - p) * 6 * x;
  if (x < 1 / 2) return q;
  if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
  return p;
}
