import {
  clamp01, copyBuffer, hashNoise, luminance, mapPixels, rgbToHsl, hslToRgb,
} from './pixels';
import { registerEffect } from './registry';

/** Noise & Grain. */

registerEffect({
  matchName: 'ADBE Noise',
  name: 'Noise',
  category: 'Noise & Grain',
  params: [
    { key: 'amount', name: 'Amount of Noise', kind: 'percent', default: 20, min: 0, max: 100, unit: '%' },
    { key: 'colour', name: 'Use Color Noise', kind: 'checkbox', default: 0 },
    { key: 'clip', name: 'Clip Result Values', kind: 'checkbox', default: 1 },
  ],
  apply: ({ source, dest, width, height, time, get }) => {
    const amount = (get<number>('amount') / 100) * 255;
    const colour = get<number>('colour') >= 0.5;
    const clip = get<number>('clip') >= 0.5;
    const seed = Math.round(time * 1000);

    mapPixels(source, dest, width, height, (r, g, b, a, x, y, out) => {
      const mono = (hashNoise(x, y, seed) - 0.5) * 2 * amount;
      const nr = colour ? (hashNoise(x + 1.3, y, seed) - 0.5) * 2 * amount : mono;
      const ng = colour ? (hashNoise(x, y + 2.7, seed) - 0.5) * 2 * amount : mono;
      const nb = colour ? (hashNoise(x + 5.1, y + 7.9, seed) - 0.5) * 2 * amount : mono;
      out[0] = clip ? Math.min(255, Math.max(0, r + nr)) : r + nr;
      out[1] = clip ? Math.min(255, Math.max(0, g + ng)) : g + ng;
      out[2] = clip ? Math.min(255, Math.max(0, b + nb)) : b + nb;
      out[3] = a;
    });
  },
});

registerEffect({
  matchName: 'ADBE Noise HLS2',
  name: 'Noise HLS',
  category: 'Noise & Grain',
  params: [
    { key: 'hue', name: 'Hue', kind: 'percent', default: 0, min: 0, max: 100, unit: '%' },
    { key: 'lightness', name: 'Lightness', kind: 'percent', default: 20, min: 0, max: 100, unit: '%' },
    { key: 'saturation', name: 'Saturation', kind: 'percent', default: 0, min: 0, max: 100, unit: '%' },
    { key: 'grainSize', name: 'Grain Size', kind: 'number', default: 1, min: 0.2, max: 8, speedPerPixel: 0.02 },
  ],
  apply: ({ source, dest, width, height, time, get }) => {
    const hueAmount = get<number>('hue') / 100;
    const lightAmount = get<number>('lightness') / 100;
    const satAmount = get<number>('saturation') / 100;
    const grain = Math.max(0.2, get<number>('grainSize'));
    const seed = Math.round(time * 1000);

    mapPixels(source, dest, width, height, (r, g, b, a, x, y, out) => {
      const gx = Math.floor(x / grain);
      const gy = Math.floor(y / grain);
      const [h, s, l] = rgbToHsl(r, g, b);
      const [nr, ng, nb] = hslToRgb(
        (h + (hashNoise(gx, gy, seed) - 0.5) * hueAmount + 1) % 1,
        clamp01(s + (hashNoise(gx + 3.7, gy, seed) - 0.5) * satAmount),
        clamp01(l + (hashNoise(gx, gy + 9.1, seed) - 0.5) * lightAmount),
      );
      out[0] = nr;
      out[1] = ng;
      out[2] = nb;
      out[3] = a;
    });
  },
});

registerEffect({
  matchName: 'ADBE Add Grain',
  name: 'Add Grain',
  category: 'Noise & Grain',
  params: [
    { key: 'intensity', name: 'Intensity', kind: 'number', default: 0.5, min: 0, max: 5, speedPerPixel: 0.01 },
    { key: 'size', name: 'Size', kind: 'number', default: 1, min: 0.2, max: 8, speedPerPixel: 0.02 },
    { key: 'softness', name: 'Softness', kind: 'number', default: 0.5, min: 0, max: 2, speedPerPixel: 0.01 },
    { key: 'shadows', name: 'Shadows', kind: 'number', default: 1, min: 0, max: 2, speedPerPixel: 0.01 },
    { key: 'midtones', name: 'Midtones', kind: 'number', default: 1, min: 0, max: 2, speedPerPixel: 0.01 },
    { key: 'highlights', name: 'Highlights', kind: 'number', default: 0.6, min: 0, max: 2, speedPerPixel: 0.01 },
  ],
  apply: ({ source, dest, width, height, time, get }) => {
    const intensity = get<number>('intensity') * 40;
    const size = Math.max(0.2, get<number>('size'));
    const softness = get<number>('softness');
    const shadows = get<number>('shadows');
    const midtones = get<number>('midtones');
    const highlights = get<number>('highlights');
    const seed = Math.round(time * 1000);

    mapPixels(source, dest, width, height, (r, g, b, a, x, y, out) => {
      const gx = x / size;
      const gy = y / size;
      // Softness blends the hard per-cell grain with its smoother neighbour.
      const hard = hashNoise(Math.floor(gx), Math.floor(gy), seed);
      const soft = hashNoise(Math.floor(gx / 2), Math.floor(gy / 2), seed);
      const n = (hard + (soft - hard) * clamp01(softness) - 0.5) * 2;

      // Film grain is strongest in the midtones and quietest in the highlights.
      const l = luminance(r, g, b) / 255;
      const weight = l < 0.5
        ? shadows + (midtones - shadows) * (l * 2)
        : midtones + (highlights - midtones) * ((l - 0.5) * 2);
      const offset = n * intensity * weight;

      out[0] = r + offset;
      out[1] = g + offset;
      out[2] = b + offset;
      out[3] = a;
    });
  },
});

