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

/** What a remap does when it reads outside the source. */
export type EdgeMode = 'transparent' | 'clamp' | 'wrap' | 'reflect';

/** How a remap reads between pixels. */
export type Sampling = 'linear' | 'nearest';

export interface RemapOptions {
  edges?: EdgeMode;
  /** Overrides `edges` for one axis — Polar Coordinates wraps only in angle. */
  edgesX?: EdgeMode;
  edgesY?: EdgeMode;
  sampling?: Sampling;
}

/**
 * Resample `source` into `dest` through a coordinate remap: for each output
 * pixel the callback returns where to read from. Used by the distortions.
 *
 * Reads are bilinear by default. Nearest-neighbour is a pixel apart from
 * where it should be, and on a moving distortion that error crawls along the
 * edges as stair-steps — the difference between a warp that looks rendered
 * and one that looks sampled. Effects that are meant to be blocky (Scatter's
 * hard grain) ask for `nearest` instead.
 */
export function remapPixels(
  source: Buffer,
  dest: Buffer,
  width: number,
  height: number,
  fn: (x: number, y: number, out: Float32Array) => void,
  options: RemapOptions | boolean = {},
): void {
  if (width <= 0 || height <= 0) return;
  // `true` used to mean wrap, before there were edge modes.
  const settings: RemapOptions = typeof options === 'boolean'
    ? { edges: options ? 'wrap' : 'transparent' }
    : options;
  const edgesX = settings.edgesX ?? settings.edges ?? 'transparent';
  const edgesY = settings.edgesY ?? settings.edges ?? 'transparent';
  const linear = (settings.sampling ?? 'linear') === 'linear';

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
      const i = (y * width + x) * 4;

      if (!linear) {
        const sx = wrapCoordinate(Math.round(coord[0]), width, edgesX);
        const sy = wrapCoordinate(Math.round(coord[1]), height, edgesY);
        if (sx < 0 || sy < 0) continue;
        const j = (sy * width + sx) * 4;
        dst[i] = src[j];
        dst[i + 1] = src[j + 1];
        dst[i + 2] = src[j + 2];
        dst[i + 3] = src[j + 3];
        continue;
      }

      const fx = Math.floor(coord[0]);
      const fy = Math.floor(coord[1]);
      const tx = coord[0] - fx;
      const ty = coord[1] - fy;

      // Fast path: the whole 2×2 sits inside the buffer, which is true for
      // all but the outermost pixels, so the edge rules cost nothing there.
      if (fx >= 0 && fy >= 0 && fx + 1 < width && fy + 1 < height) {
        const j = (fy * width + fx) * 4;
        const k = j + width * 4;
        const w00 = (1 - tx) * (1 - ty);
        const w10 = tx * (1 - ty);
        const w01 = (1 - tx) * ty;
        const w11 = tx * ty;
        dst[i] = src[j] * w00 + src[j + 4] * w10 + src[k] * w01 + src[k + 4] * w11;
        dst[i + 1] = src[j + 1] * w00 + src[j + 5] * w10 + src[k + 1] * w01 + src[k + 5] * w11;
        dst[i + 2] = src[j + 2] * w00 + src[j + 6] * w10 + src[k + 2] * w01 + src[k + 6] * w11;
        dst[i + 3] = src[j + 3] * w00 + src[j + 7] * w10 + src[k + 3] * w01 + src[k + 7] * w11;
        continue;
      }

      const x0 = wrapCoordinate(fx, width, edgesX);
      const x1 = wrapCoordinate(fx + 1, width, edgesX);
      const y0 = wrapCoordinate(fy, height, edgesY);
      const y1 = wrapCoordinate(fy + 1, height, edgesY);
      // Outside with transparent edges: the corner contributes nothing, so
      // the warp fades out over a pixel instead of ending on a hard step.
      if (x0 < 0 && x1 < 0) continue;
      if (y0 < 0 && y1 < 0) continue;

      for (let c = 0; c < 4; c += 1) {
        const p00 = sampleAt(src, width, x0, y0, c);
        const p10 = sampleAt(src, width, x1, y0, c);
        const p01 = sampleAt(src, width, x0, y1, c);
        const p11 = sampleAt(src, width, x1, y1, c);
        const top = p00 + (p10 - p00) * tx;
        const bottom = p01 + (p11 - p01) * tx;
        dst[i + c] = top + (bottom - top) * ty;
      }
    }
  }

  dest.ctx.putImageData(output, 0, 0);
}

