import { blurBuffer, clamp01, luminance, mapPixels, rgbaTo255 } from './pixels';
import { registerEffect } from './registry';
import type { RGBA } from '@/core/types';

/** Keying. */

registerEffect({
  matchName: 'ADBE Color Key',
  name: 'Color Key',
  category: 'Keying',
  params: [
    { key: 'colour', name: 'Key Color', kind: 'color', default: [0, 1, 0, 1] },
    { key: 'tolerance', name: 'Color Tolerance', kind: 'number', default: 60, min: 0, max: 442 },
    { key: 'edgeThin', name: 'Edge Thin', kind: 'number', default: 0, min: -10, max: 10 },
    { key: 'edgeFeather', name: 'Edge Feather', kind: 'number', default: 20, min: 0, max: 442 },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const [kr, kg, kb] = rgbaTo255(get<RGBA>('colour'));
    const tolerance = get<number>('tolerance');
    const feather = Math.max(0.001, get<number>('edgeFeather'));

    mapPixels(source, dest, width, height, (r, g, b, a, _x, _y, out) => {
      const distance = Math.hypot(r - kr, g - kg, b - kb);
      // Fully transparent inside the tolerance, fading out across the feather.
      const alpha = clamp01((distance - tolerance) / feather);
      out[3] = a * alpha;
    });
  },
});

registerEffect({
  matchName: 'ADBE Luma Key',
  name: 'Luma Key',
  category: 'Keying',
  params: [
    {
      key: 'type',
      name: 'Key Type',
      kind: 'select',
      default: 0,
      options: ['Key Out Darker', 'Key Out Brighter', 'Key Out Similar', 'Key Out Dissimilar'],
    },
    { key: 'threshold', name: 'Threshold', kind: 'number', default: 128, min: 0, max: 255 },
    { key: 'tolerance', name: 'Tolerance', kind: 'number', default: 40, min: 0, max: 255 },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const type = Math.round(get<number>('type'));
    const threshold = get<number>('threshold');
    const tolerance = Math.max(0.001, get<number>('tolerance'));

    mapPixels(source, dest, width, height, (r, g, b, a, _x, _y, out) => {
      const l = luminance(r, g, b);
      let alpha: number;
      if (type === 0) alpha = clamp01((l - threshold) / tolerance);
      else if (type === 1) alpha = clamp01((threshold - l) / tolerance);
      else if (type === 2) alpha = clamp01((Math.abs(l - threshold) - tolerance) / tolerance);
      else alpha = 1 - clamp01((Math.abs(l - threshold) - tolerance) / tolerance);
      out[3] = a * alpha;
    });
  },
});

registerEffect({
  matchName: 'ADBE Set Matte3',
  name: 'Simple Choker',
  category: 'Matte',
  params: [
    { key: 'choke', name: 'Choke Matte', kind: 'number', default: 0, min: -50, max: 50 },
  ],
  apply: ({ source, dest, width, height, scale, get }) => {
    const choke = get<number>('choke') * scale;
    if (Math.abs(choke) < 0.01) {
      dest.ctx.setTransform(1, 0, 0, 1, 0, 0);
      dest.ctx.globalCompositeOperation = 'copy';
      dest.ctx.drawImage(source.canvas as CanvasImageSource, 0, 0);
      dest.ctx.globalCompositeOperation = 'source-over';
      return;
    }

    const data = source.ctx.getImageData(0, 0, width, height).data;
    const radius = Math.min(16, Math.ceil(Math.abs(choke)));
    const shrink = choke > 0;

    // Erode or dilate the alpha channel by taking the min or max nearby.
    mapPixels(source, dest, width, height, (r, g, b, _a, x, y, out) => {
      let alpha = shrink ? 255 : 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx * dx + dy * dy > radius * radius) continue;
          const px = Math.min(width - 1, Math.max(0, x + dx));
          const py = Math.min(height - 1, Math.max(0, y + dy));
          const sample = data[(py * width + px) * 4 + 3];
          alpha = shrink ? Math.min(alpha, sample) : Math.max(alpha, sample);
        }
      }
      out[0] = r;
      out[1] = g;
      out[2] = b;
      out[3] = alpha;
    });
  },
});

