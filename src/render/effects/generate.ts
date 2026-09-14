import { clamp01, mapPixels, rgbaTo255 } from './pixels';
import { registerEffect } from './registry';
import type { RGBA, Vec2 } from '@/core/types';

/** Generate and Noise. */

registerEffect({
  matchName: 'ADBE 4ColorGradient',
  name: '4-Color Gradient',
  category: 'Generate',
  params: [
    { key: 'p1', name: 'Point 1', kind: 'vec2', default: [-200, -200], dimensionNames: ['X', 'Y'] },
    { key: 'c1', name: 'Color 1', kind: 'color', default: [1, 0.2, 0.2, 1] },
    { key: 'p2', name: 'Point 2', kind: 'vec2', default: [200, -200], dimensionNames: ['X', 'Y'] },
    { key: 'c2', name: 'Color 2', kind: 'color', default: [0.2, 1, 0.4, 1] },
    { key: 'p3', name: 'Point 3', kind: 'vec2', default: [-200, 200], dimensionNames: ['X', 'Y'] },
    { key: 'c3', name: 'Color 3', kind: 'color', default: [0.2, 0.4, 1, 1] },
    { key: 'p4', name: 'Point 4', kind: 'vec2', default: [200, 200], dimensionNames: ['X', 'Y'] },
    { key: 'c4', name: 'Color 4', kind: 'color', default: [1, 0.9, 0.2, 1] },
    { key: 'blend', name: 'Blend', kind: 'number', default: 100, min: 1, max: 1000 },
    { key: 'opacity', name: 'Opacity', kind: 'percent', default: 100, min: 0, max: 100, unit: '%' },
  ],
  apply: ({ source, dest, width, height, scale, get }) => {
    const points = (['p1', 'p2', 'p3', 'p4'] as const).map((key) => {
      const p = get<Vec2>(key);
      return [width / 2 + p[0] * scale, height / 2 + p[1] * scale] as const;
    });
    const colors = (['c1', 'c2', 'c3', 'c4'] as const).map((key) => rgbaTo255(get<RGBA>(key)));
    const falloff = Math.max(1, get<number>('blend'));
    const opacity = get<number>('opacity') / 100;

    // Inverse-distance weighting: each point pulls colour towards itself.
    mapPixels(source, dest, width, height, (r, g, b, a, x, y, out) => {
      let wr = 0;
      let wg = 0;
      let wb = 0;
      let total = 0;
      for (let i = 0; i < 4; i += 1) {
        const distance = Math.hypot(x - points[i][0], y - points[i][1]);
        const weight = 1 / (1 + (distance / falloff) ** 2);
        wr += colors[i][0] * weight;
        wg += colors[i][1] * weight;
        wb += colors[i][2] * weight;
        total += weight;
      }
      out[0] = r + (wr / total - r) * opacity;
      out[1] = g + (wg / total - g) * opacity;
      out[2] = b + (wb / total - b) * opacity;
      out[3] = a;
    });
  },
});

registerEffect({
  matchName: 'ADBE Checkerboard',
  name: 'Checkerboard',
  category: 'Generate',
  params: [
    { key: 'anchor', name: 'Anchor', kind: 'vec2', default: [0, 0], dimensionNames: ['X', 'Y'] },
    { key: 'size', name: 'Size', kind: 'vec2', default: [80, 80], dimensionNames: ['Width', 'Height'] },
    { key: 'colour', name: 'Color', kind: 'color', default: [1, 1, 1, 1] },
    { key: 'opacity', name: 'Opacity', kind: 'percent', default: 100, min: 0, max: 100, unit: '%' },
  ],
  apply: ({ source, dest, width, height, scale, get }) => {
    const anchor = get<Vec2>('anchor');
    const size = get<Vec2>('size');
    const [cr, cg, cb] = rgbaTo255(get<RGBA>('colour'));
    const opacity = get<number>('opacity') / 100;
    const sw = Math.max(1, size[0] * scale);
    const sh = Math.max(1, size[1] * scale);
    const ax = anchor[0] * scale;
    const ay = anchor[1] * scale;

    mapPixels(source, dest, width, height, (r, g, b, a, x, y, out) => {
      const cx = Math.floor((x - ax) / sw);
      const cy = Math.floor((y - ay) / sh);
      const on = ((cx + cy) % 2 + 2) % 2 === 0;
      const amount = on ? opacity : 0;
      out[0] = r + (cr - r) * amount;
      out[1] = g + (cg - g) * amount;
      out[2] = b + (cb - b) * amount;
      out[3] = a + (255 - a) * amount;
    });
  },
});

