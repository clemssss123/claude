import { clamp01, luminance, mapPixels, rgbaTo255 } from './pixels';
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
