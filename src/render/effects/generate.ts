import { clamp01, fbm, hashNoise, mapPixels, rgbaTo255 } from './pixels';
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
    {
      key: 'fractalType', name: 'Fractal Type', kind: 'select', default: 0,
      options: ['Basic', 'Turbulent Smooth', 'Turbulent Sharp', 'Dynamic', 'Max', 'Rocky'],
    },
    {
      key: 'noiseType', name: 'Noise Type', kind: 'select', default: 3,
      options: ['Block', 'Linear', 'Soft Linear', 'Spline'],
    },
    { key: 'invert', name: 'Invert', kind: 'checkbox', default: 0 },
    { key: 'contrast', name: 'Contrast', kind: 'percent', default: 100, min: 0, max: 400, unit: '%' },
    { key: 'brightness', name: 'Brightness', kind: 'number', default: 0, min: -200, max: 200 },
    {
      key: 'overflow', name: 'Overflow', kind: 'select', default: 0,
      options: ['Clip', 'Soft Clamp', 'Wrap Back', 'Allow HDR'],
    },
    { key: 'rotation', name: 'Rotation', kind: 'angle', default: 0, unit: '°' },
    { key: 'scaleAmount', name: 'Scale', kind: 'percent', default: 100, min: 1, max: 1000, unit: '%' },
    { key: 'scaleWidth', name: 'Scale Width', kind: 'percent', default: 100, min: 1, max: 1000, unit: '%' },
    { key: 'scaleHeight', name: 'Scale Height', kind: 'percent', default: 100, min: 1, max: 1000, unit: '%' },
    { key: 'offset', name: 'Offset Turbulence', kind: 'vec2', default: [0, 0], dimensionNames: ['X', 'Y'] },
    { key: 'complexity', name: 'Complexity', kind: 'number', default: 6, min: 1, max: 10 },
    { key: 'subInfluence', name: 'Sub Influence', kind: 'percent', default: 70, min: 0, max: 200, unit: '%' },
    { key: 'subScaling', name: 'Sub Scaling', kind: 'percent', default: 200, min: 10, max: 400, unit: '%' },
    { key: 'evolution', name: 'Evolution', kind: 'angle', default: 0, unit: '°' },
    { key: 'seed', name: 'Random Seed', kind: 'number', default: 0, min: 0, max: 9999 },
    { key: 'opacity', name: 'Opacity', kind: 'percent', default: 100, min: 0, max: 100, unit: '%' },
  ],
  apply: ({ source, dest, width, height, scale, get }) => {
    const fractalType = Math.round(get<number>('fractalType'));
    const noiseType = (['block', 'linear', 'soft', 'spline'] as const)[
      Math.max(0, Math.min(3, Math.round(get<number>('noiseType'))))
    ];
    const invert = get<number>('invert') >= 0.5;
    const contrast = get<number>('contrast') / 100;
    const brightness = get<number>('brightness');
    const overflow = Math.round(get<number>('overflow'));
    const rotation = (get<number>('rotation') * Math.PI) / 180;
    const uniform = Math.max(1, get<number>('scaleAmount'));
    const scaleX = (uniform * get<number>('scaleWidth')) / 100 * scale;
    const scaleY = (uniform * get<number>('scaleHeight')) / 100 * scale;
    const offset = get<Vec2>('offset');
    const octaves = Math.max(1, Math.min(10, Math.round(get<number>('complexity'))));
    // AE's Sub Settings are the two numbers every fractal sum has: how loud
    // each finer octave is, and how much finer it gets.
    const gain = get<number>('subInfluence') / 100;
    const lacunarity = Math.max(0.1, get<number>('subScaling') / 100);
    const evolution = get<number>('evolution') / 360 + get<number>('seed') * 11.3;
    const opacity = get<number>('opacity') / 100;

    const fractal = fractalType === 1 ? 'turbulent'
      : fractalType === 2 ? 'turbulent'
        : fractalType === 5 ? 'ridged' : 'smooth';
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const cx = width / 2;
    const cy = height / 2;

    mapPixels(source, dest, width, height, (r, g, b, a, x, y, out) => {
      // Rotate about the centre first, so Rotation turns the pattern rather
      // than sliding it, then scale each axis.
      const ox = x - cx + offset[0] * scale;
      const oy = y - cy + offset[1] * scale;
      const rx = (ox * cos - oy * sin) / Math.max(1, scaleX);
      const ry = (ox * sin + oy * cos) / Math.max(1, scaleY);

      let value = fbm(rx, ry, evolution, octaves, {
        gain,
        lacunarity,
        fractal,
        kind: 'value',
        interp: noiseType,
      });
      // Turbulent Sharp keeps the creases the absolute value makes; the
      // smooth one rounds them off. Dynamic evolves each octave separately,
      // so the fine detail boils while the large shapes drift.
      if (fractalType === 1) value = Math.sqrt(clamp01(value));
      if (fractalType === 3) {
        value = fbm(rx, ry, evolution * 2, octaves, {
          gain, lacunarity, fractal: 'smooth', kind: 'value', interp: noiseType,
        });
      }
      if (fractalType === 4) value = Math.max(value, 1 - value);
      if (invert) value = 1 - value;

      let level = (value - 0.5) * contrast + 0.5 + brightness / 255;
      switch (overflow) {
        case 1:
          // Soft Clamp rolls the ends over instead of flattening them.
          level = 0.5 + 0.5 * Math.tanh((level - 0.5) * 2);
          break;
        case 2: {
          // Wrap Back folds anything past the ends back into range.
          const folded = Math.abs(level % 2);
          level = folded > 1 ? 2 - folded : folded;
          break;
        }
        default:
          level = clamp01(level);
      }

      const shade = clamp01(level) * 255;
      out[0] = r + (shade - r) * opacity;
      out[1] = g + (shade - g) * opacity;
      out[2] = b + (shade - b) * opacity;
      out[3] = a + (255 - a) * opacity;
    });
  },
});

