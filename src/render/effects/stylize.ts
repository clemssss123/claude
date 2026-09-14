import { blurBuffer, clamp01, copyBuffer, luminance, mapPixels, rgbaTo255 } from './pixels';
import { registerEffect } from './registry';
import type { RGBA, Vec2 } from '@/core/types';

/** Stylize. */

registerEffect({
  matchName: 'ADBE Glo2',
  name: 'Glow',
  category: 'Stylize',
  params: [
    { key: 'threshold', name: 'Glow Threshold', kind: 'percent', default: 60, min: 0, max: 100, unit: '%' },
    { key: 'radius', name: 'Glow Radius', kind: 'number', default: 30, min: 0 },
    { key: 'intensity', name: 'Glow Intensity', kind: 'number', default: 1, min: 0, max: 10, speedPerPixel: 0.02 },
    {
      key: 'composite',
      name: 'Composite Original',
      kind: 'select',
      default: 0,
      options: ['On Top', 'Behind', 'None'],
    },
  ],
  margin: (get) => get<number>('radius') * 2,
  apply: ({ source, dest, width, height, scale, pool, get }) => {
    const threshold = (get<number>('threshold') / 100) * 255;
    const radius = get<number>('radius') * scale;
    const intensity = get<number>('intensity');
    const composite = Math.round(get<number>('composite'));

    // Keep only what is brighter than the threshold, blur it, add it back.
    const bright = pool.sized('fxGlowBright', width, height);
    mapPixels(source, bright, width, height, (r, g, b, a, _x, _y, out) => {
      const l = luminance(r, g, b);
      if (l <= threshold || a === 0) {
        out[3] = 0;
        return;
      }
      const strength = clamp01((l - threshold) / Math.max(1, 255 - threshold));
      out[0] = r;
      out[1] = g;
      out[2] = b;
      out[3] = a * strength;
    });

    const blurred = pool.sized('fxGlowBlur', width, height);
    blurBuffer(bright, blurred, width, height, radius, radius, pool);

    dest.ctx.setTransform(1, 0, 0, 1, 0, 0);
    dest.ctx.globalCompositeOperation = 'copy';
    dest.ctx.globalAlpha = 1;
    dest.ctx.clearRect(0, 0, width, height);
    dest.ctx.globalCompositeOperation = 'source-over';

    if (composite === 1) drawGlow(dest, blurred, intensity, width, height);
    if (composite !== 2) dest.ctx.drawImage(source.canvas as CanvasImageSource, 0, 0);
    if (composite !== 1) drawGlow(dest, blurred, intensity, width, height);
  },
});

function drawGlow(
  dest: { ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D },
  blurred: { canvas: HTMLCanvasElement | OffscreenCanvas },
  intensity: number,
  width: number,
  height: number,
): void {
  const passes = Math.max(1, Math.round(intensity));
  const remainder = intensity / passes;
  dest.ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < passes; i += 1) {
    dest.ctx.globalAlpha = Math.min(1, remainder);
    dest.ctx.drawImage(blurred.canvas as CanvasImageSource, 0, 0);
  }
  dest.ctx.globalAlpha = 1;
  dest.ctx.globalCompositeOperation = 'source-over';
  void width;
  void height;
}

