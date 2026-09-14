import { copyBuffer, remapPixels } from './pixels';
import { registerEffect } from './registry';
import type { Vec2 } from '@/core/types';

/** Distort. */

registerEffect({
  matchName: 'ADBE Geometry2',
  name: 'Transform',
  category: 'Distort',
  params: [
    { key: 'anchor', name: 'Anchor Point', kind: 'vec2', default: [0, 0], dimensionNames: ['X', 'Y'] },
    { key: 'position', name: 'Position', kind: 'vec2', default: [0, 0], dimensionNames: ['X', 'Y'] },
    { key: 'scaleX', name: 'Scale Width', kind: 'percent', default: 100, unit: '%', speedPerPixel: 0.5 },
    { key: 'scaleY', name: 'Scale Height', kind: 'percent', default: 100, unit: '%', speedPerPixel: 0.5 },
    { key: 'skew', name: 'Skew', kind: 'number', default: 0 },
    { key: 'skewAxis', name: 'Skew Axis', kind: 'angle', default: 0, unit: '°' },
    { key: 'rotation', name: 'Rotation', kind: 'angle', default: 0, unit: '°' },
    { key: 'opacity', name: 'Opacity', kind: 'percent', default: 100, min: 0, max: 100, unit: '%', speedPerPixel: 0.5 },
  ],
  apply: ({ source, dest, width, height, scale, get }) => {
    const anchor = get<Vec2>('anchor');
    const position = get<Vec2>('position');
    const skew = get<number>('skew');
    const skewAxis = (get<number>('skewAxis') * Math.PI) / 180;

    const cx = width / 2 + anchor[0] * scale;
    const cy = height / 2 + anchor[1] * scale;

    dest.ctx.setTransform(1, 0, 0, 1, 0, 0);
    dest.ctx.globalCompositeOperation = 'copy';
    dest.ctx.clearRect(0, 0, width, height);
    dest.ctx.globalCompositeOperation = 'source-over';
    dest.ctx.globalAlpha = get<number>('opacity') / 100;

    dest.ctx.save();
    dest.ctx.translate(cx + position[0] * scale, cy + position[1] * scale);
    dest.ctx.rotate((get<number>('rotation') * Math.PI) / 180);
    if (skew !== 0) {
      dest.ctx.rotate(skewAxis);
      dest.ctx.transform(1, 0, Math.tan((skew * Math.PI) / 180), 1, 0, 0);
      dest.ctx.rotate(-skewAxis);
    }
    dest.ctx.scale(get<number>('scaleX') / 100, get<number>('scaleY') / 100);
    dest.ctx.translate(-cx, -cy);
    dest.ctx.drawImage(source.canvas as CanvasImageSource, 0, 0);
    dest.ctx.restore();
    dest.ctx.globalAlpha = 1;
  },
});

registerEffect({
  matchName: 'ADBE Offset',
  name: 'Offset',
  category: 'Distort',
  params: [
    { key: 'shift', name: 'Shift Center To', kind: 'vec2', default: [0, 0], dimensionNames: ['X', 'Y'] },
    { key: 'blend', name: 'Blend With Original', kind: 'percent', default: 0, min: 0, max: 100, unit: '%' },
  ],
  apply: ({ source, dest, width, height, scale, get }) => {
    const shift = get<Vec2>('shift');
    const dx = shift[0] * scale;
    const dy = shift[1] * scale;

    dest.ctx.setTransform(1, 0, 0, 1, 0, 0);
    dest.ctx.globalCompositeOperation = 'copy';
    dest.ctx.clearRect(0, 0, width, height);
    dest.ctx.globalCompositeOperation = 'source-over';
    dest.ctx.globalAlpha = 1 - get<number>('blend') / 100;

    // Offset wraps, so the image is drawn in all four wrapped positions.
    const ox = ((dx % width) + width) % width;
    const oy = ((dy % height) + height) % height;
    for (const x of [ox - width, ox]) {
      for (const y of [oy - height, oy]) {
        dest.ctx.drawImage(source.canvas as CanvasImageSource, x, y);
      }
    }
    dest.ctx.globalAlpha = 1;
  },
});

registerEffect({
  matchName: 'ADBE Polar Coordinates',
  name: 'Polar Coordinates',
  category: 'Distort',
  params: [
    { key: 'interpolation', name: 'Interpolation', kind: 'percent', default: 100, min: 0, max: 100, unit: '%' },
    {
      key: 'type',
      name: 'Type of Conversion',
      kind: 'select',
      default: 0,
      options: ['Rect to Polar', 'Polar to Rect'],
    },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const amount = get<number>('interpolation') / 100;
    if (amount <= 0) {
      copyBuffer(source, dest, width, height);
      return;
    }
    const rectToPolar = Math.round(get<number>('type')) === 0;
    const cx = width / 2;
    const cy = height / 2;
    const maxRadius = Math.hypot(cx, cy);

    remapPixels(source, dest, width, height, (x, y, out) => {
      if (rectToPolar) {
        // The output is polar: angle across, radius down.
        const angle = Math.atan2(y - cy, x - cx);
        const radius = Math.hypot(x - cx, y - cy);
        const sx = ((angle + Math.PI) / (2 * Math.PI)) * width;
        const sy = (radius / maxRadius) * height;
        out[0] = x + (sx - x) * amount;
        out[1] = y + (sy - y) * amount;
      } else {
        const angle = (x / width) * 2 * Math.PI - Math.PI;
        const radius = (y / height) * maxRadius;
        const sx = cx + Math.cos(angle) * radius;
        const sy = cy + Math.sin(angle) * radius;
        out[0] = x + (sx - x) * amount;
        out[1] = y + (sy - y) * amount;
      }
    });
  },
});

