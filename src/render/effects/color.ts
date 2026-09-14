import {
  clamp01, copyBuffer, hslToRgb, luminance, mapPixels, rgbToHsl, rgbaTo255, splineAt,
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

registerEffect({
  matchName: 'ADBE CurvesCustom',
  name: 'Curves',
  category: 'Color Correction',
  params: [
    { key: 'black', name: 'Black', kind: 'number', default: 0, min: 0, max: 255 },
    { key: 'shadows', name: 'Shadows', kind: 'number', default: 64, min: 0, max: 255 },
    { key: 'midtones', name: 'Midtones', kind: 'number', default: 128, min: 0, max: 255 },
    { key: 'highlights', name: 'Highlights', kind: 'number', default: 192, min: 0, max: 255 },
    { key: 'white', name: 'White', kind: 'number', default: 255, min: 0, max: 255 },
    {
      key: 'channel',
      name: 'Channel',
      kind: 'select',
      default: 0,
      options: ['RGB', 'Red', 'Green', 'Blue', 'Alpha'],
    },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const points = [
      get<number>('black'), get<number>('shadows'), get<number>('midtones'),
      get<number>('highlights'), get<number>('white'),
    ];
    const channel = Math.round(get<number>('channel'));

    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i += 1) lut[i] = splineAt(points, i / 255);

    mapPixels(source, dest, width, height, (r, g, b, a, _x, _y, out) => {
      out[0] = channel === 0 || channel === 1 ? lut[r] : r;
      out[1] = channel === 0 || channel === 2 ? lut[g] : g;
      out[2] = channel === 0 || channel === 3 ? lut[b] : b;
      out[3] = channel === 4 ? lut[a] : a;
    });
  },
});

registerEffect({
  matchName: 'ADBE Vibrance',
  name: 'Vibrance',
  category: 'Color Correction',
  params: [
    { key: 'vibrance', name: 'Vibrance', kind: 'number', default: 0, min: -100, max: 100 },
    { key: 'saturation', name: 'Saturation', kind: 'number', default: 0, min: -100, max: 100 },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const vibrance = get<number>('vibrance') / 100;
    const saturation = get<number>('saturation') / 100;

    mapPixels(source, dest, width, height, (r, g, b, a, _x, _y, out) => {
      const [h, s, l] = rgbToHsl(r, g, b);
      // Vibrance leans on the least saturated pixels, so skin stays natural.
      const gentle = vibrance * (1 - s);
      const next = clamp01(s + (1 - s) * Math.max(0, gentle + saturation)
        + s * Math.min(0, gentle + saturation));
      const [nr, ng, nb] = hslToRgb(h, next, l);
      out[0] = nr;
      out[1] = ng;
      out[2] = nb;
      out[3] = a;
    });
  },
});

registerEffect({
  matchName: 'ADBE ChannelMixer',
  name: 'Channel Mixer',
  category: 'Channel',
  params: [
    { key: 'rr', name: 'Red-Red', kind: 'percent', default: 100, min: -200, max: 200, unit: '%' },
    { key: 'rg', name: 'Red-Green', kind: 'percent', default: 0, min: -200, max: 200, unit: '%' },
    { key: 'rb', name: 'Red-Blue', kind: 'percent', default: 0, min: -200, max: 200, unit: '%' },
    { key: 'gr', name: 'Green-Red', kind: 'percent', default: 0, min: -200, max: 200, unit: '%' },
    { key: 'gg', name: 'Green-Green', kind: 'percent', default: 100, min: -200, max: 200, unit: '%' },
    { key: 'gb', name: 'Green-Blue', kind: 'percent', default: 0, min: -200, max: 200, unit: '%' },
    { key: 'br', name: 'Blue-Red', kind: 'percent', default: 0, min: -200, max: 200, unit: '%' },
    { key: 'bg', name: 'Blue-Green', kind: 'percent', default: 0, min: -200, max: 200, unit: '%' },
    { key: 'bb', name: 'Blue-Blue', kind: 'percent', default: 100, min: -200, max: 200, unit: '%' },
    { key: 'monochrome', name: 'Monochrome', kind: 'checkbox', default: 0 },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const m = ['rr', 'rg', 'rb', 'gr', 'gg', 'gb', 'br', 'bg', 'bb']
      .map((key) => get<number>(key) / 100);
    const monochrome = get<number>('monochrome') >= 0.5;

    mapPixels(source, dest, width, height, (r, g, b, a, _x, _y, out) => {
      const nr = r * m[0] + g * m[1] + b * m[2];
      const ng = r * m[3] + g * m[4] + b * m[5];
      const nb = r * m[6] + g * m[7] + b * m[8];
      if (monochrome) {
        out[0] = nr;
        out[1] = nr;
        out[2] = nr;
      } else {
        out[0] = nr;
        out[1] = ng;
        out[2] = nb;
      }
      out[3] = a;
    });
  },
});