registerEffect({
  matchName: 'ADBE Tile',
  name: 'Motion Tile',
  category: 'Stylize',
  params: [
    { key: 'tileCentre', name: 'Tile Center', kind: 'vec2', default: [0, 0], dimensionNames: ['X', 'Y'] },
    { key: 'tileWidth', name: 'Tile Width', kind: 'percent', default: 100, min: 1, max: 1000, unit: '%' },
    { key: 'tileHeight', name: 'Tile Height', kind: 'percent', default: 100, min: 1, max: 1000, unit: '%' },
    { key: 'outputWidth', name: 'Output Width', kind: 'percent', default: 100, min: 1, max: 1000, unit: '%' },
    { key: 'outputHeight', name: 'Output Height', kind: 'percent', default: 100, min: 1, max: 1000, unit: '%' },
    { key: 'mirrorEdges', name: 'Mirror Edges', kind: 'checkbox', default: 0 },
    { key: 'phase', name: 'Phase', kind: 'angle', default: 0, unit: '°' },
    { key: 'horizontalPhase', name: 'Horizontal Phase Shift', kind: 'checkbox', default: 0 },
  ],
  apply: ({ source, dest, width, height, scale, get }) => {
    const tileW = Math.max(1, (get<number>('tileWidth') / 100) * width);
    const tileH = Math.max(1, (get<number>('tileHeight') / 100) * height);
    const outW = (get<number>('outputWidth') / 100) * width;
    const outH = (get<number>('outputHeight') / 100) * height;
    const centre = get<Vec2>('tileCentre');
    const mirror = get<number>('mirrorEdges') >= 0.5;
    const phase = get<number>('phase') / 360;
    const horizontalPhase = get<number>('horizontalPhase') >= 0.5;

    const cx = width / 2 + centre[0] * scale;
    const cy = height / 2 + centre[1] * scale;
    const left = cx - outW / 2;
    const top = cy - outH / 2;

    dest.ctx.setTransform(1, 0, 0, 1, 0, 0);
    dest.ctx.globalCompositeOperation = 'copy';
    dest.ctx.clearRect(0, 0, width, height);
    dest.ctx.globalCompositeOperation = 'source-over';
    dest.ctx.globalAlpha = 1;

    dest.ctx.save();
    dest.ctx.beginPath();
    dest.ctx.rect(left, top, outW, outH);
    dest.ctx.clip();

    const columns = Math.ceil(outW / tileW) + 2;
    const rows = Math.ceil(outH / tileH) + 2;
    const startX = left - tileW;
    const startY = top - tileH;

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        // Phase slides alternate rows (or columns) along, which is what makes
        // a tiled pattern read as motion rather than a grid.
        const shift = horizontalPhase ? phase * tileW * row : 0;
        const verticalShift = horizontalPhase ? 0 : phase * tileH * column;
        const x = startX + column * tileW + shift;
        const y = startY + row * tileH + verticalShift;

        dest.ctx.save();
        dest.ctx.translate(x + tileW / 2, y + tileH / 2);
        if (mirror) {
          dest.ctx.scale(column % 2 === 0 ? 1 : -1, row % 2 === 0 ? 1 : -1);
        }
        dest.ctx.drawImage(
          source.canvas as CanvasImageSource,
          0, 0, width, height,
          -tileW / 2, -tileH / 2, tileW, tileH,
        );
        dest.ctx.restore();
      }
    }
    dest.ctx.restore();
  },
});

registerEffect({
  matchName: 'ADBE Mosaic',
  name: 'Mosaic',
  category: 'Stylize',
  params: [
    { key: 'horizontal', name: 'Horizontal Blocks', kind: 'number', default: 24, min: 1, max: 2000 },
    { key: 'vertical', name: 'Vertical Blocks', kind: 'number', default: 24, min: 1, max: 2000 },
    { key: 'sharpColors', name: 'Sharp Colors', kind: 'checkbox', default: 1 },
  ],
  apply: ({ source, dest, width, height, pool, get }) => {
    const columns = Math.max(1, Math.round(get<number>('horizontal')));
    const rows = Math.max(1, Math.round(get<number>('vertical')));

    // Downscale then scale back up: the small buffer averages each block.
    const small = pool.sized('fxMosaic', columns, rows);
    small.ctx.imageSmoothingEnabled = !(get<number>('sharpColors') >= 0.5);
    small.ctx.drawImage(source.canvas as CanvasImageSource, 0, 0, columns, rows);

    dest.ctx.setTransform(1, 0, 0, 1, 0, 0);
    dest.ctx.globalCompositeOperation = 'copy';
    dest.ctx.imageSmoothingEnabled = false;
    dest.ctx.drawImage(small.canvas as CanvasImageSource, 0, 0, columns, rows, 0, 0, width, height);
    dest.ctx.imageSmoothingEnabled = true;
    dest.ctx.globalCompositeOperation = 'source-over';
  },
});

registerEffect({
  matchName: 'ADBE Find Edges',
  name: 'Find Edges',
  category: 'Stylize',
  params: [
    { key: 'invert', name: 'Invert', kind: 'checkbox', default: 0 },
    { key: 'blend', name: 'Blend With Original', kind: 'percent', default: 0, min: 0, max: 100, unit: '%' },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const invert = get<number>('invert') >= 0.5;
    const blend = get<number>('blend') / 100;
    const data = source.ctx.getImageData(0, 0, width, height).data;

    // Sobel magnitude on luminance.
    mapPixels(source, dest, width, height, (r, g, b, a, x, y, out) => {
      const at = (dx: number, dy: number) => {
        const px = Math.min(width - 1, Math.max(0, x + dx));
        const py = Math.min(height - 1, Math.max(0, y + dy));
        const i = (py * width + px) * 4;
        return luminance(data[i], data[i + 1], data[i + 2]);
      };
      const gx = at(-1, -1) + 2 * at(-1, 0) + at(-1, 1) - at(1, -1) - 2 * at(1, 0) - at(1, 1);
      const gy = at(-1, -1) + 2 * at(0, -1) + at(1, -1) - at(-1, 1) - 2 * at(0, 1) - at(1, 1);
      const edge = Math.min(255, Math.hypot(gx, gy));
      const value = invert ? edge : 255 - edge;
      out[0] = r * blend + value * (1 - blend);
      out[1] = g * blend + value * (1 - blend);
      out[2] = b * blend + value * (1 - blend);
      out[3] = a;
    });
  },
});