function mod(value: number, m: number): number {
  return ((value % m) + m) % m;
}

registerEffect({
  matchName: 'ADBE Cell Pattern',
  name: 'Cell Pattern',
  category: 'Generate',
  params: [
    {
      key: 'pattern', name: 'Cell Pattern', kind: 'select', default: 0,
      options: ['Bubbles', 'Crystals', 'Plates', 'Static Plates', 'Tubular'],
    },
    { key: 'invert', name: 'Invert', kind: 'checkbox', default: 0 },
    { key: 'contrast', name: 'Contrast', kind: 'percent', default: 100, min: 1, max: 400, unit: '%' },
    { key: 'disperse', name: 'Disperse', kind: 'percent', default: 100, min: 0, max: 100, unit: '%' },
    { key: 'sizeAmount', name: 'Size', kind: 'number', default: 60, min: 2 },
    { key: 'offset', name: 'Offset', kind: 'vec2', default: [0, 0], dimensionNames: ['X', 'Y'] },
    { key: 'evolution', name: 'Evolution', kind: 'angle', default: 0, unit: '°' },
    { key: 'opacity', name: 'Opacity', kind: 'percent', default: 100, min: 0, max: 100, unit: '%' },
  ],
  apply: ({ source, dest, width, height, scale, get }) => {
    const pattern = Math.round(get<number>('pattern'));
    const invert = get<number>('invert') >= 0.5;
    const contrast = get<number>('contrast') / 100;
    const disperse = get<number>('disperse') / 100;
    const cell = Math.max(2, get<number>('sizeAmount') * scale);
    const offset = get<Vec2>('offset');
    const evolution = get<number>('evolution') / 360;
    const opacity = get<number>('opacity') / 100;

    mapPixels(source, dest, width, height, (r, g, b, a, x, y, out) => {
      const px = (x + offset[0] * scale) / cell;
      const py = (y + offset[1] * scale) / cell;
      const cx = Math.floor(px);
      const cy = Math.floor(py);

      // Worley noise: distance to the nearest scattered feature point, and to
      // the second nearest, which is what separates bubbles from crystals.
      let nearest = Infinity;
      let second = Infinity;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const gx = cx + dx;
          const gy = cy + dy;
          const jitterX = hashNoise(gx, gy, evolution) * disperse;
          const jitterY = hashNoise(gx + 41.3, gy + 7.7, evolution) * disperse;
          const distance = Math.hypot(px - (gx + jitterX), py - (gy + jitterY));
          if (distance < nearest) {
            second = nearest;
            nearest = distance;
          } else if (distance < second) {
            second = distance;
          }
        }
      }

      let value: number;
      if (pattern === 1 || pattern === 2) value = clamp01((second - nearest) * contrast);
      else if (pattern === 4) value = clamp01(Math.abs(Math.sin(nearest * Math.PI * 2)) * contrast);
      else value = clamp01((1 - nearest) * contrast);
      if (invert) value = 1 - value;

      const level = value * 255;
      out[0] = r + (level - r) * opacity;
      out[1] = g + (level - g) * opacity;
      out[2] = b + (level - b) * opacity;
      out[3] = a + (255 - a) * opacity;
    });
  },
});

