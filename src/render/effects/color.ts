import {
  clamp01, hslToRgb, luminance, mapPixels, rgbToHsl, rgbaTo255,
} from './pixels';
import { registerEffect } from './registry';
import type { RGBA, Vec2 } from '@/core/types';

/** Color Correction. */

registerEffect({
  matchName: 'ADBE Brightness & Contrast 2',
  name: 'Brightness & Contrast',
  category: 'Color Correction',
  params: [
    { key: 'brightness', name: 'Brightness', kind: 'number', default: 0, min: -150, max: 150 },
    { key: 'contrast', name: 'Contrast', kind: 'number', default: 0, min: -50, max: 100 },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const brightness = get<number>('brightness');
    const contrast = get<number>('contrast');
    // Standard contrast pivot at mid grey.
    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    mapPixels(source, dest, width, height, (r, g, b, a, _x, _y, out) => {
      out[0] = factor * (r - 128) + 128 + brightness;
      out[1] = factor * (g - 128) + 128 + brightness;
      out[2] = factor * (b - 128) + 128 + brightness;
      out[3] = a;
    });
  },
});

registerEffect({
  matchName: 'ADBE Easy Levels2',
  name: 'Levels',
  category: 'Color Correction',
  params: [
    { key: 'inputBlack', name: 'Input Black', kind: 'number', default: 0, min: 0, max: 255 },
    { key: 'inputWhite', name: 'Input White', kind: 'number', default: 255, min: 0, max: 255 },
    { key: 'gamma', name: 'Gamma', kind: 'number', default: 1, min: 0.1, max: 10, speedPerPixel: 0.02 },
    { key: 'outputBlack', name: 'Output Black', kind: 'number', default: 0, min: 0, max: 255 },
    { key: 'outputWhite', name: 'Output White', kind: 'number', default: 255, min: 0, max: 255 },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const inBlack = get<number>('inputBlack');
    const inWhite = get<number>('inputWhite');
    const gamma = Math.max(0.01, get<number>('gamma'));
    const outBlack = get<number>('outputBlack');
    const outWhite = get<number>('outputWhite');

    // One lookup table beats recomputing the curve three times per pixel.
    const lut = new Uint8ClampedArray(256);
    const span = Math.max(1e-6, inWhite - inBlack);
    for (let i = 0; i < 256; i += 1) {
      const normalized = clamp01((i - inBlack) / span);
      const corrected = normalized ** (1 / gamma);
      lut[i] = outBlack + corrected * (outWhite - outBlack);
    }

    mapPixels(source, dest, width, height, (r, g, b, a, _x, _y, out) => {
      out[0] = lut[r];
      out[1] = lut[g];
      out[2] = lut[b];
      out[3] = a;
    });
  },
});

registerEffect({
  matchName: 'ADBE HUE SATURATION',
  name: 'Hue/Saturation',
  category: 'Color Correction',
  params: [
    { key: 'hue', name: 'Master Hue', kind: 'angle', default: 0, unit: '°' },
    { key: 'saturation', name: 'Master Saturation', kind: 'number', default: 0, min: -100, max: 100 },
    { key: 'lightness', name: 'Master Lightness', kind: 'number', default: 0, min: -100, max: 100 },
    { key: 'colorize', name: 'Colorize', kind: 'checkbox', default: 0 },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const hueShift = get<number>('hue') / 360;
    const satShift = get<number>('saturation') / 100;
    const lightShift = get<number>('lightness') / 100;
    const colorize = get<number>('colorize') >= 0.5;

    mapPixels(source, dest, width, height, (r, g, b, a, _x, _y, out) => {
      const [h, s, l] = rgbToHsl(r, g, b);
      const hue = colorize ? clamp01(hueShift < 0 ? hueShift + 1 : hueShift) : (h + hueShift + 1) % 1;
      const saturation = colorize
        ? clamp01(0.5 + satShift)
        : clamp01(satShift >= 0 ? s + (1 - s) * satShift : s * (1 + satShift));
      const lightness = clamp01(
        lightShift >= 0 ? l + (1 - l) * lightShift : l * (1 + lightShift),
      );
      const [nr, ng, nb] = hslToRgb(hue, saturation, lightness);
      out[0] = nr;
      out[1] = ng;
      out[2] = nb;
      out[3] = a;
    });
  },
});