registerEffect({
  matchName: 'CC Vignette',
  name: 'Vignette',
  category: 'Stylize',
  params: [
    { key: 'amount', name: 'Amount', kind: 'percent', default: 50, min: -100, max: 100, unit: '%' },
    { key: 'radius', name: 'Radius', kind: 'percent', default: 70, min: 1, max: 200, unit: '%' },
    { key: 'softness', name: 'Softness', kind: 'percent', default: 50, min: 0, max: 100, unit: '%' },
    { key: 'colour', name: 'Color', kind: 'color', default: [0, 0, 0, 1] },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const amount = get<number>('amount') / 100;
    const radius = get<number>('radius') / 100;
    const softness = Math.max(0.001, get<number>('softness') / 100);
    const [vr, vg, vb] = rgbaTo255(get<RGBA>('colour'));

    const cx = width / 2;
    const cy = height / 2;
    const maxDistance = Math.hypot(cx, cy) * radius;

    mapPixels(source, dest, width, height, (r, g, b, a, x, y, out) => {
      const distance = Math.hypot(x - cx, y - cy);
      const t = clamp01((distance - maxDistance * (1 - softness)) / (maxDistance * softness));
      const strength = t * amount;
      out[0] = r + (vr - r) * strength;
      out[1] = g + (vg - g) * strength;
      out[2] = b + (vb - b) * strength;
      out[3] = a;
    });
  },
});

registerEffect({
  matchName: 'ADBE Posterize',
  name: 'Posterize',
  category: 'Stylize',
  params: [
    { key: 'levels', name: 'Level', kind: 'number', default: 6, min: 2, max: 64 },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const levels = Math.max(2, Math.round(get<number>('levels')));
    const step = 255 / (levels - 1);
    mapPixels(source, dest, width, height, (r, g, b, a, _x, _y, out) => {
      out[0] = Math.round(r / step) * step;
      out[1] = Math.round(g / step) * step;
      out[2] = Math.round(b / step) * step;
      out[3] = a;
    });
  },
});

registerEffect({
  matchName: 'ADBE Drop Shadow',
  name: 'Drop Shadow',
  category: 'Perspective',
  params: [
    { key: 'colour', name: 'Shadow Color', kind: 'color', default: [0, 0, 0, 1] },
    { key: 'opacity', name: 'Opacity', kind: 'percent', default: 50, min: 0, max: 100, unit: '%' },
    { key: 'direction', name: 'Direction', kind: 'angle', default: 135, unit: '°' },
    { key: 'distance', name: 'Distance', kind: 'number', default: 20, min: 0 },
    { key: 'softness', name: 'Softness', kind: 'number', default: 20, min: 0 },
    { key: 'shadowOnly', name: 'Shadow Only', kind: 'checkbox', default: 0 },
  ],
  margin: (get) => get<number>('distance') + get<number>('softness') * 2,
  apply: ({ source, dest, width, height, scale, pool, get }) => {
    const [sr, sg, sb] = rgbaTo255(get<RGBA>('colour'));
    const opacity = get<number>('opacity') / 100;
    const angle = ((get<number>('direction') - 90) * Math.PI) / 180;
    const distance = get<number>('distance') * scale;
    const softness = get<number>('softness') * scale;
    const shadowOnly = get<number>('shadowOnly') >= 0.5;

    // The shadow is the layer's alpha, tinted, offset and blurred.
    const silhouette = pool.sized('fxShadowSil', width, height);
    mapPixels(source, silhouette, width, height, (_r, _g, _b, a, _x, _y, out) => {
      out[0] = sr;
      out[1] = sg;
      out[2] = sb;
      out[3] = a * opacity;
    });

    const blurred = pool.sized('fxShadowBlur', width, height);
    blurBuffer(silhouette, blurred, width, height, softness, softness, pool);

    dest.ctx.setTransform(1, 0, 0, 1, 0, 0);
    dest.ctx.globalCompositeOperation = 'copy';
    dest.ctx.clearRect(0, 0, width, height);
    dest.ctx.globalCompositeOperation = 'source-over';
    dest.ctx.globalAlpha = 1;
    dest.ctx.drawImage(
      blurred.canvas as CanvasImageSource,
      Math.cos(angle) * distance,
      Math.sin(angle) * distance,
    );
    if (!shadowOnly) dest.ctx.drawImage(source.canvas as CanvasImageSource, 0, 0);
    void copyBuffer;
  },
});