registerEffect({
  matchName: 'ADBE Color Balance (HLS)',
  name: 'Color Balance (HLS)',
  category: 'Color Correction',
  params: [
    { key: 'hue', name: 'Hue', kind: 'angle', default: 0, unit: '°' },
    { key: 'lightness', name: 'Lightness', kind: 'number', default: 0, min: -100, max: 100 },
    { key: 'saturation', name: 'Saturation', kind: 'number', default: 0, min: -100, max: 100 },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const hue = get<number>('hue') / 360;
    const lightness = get<number>('lightness') / 100;
    const saturation = get<number>('saturation') / 100;

    mapPixels(source, dest, width, height, (r, g, b, a, _x, _y, out) => {
      const [h, s, l] = rgbToHsl(r, g, b);
      const [nr, ng, nb] = hslToRgb(
        (h + hue + 1) % 1,
        clamp01(saturation >= 0 ? s + (1 - s) * saturation : s * (1 + saturation)),
        clamp01(lightness >= 0 ? l + (1 - l) * lightness : l * (1 + lightness)),
      );
      out[0] = nr;
      out[1] = ng;
      out[2] = nb;
      out[3] = a;
    });
  },
});

registerEffect({
  matchName: 'ADBE Photo Filter',
  name: 'Photo Filter',
  category: 'Color Correction',
  params: [
    { key: 'colour', name: 'Color', kind: 'color', default: [0.92, 0.6, 0.2, 1] },
    { key: 'density', name: 'Density', kind: 'percent', default: 25, min: 0, max: 100, unit: '%' },
    { key: 'preserveLuminosity', name: 'Preserve Luminosity', kind: 'checkbox', default: 1 },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const [fr, fg, fb] = rgbaTo255(get<RGBA>('colour'));
    const density = get<number>('density') / 100;
    const preserve = get<number>('preserveLuminosity') >= 0.5;

    mapPixels(source, dest, width, height, (r, g, b, a, _x, _y, out) => {
      // A photo filter multiplies towards the filter colour.
      let nr = r * (1 - density) + ((r * fr) / 255) * density;
      let ng = g * (1 - density) + ((g * fg) / 255) * density;
      let nb = b * (1 - density) + ((b * fb) / 255) * density;
      if (preserve) {
        const before = luminance(r, g, b);
        const after = luminance(nr, ng, nb);
        const ratio = after === 0 ? 1 : before / after;
        nr *= ratio;
        ng *= ratio;
        nb *= ratio;
      }
      out[0] = nr;
      out[1] = ng;
      out[2] = nb;
      out[3] = a;
    });
  },
});

registerEffect({
  matchName: 'ADBE Change To Color',
  name: 'Change to Color',
  category: 'Color Correction',
  params: [
    { key: 'from', name: 'From', kind: 'color', default: [1, 0, 0, 1] },
    { key: 'to', name: 'To', kind: 'color', default: [0, 0.6, 1, 1] },
    { key: 'tolerance', name: 'Tolerance', kind: 'number', default: 60, min: 0, max: 442 },
    { key: 'softness', name: 'Softness', kind: 'number', default: 40, min: 0.001, max: 442 },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const [fr, fg, fb] = rgbaTo255(get<RGBA>('from'));
    const [tr, tg, tb] = rgbaTo255(get<RGBA>('to'));
    const tolerance = get<number>('tolerance');
    const softness = Math.max(0.001, get<number>('softness'));
    const dr = tr - fr;
    const dg = tg - fg;
    const db = tb - fb;

    mapPixels(source, dest, width, height, (r, g, b, a, _x, _y, out) => {
      const distance = Math.hypot(r - fr, g - fg, b - fb);
      const match = 1 - clamp01((distance - tolerance) / softness);
      if (match <= 0) return;
      out[0] = r + dr * match;
      out[1] = g + dg * match;
      out[2] = b + db * match;
      out[3] = a;
    });
  },
});