registerEffect({
  matchName: 'ADBE Exposure2',
  name: 'Exposure',
  category: 'Color Correction',
  params: [
    { key: 'exposure', name: 'Exposure', kind: 'number', default: 0, min: -20, max: 20, speedPerPixel: 0.05 },
    { key: 'offset', name: 'Offset', kind: 'number', default: 0, min: -0.5, max: 0.5, speedPerPixel: 0.005 },
    { key: 'gamma', name: 'Gamma Correction', kind: 'number', default: 1, min: 0.01, max: 10, speedPerPixel: 0.02 },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const gain = 2 ** get<number>('exposure');
    const offset = get<number>('offset') * 255;
    const gamma = Math.max(0.01, get<number>('gamma'));

    const lut = new Float32Array(256);
    for (let i = 0; i < 256; i += 1) {
      lut[i] = (clamp01((i / 255) * gain + offset / 255) ** (1 / gamma)) * 255;
    }

    mapPixels(source, dest, width, height, (r, g, b, a, _x, _y, out) => {
      out[0] = lut[r];
      out[1] = lut[g];
      out[2] = lut[b];
      out[3] = a;
    });
  },
});

registerEffect({
  matchName: 'ADBE Tint',
  name: 'Tint',
  category: 'Color Correction',
  params: [
    { key: 'black', name: 'Map Black To', kind: 'color', default: [0, 0, 0, 1] },
    { key: 'white', name: 'Map White To', kind: 'color', default: [1, 1, 1, 1] },
    { key: 'amount', name: 'Amount to Tint', kind: 'percent', default: 100, min: 0, max: 100, unit: '%' },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const [br, bg, bb] = rgbaTo255(get<RGBA>('black'));
    const [wr, wg, wb] = rgbaTo255(get<RGBA>('white'));
    const amount = get<number>('amount') / 100;

    mapPixels(source, dest, width, height, (r, g, b, a, _x, _y, out) => {
      const t = luminance(r, g, b) / 255;
      out[0] = r + (br + (wr - br) * t - r) * amount;
      out[1] = g + (bg + (wg - bg) * t - g) * amount;
      out[2] = b + (bb + (wb - bb) * t - b) * amount;
      out[3] = a;
    });
  },
});

registerEffect({
  matchName: 'ADBE Tritone',
  name: 'Tritone',
  category: 'Color Correction',
  params: [
    { key: 'highlights', name: 'Highlights', kind: 'color', default: [1, 1, 1, 1] },
    { key: 'midtones', name: 'Midtones', kind: 'color', default: [0.5, 0.35, 0.8, 1] },
    { key: 'shadows', name: 'Shadows', kind: 'color', default: [0, 0, 0, 1] },
    { key: 'amount', name: 'Blend With Original', kind: 'percent', default: 0, min: 0, max: 100, unit: '%' },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const high = rgbaTo255(get<RGBA>('highlights'));
    const mid = rgbaTo255(get<RGBA>('midtones'));
    const low = rgbaTo255(get<RGBA>('shadows'));
    const blend = get<number>('amount') / 100;

    mapPixels(source, dest, width, height, (r, g, b, a, _x, _y, out) => {
      const t = luminance(r, g, b) / 255;
      // Shadows to midtones below half, midtones to highlights above.
      const k = t < 0.5 ? t * 2 : (t - 0.5) * 2;
      const from = t < 0.5 ? low : mid;
      const to = t < 0.5 ? mid : high;
      out[0] = r * blend + (from[0] + (to[0] - from[0]) * k) * (1 - blend);
      out[1] = g * blend + (from[1] + (to[1] - from[1]) * k) * (1 - blend);
      out[2] = b * blend + (from[2] + (to[2] - from[2]) * k) * (1 - blend);
      out[3] = a;
    });
  },
});