/** A coordinate brought inside the buffer, or -1 when it falls outside. */
function wrapCoordinate(value: number, size: number, edges: EdgeMode): number {
  if (value >= 0 && value < size) return value;
  switch (edges) {
    case 'clamp':
      return value < 0 ? 0 : size - 1;
    case 'wrap':
      return ((value % size) + size) % size;
    case 'reflect': {
      const period = size * 2;
      const folded = ((value % period) + period) % period;
      return folded < size ? folded : period - 1 - folded;
    }
    default:
      return -1;
  }
}

function sampleAt(
  src: Uint8ClampedArray, width: number, x: number, y: number, channel: number,
): number {
  if (x < 0 || y < 0) return 0;
  return src[(y * width + x) * 4 + channel];
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

export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
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

/**
 * Deterministic hash in 0..1, the basis of the noise below.
 *
 * Integer mixing rather than `fract(sin(dot(...)) * 43758)`. Measured over
 * 20k samples the two are equally flat and equally uncorrelated, so the
 * reason to prefer this one is what happens near the origin: with the seed
 * and the channel both at zero the sine hash climbs — 0.00, 0.04, 0.13,
 * 0.24 — and a shake at the default seed starts with a drift built into it.
 * Mixing the bits has no such corner.
 */
export function hashNoise(x: number, y: number, z: number): number {
  let h = 0x9e3779b9;
  h = Math.imul(h ^ (Math.round(x * 1024) | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ (Math.round(y * 1024) | 0), 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h ^ (Math.round(z * 1024) | 0), 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Perlin's fade: zero first *and* second derivative at the ends. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function valueNoise(x: number, y: number, z = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = fade(x - xi);
  const yf = fade(y - yi);

  const a = hashNoise(xi, yi, z);
  const b = hashNoise(xi + 1, yi, z);
  const c = hashNoise(xi, yi + 1, z);
  const d = hashNoise(xi + 1, yi + 1, z);
  const top = a + (b - a) * xf;
  const bottom = c + (d - c) * xf;
  return top + (bottom - top) * yf;
}

/**
 * Gradient (Perlin) noise in 0..1.
 *
 * Value noise interpolates between random *values*, so its extremes sit on
 * the lattice and the result reads as a soft grid. Gradient noise
 * interpolates between random *slopes*, which puts the features between the
 * lattice points — the difference between noise that looks like cells and
 * noise that looks like cloud. The originals of Fractal Noise and Turbulent
 * Displace are built on this.
 */
export function gradientNoise(x: number, y: number, z = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = fade(xf);
  const v = fade(yf);

  const dot = (gx: number, gy: number, dx: number, dy: number) => gx * dx + gy * dy;
  const gradient = (ix: number, iy: number): [number, number] => {
    const angle = hashNoise(ix, iy, z) * Math.PI * 2;
    return [Math.cos(angle), Math.sin(angle)];
  };

  const g00 = gradient(xi, yi);
  const g10 = gradient(xi + 1, yi);
  const g01 = gradient(xi, yi + 1);
  const g11 = gradient(xi + 1, yi + 1);

  const n00 = dot(g00[0], g00[1], xf, yf);
  const n10 = dot(g10[0], g10[1], xf - 1, yf);
  const n01 = dot(g01[0], g01[1], xf, yf - 1);
  const n11 = dot(g11[0], g11[1], xf - 1, yf - 1);

  const top = n00 + (n10 - n00) * u;
  const bottom = n01 + (n11 - n01) * u;
  // Gradient noise lands in about ±0.7; this maps it to 0..1.
  return clamp01((top + (bottom - top) * v) * 0.7071 + 0.5);
}

/** How value noise interpolates between lattice points. */
export type NoiseInterp = 'block' | 'linear' | 'soft' | 'spline';

/** Value noise with a selectable interpolation, as Fractal Noise offers. */
export function latticeNoise(x: number, y: number, z: number, interp: NoiseInterp): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let xf = x - xi;
  let yf = y - yi;
  if (interp === 'block') return hashNoise(xi, yi, z);
  if (interp === 'soft') {
    xf = xf * xf * (3 - 2 * xf);
    yf = yf * yf * (3 - 2 * yf);
  } else if (interp === 'spline') {
    xf = fade(xf);
    yf = fade(yf);
  }
  const a = hashNoise(xi, yi, z);
  const b = hashNoise(xi + 1, yi, z);
  const c = hashNoise(xi, yi + 1, z);
  const d = hashNoise(xi + 1, yi + 1, z);
  const top = a + (b - a) * xf;
  const bottom = c + (d - c) * xf;
  return top + (bottom - top) * yf;
}

export interface FbmOptions {
  /** Interpolation for value noise; ignored by the gradient kind. */
  interp?: NoiseInterp;
  /** How much quieter each octave is than the last. 0.5 is the default. */
  gain?: number;
  /** How much finer each octave is than the last. 2 is the default. */
  lacunarity?: number;
  /** 'smooth' sums the noise; 'turbulent' sums its absolute value. */
  fractal?: 'smooth' | 'turbulent' | 'ridged';
  /** Gradient noise by default; value noise is blockier and cheaper. */
  kind?: 'gradient' | 'value';
}

/** Summed octaves of noise, each finer and quieter than the last. */
export function fbm(
  x: number, y: number, z: number, octaves: number, options: FbmOptions = {},
): number {
  const gain = options.gain ?? 0.5;
  const lacunarity = options.lacunarity ?? 2;
  const fractal = options.fractal ?? 'smooth';
  const interp = options.interp;
  const noise = options.kind === 'value'
    ? (x2: number, y2: number, z2: number) => latticeNoise(x2, y2, z2, interp ?? 'spline')
    : gradientNoise;

  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  for (let i = 0; i < octaves; i += 1) {
    const raw = noise(x * frequency, y * frequency, z + i * 7.31);
    let shaped = raw;
    if (fractal === 'turbulent') shaped = Math.abs(raw * 2 - 1);
    else if (fractal === 'ridged') shaped = 1 - Math.abs(raw * 2 - 1);
    value += shaped * amplitude;
    total += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return total === 0 ? 0 : value / total;
}

/** Summed octaves of value noise; kept for callers that want the old look. */
export function fractalNoise(x: number, y: number, z: number, octaves: number): number {
  return fbm(x, y, z, octaves, { kind: 'value' });
}

/**
 * Smooth 1D noise along time, interpolated with Catmull-Rom.
 *
 * Camera shake is judged by how it moves, not by how it looks in a frame:
 * linear interpolation between random values gives a velocity that jumps at
 * every lattice point, which reads as a mechanical tick. A cubic through four
 * points is continuous in velocity, so the motion settles and turns the way a
 * hand does.
 */
export function smoothNoise1D(t: number, channel: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const at = (n: number) => hashNoise(n, channel * 31.7, seed) * 2 - 1;
  const p0 = at(i - 1);
  const p1 = at(i);
  const p2 = at(i + 1);
  const p3 = at(i + 2);
  return 0.5 * (
    2 * p1
    + (p2 - p0) * f
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f
    + (3 * p1 - 3 * p2 + p3 - p0) * f * f * f
  );
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