registerEffect({
  matchName: 'ADBE Black&White',
  name: 'Black & White',
  category: 'Color Correction',
  params: [
    { key: 'reds', name: 'Reds', kind: 'number', default: 40, min: -200, max: 300 },
    { key: 'greens', name: 'Greens', kind: 'number', default: 60, min: -200, max: 300 },
    { key: 'blues', name: 'Blues', kind: 'number', default: 20, min: -200, max: 300 },
    { key: 'tintColour', name: 'Tint Color', kind: 'color', default: [1, 0.9, 0.75, 1] },
    { key: 'tintAmount', name: 'Tint', kind: 'percent', default: 0, min: 0, max: 100, unit: '%' },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const wr = get<number>('reds') / 100;
    const wg = get<number>('greens') / 100;
    const wb = get<number>('blues') / 100;
    const [tr, tg, tb] = rgbaTo255(get<RGBA>('tintColour'));
    const tint = get<number>('tintAmount') / 100;

    mapPixels(source, dest, width, height, (r, g, b, a, _x, _y, out) => {
      const grey = r * wr + g * wg + b * wb;
      out[0] = grey + ((grey * tr) / 255 - grey) * tint;
      out[1] = grey + ((grey * tg) / 255 - grey) * tint;
      out[2] = grey + ((grey * tb) / 255 - grey) * tint;
      out[3] = a;
    });
  },
});

registerEffect({
  matchName: 'ADBE Shift Channels',
  name: 'Shift Channels',
  category: 'Channel',
  params: [
    {
      key: 'red', name: 'Take Red From', kind: 'select', default: 1,
      options: ['Alpha', 'Red', 'Green', 'Blue', 'Luminance', 'Full On', 'Full Off'],
    },
    {
      key: 'green', name: 'Take Green From', kind: 'select', default: 2,
      options: ['Alpha', 'Red', 'Green', 'Blue', 'Luminance', 'Full On', 'Full Off'],
    },
    {
      key: 'blue', name: 'Take Blue From', kind: 'select', default: 3,
      options: ['Alpha', 'Red', 'Green', 'Blue', 'Luminance', 'Full On', 'Full Off'],
    },
    {
      key: 'alpha', name: 'Take Alpha From', kind: 'select', default: 0,
      options: ['Alpha', 'Red', 'Green', 'Blue', 'Luminance', 'Full On', 'Full Off'],
    },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const pick = (which: number, r: number, g: number, b: number, a: number): number => {
      switch (Math.round(which)) {
        case 0: return a;
        case 1: return r;
        case 2: return g;
        case 3: return b;
        case 4: return luminance(r, g, b);
        case 5: return 255;
        default: return 0;
      }
    };
    const sources = [get<number>('red'), get<number>('green'), get<number>('blue'), get<number>('alpha')];

    mapPixels(source, dest, width, height, (r, g, b, a, _x, _y, out) => {
      out[0] = pick(sources[0], r, g, b, a);
      out[1] = pick(sources[1], r, g, b, a);
      out[2] = pick(sources[2], r, g, b, a);
      out[3] = pick(sources[3], r, g, b, a);
    });
  },
});