registerEffect({
  matchName: 'ADBE Invert',
  name: 'Invert',
  category: 'Channel',
  params: [
    { key: 'amount', name: 'Blend With Original', kind: 'percent', default: 0, min: 0, max: 100, unit: '%' },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const blend = get<number>('amount') / 100;
    mapPixels(source, dest, width, height, (r, g, b, a, _x, _y, out) => {
      out[0] = r * blend + (255 - r) * (1 - blend);
      out[1] = g * blend + (255 - g) * (1 - blend);
      out[2] = b * blend + (255 - b) * (1 - blend);
      out[3] = a;
    });
  },
});

registerEffect({
  matchName: 'ADBE Fill',
  name: 'Fill',
  category: 'Generate',
  params: [
    { key: 'color', name: 'Color', kind: 'color', default: [1, 0.2, 0.2, 1] },
    { key: 'opacity', name: 'Opacity', kind: 'percent', default: 100, min: 0, max: 100, unit: '%' },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const [r, g, b] = rgbaTo255(get<RGBA>('color'));
    const opacity = get<number>('opacity') / 100;
    // Fill replaces colour but keeps the layer's own shape.
    mapPixels(source, dest, width, height, (_r, _g, _b, a, _x, _y, out) => {
      out[0] = r;
      out[1] = g;
      out[2] = b;
      out[3] = a * opacity;
    });
  },
});

registerEffect({
  matchName: 'ADBE Ramp',
  name: 'Gradient Ramp',
  category: 'Generate',
  params: [
    { key: 'start', name: 'Start of Ramp', kind: 'vec2', default: [0, -200], dimensionNames: ['X', 'Y'] },
    { key: 'startColor', name: 'Start Color', kind: 'color', default: [0, 0, 0, 1] },
    { key: 'end', name: 'End of Ramp', kind: 'vec2', default: [0, 200], dimensionNames: ['X', 'Y'] },
    { key: 'endColor', name: 'End Color', kind: 'color', default: [1, 1, 1, 1] },
    { key: 'shape', name: 'Ramp Shape', kind: 'select', default: 0, options: ['Linear Ramp', 'Radial Ramp'] },
    { key: 'blend', name: 'Blend With Original', kind: 'percent', default: 0, min: 0, max: 100, unit: '%' },
  ],
  apply: ({ source, dest, width, height, scale, get }) => {
    const start = get<Vec2>('start');
    const end = get<Vec2>('end');
    const startColor = get<RGBA>('startColor');
    const endColor = get<RGBA>('endColor');
    const radial = Math.round(get<number>('shape')) === 1;
    const blend = get<number>('blend') / 100;

    const sx = width / 2 + start[0] * scale;
    const sy = height / 2 + start[1] * scale;
    const ex = width / 2 + end[0] * scale;
    const ey = height / 2 + end[1] * scale;

    dest.ctx.setTransform(1, 0, 0, 1, 0, 0);
    dest.ctx.globalCompositeOperation = 'copy';
    dest.ctx.globalAlpha = 1;
    dest.ctx.drawImage(source.canvas as CanvasImageSource, 0, 0);
    dest.ctx.globalCompositeOperation = 'source-over';

    const gradient = radial
      ? dest.ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.hypot(ex - sx, ey - sy) || 1)
      : dest.ctx.createLinearGradient(sx, sy, ex, ey);
    gradient.addColorStop(0, cssColor(startColor));
    gradient.addColorStop(1, cssColor(endColor));

    dest.ctx.globalAlpha = 1 - blend;
    dest.ctx.fillStyle = gradient;
    dest.ctx.fillRect(0, 0, width, height);
    dest.ctx.globalAlpha = 1;
  },
});

function cssColor(color: RGBA): string {
  const to255 = (v: number) => Math.round(clamp01(v) * 255);
  return `rgba(${to255(color[0])}, ${to255(color[1])}, ${to255(color[2])}, ${color[3]})`;
}