registerEffect({
  matchName: 'ADBE Wave Warp',
  name: 'Wave Warp',
  category: 'Distort',
  params: [
    { key: 'waveType', name: 'Wave Type', kind: 'select', default: 0, options: ['Sine', 'Square', 'Triangle'] },
    { key: 'waveHeight', name: 'Wave Height', kind: 'number', default: 30 },
    { key: 'waveWidth', name: 'Wave Width', kind: 'number', default: 90, min: 1 },
    { key: 'direction', name: 'Direction', kind: 'angle', default: 90, unit: '°' },
    { key: 'phase', name: 'Phase', kind: 'angle', default: 0, unit: '°' },
  ],
  margin: (get) => Math.abs(get<number>('waveHeight')),
  apply: ({ source, dest, width, height, scale, get }) => {
    const type = Math.round(get<number>('waveType'));
    const amplitude = get<number>('waveHeight') * scale;
    const wavelength = Math.max(1, get<number>('waveWidth') * scale);
    const direction = (get<number>('direction') * Math.PI) / 180;
    const phase = (get<number>('phase') * Math.PI) / 180;

    const dirX = Math.cos(direction);
    const dirY = Math.sin(direction);

    const wave = (t: number): number => {
      if (type === 1) return Math.sin(t) >= 0 ? 1 : -1;
      if (type === 2) return (2 / Math.PI) * Math.asin(Math.sin(t));
      return Math.sin(t);
    };

    remapPixels(source, dest, width, height, (x, y, out) => {
      // Displacement runs along the wave direction, driven by the distance
      // across it, which is what makes the ripple travel sideways.
      const along = x * -dirY + y * dirX;
      const offset = wave((along / wavelength) * 2 * Math.PI + phase) * amplitude;
      out[0] = x + dirX * offset;
      out[1] = y + dirY * offset;
    });
  },
});

registerEffect({
  matchName: 'ADBE BULGE',
  name: 'Bulge',
  category: 'Distort',
  params: [
    { key: 'centre', name: 'Bulge Center', kind: 'vec2', default: [0, 0], dimensionNames: ['X', 'Y'] },
    { key: 'horizontalRadius', name: 'Horizontal Radius', kind: 'number', default: 200, min: 1 },
    { key: 'verticalRadius', name: 'Vertical Radius', kind: 'number', default: 200, min: 1 },
    { key: 'height', name: 'Bulge Height', kind: 'number', default: 1, min: -4, max: 4, speedPerPixel: 0.02 },
  ],
  apply: ({ source, dest, width, height, scale, get }) => {
    const centre = get<Vec2>('centre');
    const rx = Math.max(1, get<number>('horizontalRadius') * scale);
    const ry = Math.max(1, get<number>('verticalRadius') * scale);
    const strength = get<number>('height');
    const cx = width / 2 + centre[0] * scale;
    const cy = height / 2 + centre[1] * scale;

    remapPixels(source, dest, width, height, (x, y, out) => {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const distance = Math.hypot(nx, ny);
      if (distance >= 1 || distance === 0) return;
      // Sample closer to the centre as the bulge grows, which magnifies.
      const factor = 1 - strength * (1 - distance) * (1 - distance);
      out[0] = cx + nx * rx * factor;
      out[1] = cy + ny * ry * factor;
    });
  },
});

registerEffect({
  matchName: 'ADBE Twirl',
  name: 'Twirl',
  category: 'Distort',
  params: [
    { key: 'angle', name: 'Angle', kind: 'angle', default: 90, unit: '°' },
    { key: 'radius', name: 'Twirl Radius', kind: 'percent', default: 40, min: 0, max: 200, unit: '%' },
    { key: 'centre', name: 'Twirl Center', kind: 'vec2', default: [0, 0], dimensionNames: ['X', 'Y'] },
  ],
  apply: ({ source, dest, width, height, scale, get }) => {
    const angle = (get<number>('angle') * Math.PI) / 180;
    const centre = get<Vec2>('centre');
    const cx = width / 2 + centre[0] * scale;
    const cy = height / 2 + centre[1] * scale;
    const radius = (get<number>('radius') / 100) * Math.hypot(width, height) / 2;
    if (radius <= 0) {
      copyBuffer(source, dest, width, height);
      return;
    }

    remapPixels(source, dest, width, height, (x, y, out) => {
      const dx = x - cx;
      const dy = y - cy;
      const distance = Math.hypot(dx, dy);
      if (distance >= radius) return;
      // The twist falls off to nothing at the radius.
      const amount = angle * (1 - distance / radius) ** 2;
      const cos = Math.cos(amount);
      const sin = Math.sin(amount);
      out[0] = cx + dx * cos - dy * sin;
      out[1] = cy + dx * sin + dy * cos;
    });
  },
});