registerEffect({
  matchName: 'ADBE Grid',
  name: 'Grid',
  category: 'Generate',
  params: [
    { key: 'anchor', name: 'Anchor', kind: 'vec2', default: [0, 0], dimensionNames: ['X', 'Y'] },
    { key: 'size', name: 'Size', kind: 'vec2', default: [100, 100], dimensionNames: ['Width', 'Height'] },
    { key: 'border', name: 'Border', kind: 'number', default: 4, min: 0 },
    { key: 'colour', name: 'Color', kind: 'color', default: [1, 1, 1, 1] },
    { key: 'opacity', name: 'Opacity', kind: 'percent', default: 100, min: 0, max: 100, unit: '%' },
    { key: 'invert', name: 'Invert Grid', kind: 'checkbox', default: 0 },
  ],
  apply: ({ source, dest, width, height, scale, get }) => {
    const anchor = get<Vec2>('anchor');
    const size = get<Vec2>('size');
    const border = Math.max(0, get<number>('border') * scale);
    const [cr, cg, cb] = rgbaTo255(get<RGBA>('colour'));
    const opacity = get<number>('opacity') / 100;
    const invert = get<number>('invert') >= 0.5;
    const sw = Math.max(1, size[0] * scale);
    const sh = Math.max(1, size[1] * scale);

    mapPixels(source, dest, width, height, (r, g, b, a, x, y, out) => {
      const fx = mod(x - anchor[0] * scale, sw);
      const fy = mod(y - anchor[1] * scale, sh);
      const onLine = fx < border || fy < border;
      const amount = (invert ? !onLine : onLine) ? opacity : 0;
      out[0] = r + (cr - r) * amount;
      out[1] = g + (cg - g) * amount;
      out[2] = b + (cb - b) * amount;
      out[3] = a + (255 - a) * amount;
    });
  },
});

registerEffect({
  matchName: 'ADBE Fractal Noise',
  name: 'Fractal Noise',
  category: 'Noise & Grain',
  params: [
    { key: 'contrast', name: 'Contrast', kind: 'percent', default: 100, min: 0, max: 400, unit: '%' },
    { key: 'brightness', name: 'Brightness', kind: 'number', default: 0, min: -200, max: 200 },
    { key: 'scaleAmount', name: 'Scale', kind: 'percent', default: 100, min: 1, max: 1000, unit: '%' },
    { key: 'complexity', name: 'Complexity', kind: 'number', default: 4, min: 1, max: 8 },
    { key: 'evolution', name: 'Evolution', kind: 'angle', default: 0, unit: '°' },
    { key: 'offset', name: 'Offset Turbulence', kind: 'vec2', default: [0, 0], dimensionNames: ['X', 'Y'] },
    { key: 'invert', name: 'Invert', kind: 'checkbox', default: 0 },
    { key: 'opacity', name: 'Opacity', kind: 'percent', default: 100, min: 0, max: 100, unit: '%' },
  ],
  apply: ({ source, dest, width, height, scale, get }) => {
    const contrast = get<number>('contrast') / 100;
    const brightness = get<number>('brightness');
    const noiseScale = Math.max(1, get<number>('scaleAmount')) * scale;
    const octaves = Math.max(1, Math.min(8, Math.round(get<number>('complexity'))));
    const evolution = get<number>('evolution') / 360;
    const offset = get<Vec2>('offset');
    const invert = get<number>('invert') >= 0.5;
    const opacity = get<number>('opacity') / 100;

    mapPixels(source, dest, width, height, (r, g, b, a, x, y, out) => {
      const nx = (x + offset[0] * scale) / noiseScale;
      const ny = (y + offset[1] * scale) / noiseScale;
      let value = fractalNoise(nx, ny, evolution, octaves);
      if (invert) value = 1 - value;
      const level = clamp01((value - 0.5) * contrast + 0.5) * 255 + brightness;
      out[0] = r + (level - r) * opacity;
      out[1] = g + (level - g) * opacity;
      out[2] = b + (level - b) * opacity;
      out[3] = a + (255 - a) * opacity;
    });
  },
});

function mod(value: number, m: number): number {
  return ((value % m) + m) % m;
}

/** Deterministic hash in 0..1 — the basis of the value noise below. */
function hash(x: number, y: number, z: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);

  const a = hash(xi, yi, z);
  const b = hash(xi + 1, yi, z);
  const c = hash(xi, yi + 1, z);
  const d = hash(xi + 1, yi + 1, z);
  return (a + (b - a) * xf) + ((c + (d - c) * xf) - (a + (b - a) * xf)) * yf;
}

/** Summed octaves of value noise, each finer and quieter than the last. */
function fractalNoise(x: number, y: number, z: number, octaves: number): number {
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