registerEffect({
  matchName: 'ADBE Colorama',
  name: 'Colorama',
  category: 'Color Correction',
  params: [
    { key: 'a', name: 'Output Cycle A', kind: 'color', default: [0, 0, 0.4, 1] },
    { key: 'b', name: 'Output Cycle B', kind: 'color', default: [1, 0.3, 0, 1] },
    { key: 'c', name: 'Output Cycle C', kind: 'color', default: [1, 1, 0.6, 1] },
    { key: 'phase', name: 'Phase Shift', kind: 'angle', default: 0, unit: '°' },
    { key: 'cycles', name: 'Cycle Repetitions', kind: 'number', default: 1, min: 0.1, max: 20, speedPerPixel: 0.02 },
    { key: 'blend', name: 'Blend With Original', kind: 'percent', default: 0, min: 0, max: 100, unit: '%' },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const stops = [get<RGBA>('a'), get<RGBA>('b'), get<RGBA>('c')].map(rgbaTo255);
    const phase = get<number>('phase') / 360;
    const cycles = Math.max(0.1, get<number>('cycles'));
    const blend = get<number>('blend') / 100;

    mapPixels(source, dest, width, height, (r, g, b, a, _x, _y, out) => {
      // Luminance walks a looping three-colour ramp.
      const t = ((luminance(r, g, b) / 255) * cycles + phase) % 1;
      const scaled = (t < 0 ? t + 1 : t) * 3;
      const index = Math.floor(scaled) % 3;
      const k = scaled - Math.floor(scaled);
      const from = stops[index];
      const to = stops[(index + 1) % 3];
      out[0] = r * blend + (from[0] + (to[0] - from[0]) * k) * (1 - blend);
      out[1] = g * blend + (from[1] + (to[1] - from[1]) * k) * (1 - blend);
      out[2] = b * blend + (from[2] + (to[2] - from[2]) * k) * (1 - blend);
      out[3] = a;
    });
  },
});

registerEffect({
  matchName: 'ADBE AutoContrast',
  name: 'Auto Contrast',
  category: 'Color Correction',
  params: [
    { key: 'clipBlack', name: 'Black Clip', kind: 'percent', default: 0.1, min: 0, max: 10, unit: '%', speedPerPixel: 0.02 },
    { key: 'clipWhite', name: 'White Clip', kind: 'percent', default: 0.1, min: 0, max: 10, unit: '%', speedPerPixel: 0.02 },
    { key: 'blend', name: 'Blend With Original', kind: 'percent', default: 0, min: 0, max: 100, unit: '%' },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const data = source.ctx.getImageData(0, 0, width, height).data;
    const histogram = new Uint32Array(256);
    let counted = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 8) continue;
      histogram[Math.round(luminance(data[i], data[i + 1], data[i + 2]))] += 1;
      counted += 1;
    }
    if (counted === 0) {
      copyBuffer(source, dest, width, height);
      return;
    }

    // Clip a little off each tail so a stray pixel cannot set the range.
    const lowTarget = (get<number>('clipBlack') / 100) * counted;
    const highTarget = (get<number>('clipWhite') / 100) * counted;
    let low = 0;
    let high = 255;
    let seen = 0;
    for (let i = 0; i < 256; i += 1) {
      seen += histogram[i];
      if (seen > lowTarget) { low = i; break; }
    }
    seen = 0;
    for (let i = 255; i >= 0; i -= 1) {
      seen += histogram[i];
      if (seen > highTarget) { high = i; break; }
    }
    const span = Math.max(1, high - low);
    const blend = get<number>('blend') / 100;

    mapPixels(source, dest, width, height, (r, g, b, a, _x, _y, out) => {
      const stretch = (v: number) => clamp01((v - low) / span) * 255;
      out[0] = r * blend + stretch(r) * (1 - blend);
      out[1] = g * blend + stretch(g) * (1 - blend);
      out[2] = b * blend + stretch(b) * (1 - blend);
      out[3] = a;
    });
  },
});

registerEffect({
  matchName: 'ADBE Threshold2',
  name: 'Threshold',
  category: 'Stylize',
  params: [
    { key: 'level', name: 'Level', kind: 'number', default: 128, min: 0, max: 255 },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const level = get<number>('level');
    mapPixels(source, dest, width, height, (r, g, b, a, _x, _y, out) => {
      const value = luminance(r, g, b) >= level ? 255 : 0;
      out[0] = value;
      out[1] = value;
      out[2] = value;
      out[3] = a;
    });
  },
});