registerEffect({
  matchName: 'ADBE Median',
  name: 'Median',
  category: 'Noise & Grain',
  params: [
    { key: 'radius', name: 'Radius', kind: 'number', default: 2, min: 1, max: 8 },
    { key: 'alphaToo', name: 'Operate on Alpha Channel', kind: 'checkbox', default: 0 },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const radius = Math.min(8, Math.max(1, Math.round(get<number>('radius'))));
    const withAlpha = get<number>('alphaToo') >= 0.5;
    const data = source.ctx.getImageData(0, 0, width, height).data;
    const window: number[] = [];

    // Median filtering removes speckles without softening edges the way a
    // blur would, which is why it is the classic de-noise pass.
    mapPixels(source, dest, width, height, (r, g, b, a, x, y, out) => {
      for (let channel = 0; channel < (withAlpha ? 4 : 3); channel += 1) {
        window.length = 0;
        for (let dy = -radius; dy <= radius; dy += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            const px = Math.min(width - 1, Math.max(0, x + dx));
            const py = Math.min(height - 1, Math.max(0, y + dy));
            window.push(data[(py * width + px) * 4 + channel]);
          }
        }
        window.sort((p, q) => p - q);
        out[channel] = window[window.length >> 1];
      }
      if (!withAlpha) out[3] = a;
      void r; void g; void b;
    });
  },
});

registerEffect({
  matchName: 'ADBE Dust & Scratches',
  name: 'Dust & Scratches',
  category: 'Noise & Grain',
  params: [
    { key: 'radius', name: 'Radius', kind: 'number', default: 2, min: 1, max: 8 },
    { key: 'threshold', name: 'Threshold', kind: 'number', default: 32, min: 0, max: 255 },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const radius = Math.min(8, Math.max(1, Math.round(get<number>('radius'))));
    const threshold = get<number>('threshold');
    const data = source.ctx.getImageData(0, 0, width, height).data;
    const window: number[] = [];

    // Only pixels that differ from their median by more than the threshold
    // are replaced, so detail survives while specks do not.
    mapPixels(source, dest, width, height, (r, g, b, a, x, y, out) => {
      const channels = [r, g, b];
      for (let channel = 0; channel < 3; channel += 1) {
        window.length = 0;
        for (let dy = -radius; dy <= radius; dy += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            const px = Math.min(width - 1, Math.max(0, x + dx));
            const py = Math.min(height - 1, Math.max(0, y + dy));
            window.push(data[(py * width + px) * 4 + channel]);
          }
        }
        window.sort((p, q) => p - q);
        const median = window[window.length >> 1];
        out[channel] = Math.abs(channels[channel] - median) > threshold
          ? median
          : channels[channel];
      }
      out[3] = a;
    });
  },
});

registerEffect({
  matchName: 'ADBE Minimax',
  name: 'Minimax',
  category: 'Channel',
  params: [
    { key: 'operation', name: 'Operation', kind: 'select', default: 0, options: ['Minimum', 'Maximum'] },
    { key: 'radius', name: 'Radius', kind: 'number', default: 2, min: 0, max: 16 },
    {
      key: 'channel', name: 'Channel', kind: 'select', default: 0,
      options: ['Color and Alpha', 'Color', 'Alpha'],
    },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const radius = Math.min(16, Math.max(0, Math.round(get<number>('radius'))));
    if (radius === 0) {
      copyBuffer(source, dest, width, height);
      return;
    }
    const minimum = Math.round(get<number>('operation')) === 0;
    const channelMode = Math.round(get<number>('channel'));
    const data = source.ctx.getImageData(0, 0, width, height).data;

    mapPixels(source, dest, width, height, (r, g, b, a, x, y, out) => {
      const values = [minimum ? 255 : 0, minimum ? 255 : 0, minimum ? 255 : 0, minimum ? 255 : 0];
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx * dx + dy * dy > radius * radius) continue;
          const px = Math.min(width - 1, Math.max(0, x + dx));
          const py = Math.min(height - 1, Math.max(0, y + dy));
          const i = (py * width + px) * 4;
          for (let c = 0; c < 4; c += 1) {
            values[c] = minimum ? Math.min(values[c], data[i + c]) : Math.max(values[c], data[i + c]);
          }
        }
      }
      const colour = channelMode !== 2;
      const alpha = channelMode !== 1;
      out[0] = colour ? values[0] : r;
      out[1] = colour ? values[1] : g;
      out[2] = colour ? values[2] : b;
      out[3] = alpha ? values[3] : a;
    });
  },
});