registerEffect({
  matchName: 'ADBE Keylight',
  name: 'Chroma Key',
  category: 'Keying',
  params: [
    { key: 'screenColour', name: 'Screen Colour', kind: 'color', default: [0.1, 0.8, 0.2, 1] },
    { key: 'screenGain', name: 'Screen Gain', kind: 'number', default: 100, min: 0, max: 400 },
    { key: 'screenBalance', name: 'Screen Balance', kind: 'percent', default: 50, min: 0, max: 100, unit: '%' },
    { key: 'clipBlack', name: 'Clip Black', kind: 'number', default: 5, min: 0, max: 100 },
    { key: 'clipWhite', name: 'Clip White', kind: 'number', default: 90, min: 0, max: 100 },
    { key: 'despill', name: 'Despill Amount', kind: 'percent', default: 100, min: 0, max: 100, unit: '%' },
    { key: 'showMatte', name: 'Show Matte', kind: 'checkbox', default: 0 },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const [kr, kg, kb] = rgbaTo255(get<RGBA>('screenColour'));
    const gain = Math.max(1, get<number>('screenGain')) / 100;
    const balance = get<number>('screenBalance') / 100;
    const clipBlack = get<number>('clipBlack') / 100;
    const clipWhite = Math.max(clipBlack + 0.001, get<number>('clipWhite') / 100);
    const despill = get<number>('despill') / 100;
    const showMatte = get<number>('showMatte') >= 0.5;

    // Which channel dominates the screen colour decides what "spill" means.
    const dominant = kg >= kr && kg >= kb ? 1 : kb >= kr ? 2 : 0;

    mapPixels(source, dest, width, height, (r, g, b, a, _x, _y, out) => {
      const channels = [r, g, b];
      const key = channels[dominant];
      const otherA = channels[(dominant + 1) % 3];
      const otherB = channels[(dominant + 2) % 3];
      // Screen balance mixes the two off-channels into the reference the key
      // is measured against, which is what makes hair and edges hold up.
      const reference = otherA * balance + otherB * (1 - balance);
      const difference = (key - reference) / 255;

      const keyed = 1 - clamp01((difference * gain - clipBlack) / (clipWhite - clipBlack));
      const alpha = a * keyed;

      if (showMatte) {
        out[0] = keyed * 255;
        out[1] = keyed * 255;
        out[2] = keyed * 255;
        out[3] = 255;
        return;
      }

      out[0] = r;
      out[1] = g;
      out[2] = b;
      // Despill pulls the dominant channel back to its neighbours' level.
      if (despill > 0 && difference > 0) {
        out[dominant] = channels[dominant] + (reference - channels[dominant]) * despill;
      }
      out[3] = alpha;
    });
  },
});

registerEffect({
  matchName: 'ADBE Extract',
  name: 'Extract',
  category: 'Keying',
  params: [
    {
      key: 'channel', name: 'Channel', kind: 'select', default: 0,
      options: ['Luminance', 'Red', 'Green', 'Blue', 'Alpha'],
    },
    { key: 'blackPoint', name: 'Black Point', kind: 'number', default: 0, min: 0, max: 255 },
    { key: 'whitePoint', name: 'White Point', kind: 'number', default: 255, min: 0, max: 255 },
    { key: 'blackSoftness', name: 'Black Softness', kind: 'number', default: 0, min: 0, max: 255 },
    { key: 'whiteSoftness', name: 'White Softness', kind: 'number', default: 0, min: 0, max: 255 },
    { key: 'invert', name: 'Invert Extraction', kind: 'checkbox', default: 0 },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const channel = Math.round(get<number>('channel'));
    const black = get<number>('blackPoint');
    const white = get<number>('whitePoint');
    const blackSoft = Math.max(0.001, get<number>('blackSoftness'));
    const whiteSoft = Math.max(0.001, get<number>('whiteSoftness'));
    const invert = get<number>('invert') >= 0.5;

    mapPixels(source, dest, width, height, (r, g, b, a, _x, _y, out) => {
      const value = channel === 1 ? r : channel === 2 ? g : channel === 3 ? b
        : channel === 4 ? a : luminance(r, g, b);
      // Keep what lies between the two points, fading across the softness.
      const low = clamp01((value - black) / blackSoft);
      const high = clamp01((white - value) / whiteSoft);
      const keep = Math.min(low, high);
      out[3] = a * (invert ? 1 - keep : keep);
    });
  },
});