registerEffect({
  matchName: 'ADBE Lens Flare',
  name: 'Lens Flare',
  category: 'Generate',
  params: [
    { key: 'centre', name: 'Flare Center', kind: 'vec2', default: [0, 0], dimensionNames: ['X', 'Y'] },
    { key: 'brightness', name: 'Flare Brightness', kind: 'percent', default: 100, min: 0, max: 400, unit: '%' },
    { key: 'colour', name: 'Flare Color', kind: 'color', default: [1, 0.95, 0.85, 1] },
    { key: 'blend', name: 'Blend With Original', kind: 'percent', default: 0, min: 0, max: 100, unit: '%' },
  ],
  apply: ({ source, dest, width, height, scale, get }) => {
    const centre = get<Vec2>('centre');
    const cx = width / 2 + centre[0] * scale;
    const cy = height / 2 + centre[1] * scale;
    const brightness = get<number>('brightness') / 100;
    const colour = get<RGBA>('colour');
    const blend = 1 - get<number>('blend') / 100;

    dest.ctx.setTransform(1, 0, 0, 1, 0, 0);
    dest.ctx.globalCompositeOperation = 'copy';
    dest.ctx.globalAlpha = 1;
    dest.ctx.drawImage(source.canvas as CanvasImageSource, 0, 0);
    dest.ctx.globalCompositeOperation = 'lighter';
    dest.ctx.globalAlpha = blend;

    const to255 = (v: number) => Math.round(clamp01(v) * 255);
    const rgb = `${to255(colour[0])}, ${to255(colour[1])}, ${to255(colour[2])}`;

    // The core, then a wider halo, then ghosts marching back through the
    // centre — the arrangement that reads as a lens flare.
    const core = Math.min(width, height) * 0.08 * brightness;
    drawGlowDisc(dest.ctx, cx, cy, core, rgb, 1);
    drawGlowDisc(dest.ctx, cx, cy, core * 6, rgb, 0.25 * brightness);

    const dx = width / 2 - cx;
    const dy = height / 2 - cy;
    for (let i = 1; i <= 5; i += 1) {
      const t = i / 3;
      drawGlowDisc(
        dest.ctx, cx + dx * t * 2, cy + dy * t * 2,
        core * (0.3 + (i % 3) * 0.25), rgb, 0.12 * brightness,
      );
    }

    dest.ctx.globalCompositeOperation = 'source-over';
    dest.ctx.globalAlpha = 1;
  },
});

function drawGlowDisc(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number, y: number, radius: number, rgb: string, alpha: number,
): void {
  if (radius <= 0 || alpha <= 0) return;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, `rgba(${rgb}, ${Math.min(1, alpha)})`);
  gradient.addColorStop(0.4, `rgba(${rgb}, ${Math.min(1, alpha) * 0.35})`);
  gradient.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