registerEffect({
  matchName: 'ADBE Matte Choker',
  name: 'Matte Choker',
  category: 'Matte',
  params: [
    { key: 'geometricSoftness', name: 'Geometric Softness 1', kind: 'number', default: 4, min: 0, max: 16 },
    { key: 'choke', name: 'Choke 1', kind: 'number', default: 0, min: -100, max: 100 },
    { key: 'grayLevel', name: 'Gray Level Softness 1', kind: 'percent', default: 50, min: 0, max: 100, unit: '%' },
    { key: 'iterations', name: 'Iterations', kind: 'number', default: 1, min: 1, max: 4 },
  ],
  apply: ({ source, dest, width, height, scale, pool, get }) => {
    const softness = get<number>('geometricSoftness') * scale;
    const choke = get<number>('choke') / 100;
    const grayLevel = get<number>('grayLevel') / 100;
    const iterations = Math.max(1, Math.min(4, Math.round(get<number>('iterations'))));

    // Blur the matte, then push its midpoint to choke or spread the edge.
    // Repeating the pair is what closes holes a single pass leaves behind.
    let from = source;
    for (let i = 0; i < iterations; i += 1) {
      const blurred = pool.sized(`fxChokerBlur${i % 2}`, width, height);
      blurBuffer(from, blurred, width, height, softness, softness, pool);
      const target = i === iterations - 1 ? dest : pool.sized(`fxChokerOut${i % 2}`, width, height);
      const midpoint = 0.5 + choke * 0.45;
      const contrast = 1 / Math.max(0.02, grayLevel);
      mapPixels(blurred, target, width, height, (r, g, b, a, _x, _y, out) => {
        out[0] = r;
        out[1] = g;
        out[2] = b;
        out[3] = clamp01((a / 255 - midpoint) * contrast + 0.5) * 255;
      });
      from = target;
    }
  },
});

registerEffect({
  matchName: 'ADBE Bevel Alpha',
  name: 'Bevel Alpha',
  category: 'Perspective',
  params: [
    { key: 'thickness', name: 'Edge Thickness', kind: 'number', default: 4, min: 0, max: 40 },
    { key: 'lightAngle', name: 'Light Angle', kind: 'angle', default: -60, unit: '°' },
    { key: 'lightColour', name: 'Light Color', kind: 'color', default: [1, 1, 1, 1] },
    { key: 'lightIntensity', name: 'Light Intensity', kind: 'percent', default: 50, min: 0, max: 100, unit: '%' },
  ],
  apply: ({ source, dest, width, height, scale, get }) => {
    const thickness = Math.max(0.5, get<number>('thickness') * scale);
    const angle = ((get<number>('lightAngle') - 90) * Math.PI) / 180;
    const [lr, lg, lb] = rgbaTo255(get<RGBA>('lightColour'));
    const intensity = get<number>('lightIntensity') / 100;
    const data = source.ctx.getImageData(0, 0, width, height).data;
    const lx = Math.cos(angle);
    const ly = Math.sin(angle);

    // The alpha channel's slope is the surface normal of the bevel, so the
    // edge lights up where it faces the light and darkens where it faces away.
    mapPixels(source, dest, width, height, (r, g, b, a, x, y, out) => {
      if (a === 0) return;
      const alphaAt = (dx: number, dy: number) => {
        const px = Math.min(width - 1, Math.max(0, Math.round(x + dx)));
        const py = Math.min(height - 1, Math.max(0, Math.round(y + dy)));
        return data[(py * width + px) * 4 + 3] / 255;
      };
      const gx = alphaAt(thickness, 0) - alphaAt(-thickness, 0);
      const gy = alphaAt(0, thickness) - alphaAt(0, -thickness);
      const slope = Math.hypot(gx, gy);
      if (slope < 0.01) return;

      const facing = -(gx * lx + gy * ly) / slope;
      const shade = facing * slope * intensity;
      out[0] = r + (shade > 0 ? (lr - r) * shade : r * shade);
      out[1] = g + (shade > 0 ? (lg - g) * shade : g * shade);
      out[2] = b + (shade > 0 ? (lb - b) * shade : b * shade);
      out[3] = a;
    });
  },
});