registerEffect({
  matchName: 'ADBE Beam',
  name: 'Beam',
  category: 'Generate',
  params: [
    { key: 'start', name: 'Starting Point', kind: 'vec2', default: [-300, 0], dimensionNames: ['X', 'Y'] },
    { key: 'end', name: 'Ending Point', kind: 'vec2', default: [300, 0], dimensionNames: ['X', 'Y'] },
    { key: 'length', name: 'Length', kind: 'percent', default: 100, min: 0, max: 100, unit: '%' },
    { key: 'time', name: 'Time', kind: 'percent', default: 100, min: 0, max: 100, unit: '%' },
    { key: 'startThickness', name: 'Starting Thickness', kind: 'number', default: 12, min: 0 },
    { key: 'endThickness', name: 'Ending Thickness', kind: 'number', default: 12, min: 0 },
    { key: 'softness', name: 'Softness', kind: 'percent', default: 40, min: 0, max: 100, unit: '%' },
    { key: 'colour', name: 'Inside Color', kind: 'color', default: [0.6, 0.85, 1, 1] },
    { key: 'composite', name: 'Composite on Original', kind: 'checkbox', default: 1 },
  ],
  apply: ({ source, dest, width, height, scale, get }) => {
    const start = get<Vec2>('start');
    const end = get<Vec2>('end');
    const lengthFraction = get<number>('length') / 100;
    const progress = get<number>('time') / 100;
    const startThickness = get<number>('startThickness') * scale;
    const endThickness = get<number>('endThickness') * scale;
    const softness = get<number>('softness') / 100;
    const colour = get<RGBA>('colour');

    const sx = width / 2 + start[0] * scale;
    const sy = height / 2 + start[1] * scale;
    const ex = width / 2 + end[0] * scale;
    const ey = height / 2 + end[1] * scale;

    // The beam's head travels the path; its tail follows a length behind.
    const head = progress;
    const tail = Math.max(0, progress - lengthFraction);
    const p0x = sx + (ex - sx) * tail;
    const p0y = sy + (ey - sy) * tail;
    const p1x = sx + (ex - sx) * head;
    const p1y = sy + (ey - sy) * head;

    dest.ctx.setTransform(1, 0, 0, 1, 0, 0);
    dest.ctx.globalCompositeOperation = 'copy';
    dest.ctx.globalAlpha = 1;
    if (get<number>('composite') >= 0.5) {
      dest.ctx.drawImage(source.canvas as CanvasImageSource, 0, 0);
    } else {
      dest.ctx.clearRect(0, 0, width, height);
    }
    dest.ctx.globalCompositeOperation = 'lighter';

    const to255 = (v: number) => Math.round(clamp01(v) * 255);
    const rgb = `${to255(colour[0])}, ${to255(colour[1])}, ${to255(colour[2])}`;
    const thickness = Math.max(startThickness, endThickness);
    const passes = softness > 0 ? 4 : 1;
    for (let i = 0; i < passes; i += 1) {
      const spread = 1 + (i / passes) * softness * 6;
      dest.ctx.strokeStyle = `rgba(${rgb}, ${0.9 / passes})`;
      dest.ctx.lineWidth = Math.max(0.5, thickness * spread);
      dest.ctx.lineCap = 'round';
      dest.ctx.beginPath();
      dest.ctx.moveTo(p0x, p0y);
      dest.ctx.lineTo(p1x, p1y);
      dest.ctx.stroke();
    }

    dest.ctx.globalCompositeOperation = 'source-over';
    dest.ctx.globalAlpha = 1;
  },
});

registerEffect({
  matchName: 'ADBE Circle',
  name: 'Circle',
  category: 'Generate',
  params: [
    { key: 'centre', name: 'Center', kind: 'vec2', default: [0, 0], dimensionNames: ['X', 'Y'] },
    { key: 'radius', name: 'Radius', kind: 'number', default: 200, min: 0 },
    { key: 'edgeRadius', name: 'Edge Radius', kind: 'number', default: 0, min: 0 },
    { key: 'feather', name: 'Feather', kind: 'number', default: 0, min: 0 },
    { key: 'colour', name: 'Color', kind: 'color', default: [1, 1, 1, 1] },
    { key: 'opacity', name: 'Opacity', kind: 'percent', default: 100, min: 0, max: 100, unit: '%' },
    { key: 'invert', name: 'Invert Circle', kind: 'checkbox', default: 0 },
  ],
  apply: ({ source, dest, width, height, scale, get }) => {
    const centre = get<Vec2>('centre');
    const cx = width / 2 + centre[0] * scale;
    const cy = height / 2 + centre[1] * scale;
    const radius = get<number>('radius') * scale;
    const edge = get<number>('edgeRadius') * scale;
    const feather = Math.max(0.001, get<number>('feather') * scale);
    const [cr, cg, cb] = rgbaTo255(get<RGBA>('colour'));
    const opacity = get<number>('opacity') / 100;
    const invert = get<number>('invert') >= 0.5;

    mapPixels(source, dest, width, height, (r, g, b, a, x, y, out) => {
      const distance = Math.hypot(x - cx, y - cy);
      // A non-zero edge radius turns the disc into a ring.
      let inside = clamp01((radius - distance) / feather);
      if (edge > 0) inside *= clamp01((distance - (radius - edge)) / feather);
      const amount = (invert ? 1 - inside : inside) * opacity;
      out[0] = r + (cr - r) * amount;
      out[1] = g + (cg - g) * amount;
      out[2] = b + (cb - b) * amount;
      out[3] = a + (255 - a) * amount;
    });
  },
});
