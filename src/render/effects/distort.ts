import { copyBuffer, fractalNoise, luminance, remapPixels } from './pixels';
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

registerEffect({
  matchName: 'ADBE Turbulent Displace',
  name: 'Turbulent Displace',
  category: 'Distort',
  params: [
    {
      key: 'displacement', name: 'Displacement', kind: 'select', default: 0,
      options: ['Turbulent', 'Bulge', 'Twist', 'Turbulent Smoother', 'Vertical Displacement', 'Horizontal Displacement'],
    },
    { key: 'amount', name: 'Amount', kind: 'number', default: 50, min: 0 },
    { key: 'size', name: 'Size', kind: 'number', default: 100, min: 1 },
    { key: 'offset', name: 'Offset (Turbulence)', kind: 'vec2', default: [0, 0], dimensionNames: ['X', 'Y'] },
    { key: 'complexity', name: 'Complexity', kind: 'number', default: 2, min: 1, max: 8 },
    { key: 'evolution', name: 'Evolution', kind: 'angle', default: 0, unit: '°' },
  ],
  margin: (get) => get<number>('amount') * 0.6,
  apply: ({ source, dest, width, height, scale, get }) => {
    const mode = Math.round(get<number>('displacement'));
    const amount = (get<number>('amount') / 100) * 60 * scale;
    const size = Math.max(1, get<number>('size')) * scale;
    const offset = get<Vec2>('offset');
    const octaves = Math.max(1, Math.min(8, Math.round(get<number>('complexity'))));
    const evolution = get<number>('evolution') / 360;

    remapPixels(source, dest, width, height, (x, y, out) => {
      const nx = (x + offset[0] * scale) / size;
      const ny = (y + offset[1] * scale) / size;
      // Two noise fields, offset from each other, give an X and a Y push.
      const dx = (fractalNoise(nx, ny, evolution, octaves) - 0.5) * 2 * amount;
      const dy = (fractalNoise(nx + 37.2, ny + 19.4, evolution, octaves) - 0.5) * 2 * amount;
      out[0] = x + (mode === 4 ? 0 : dx);
      out[1] = y + (mode === 5 ? 0 : dy);
    });
  },
});

registerEffect({
  matchName: 'ADBE Displacement Map',
  name: 'Displacement Map',
  category: 'Distort',
  params: [
    {
      key: 'useForHorizontal', name: 'Use For Horizontal', kind: 'select', default: 4,
      options: ['Red', 'Green', 'Blue', 'Alpha', 'Luminance', 'Off'],
    },
    { key: 'maxHorizontal', name: 'Max Horizontal Displacement', kind: 'number', default: 20 },
    {
      key: 'useForVertical', name: 'Use For Vertical', kind: 'select', default: 4,
      options: ['Red', 'Green', 'Blue', 'Alpha', 'Luminance', 'Off'],
    },
    { key: 'maxVertical', name: 'Max Vertical Displacement', kind: 'number', default: 20 },
  ],
  margin: (get) => Math.max(
    Math.abs(get<number>('maxHorizontal')), Math.abs(get<number>('maxVertical')),
  ),
  apply: ({ source, dest, width, height, scale, get }) => {
    // The layer displaces itself: without a second layer to sample, its own
    // channels are the map, which is how the effect is most often used anyway.
    const map = source.ctx.getImageData(0, 0, width, height).data;
    const horizontalChannel = Math.round(get<number>('useForHorizontal'));
    const verticalChannel = Math.round(get<number>('useForVertical'));
    const maxH = get<number>('maxHorizontal') * scale;
    const maxV = get<number>('maxVertical') * scale;

    const channelAt = (which: number, i: number): number => {
      switch (which) {
        case 0: return map[i];
        case 1: return map[i + 1];
        case 2: return map[i + 2];
        case 3: return map[i + 3];
        case 4: return luminance(map[i], map[i + 1], map[i + 2]);
        default: return 128;
      }
    };

    remapPixels(source, dest, width, height, (x, y, out) => {
      const i = (y * width + x) * 4;
      const h = (channelAt(horizontalChannel, i) / 255 - 0.5) * 2;
      const v = (channelAt(verticalChannel, i) / 255 - 0.5) * 2;
      out[0] = x + h * maxH;
      out[1] = y + v * maxV;
    });
  },
});

registerEffect({
  matchName: 'ADBE Ripple',
  name: 'Ripple',
  category: 'Distort',
  params: [
    { key: 'radius', name: 'Radius', kind: 'percent', default: 30, min: 0, max: 100, unit: '%' },
    { key: 'centre', name: 'Center of Ripple', kind: 'vec2', default: [0, 0], dimensionNames: ['X', 'Y'] },
    { key: 'conversion', name: 'Type of Conversion', kind: 'select', default: 0, options: ['Asymmetric', 'Symmetric'] },
    { key: 'waveSpeed', name: 'Wave Speed', kind: 'number', default: 1, min: -10, max: 10, speedPerPixel: 0.02 },
    { key: 'waveWidth', name: 'Wave Width', kind: 'number', default: 40, min: 1 },
    { key: 'waveHeight', name: 'Wave Height', kind: 'number', default: 30 },
    { key: 'phase', name: 'Phase', kind: 'angle', default: 0, unit: '°' },
  ],
  margin: (get) => Math.abs(get<number>('waveHeight')),
  apply: ({ source, dest, width, height, scale, time, get }) => {
    const centre = get<Vec2>('centre');
    const cx = width / 2 + centre[0] * scale;
    const cy = height / 2 + centre[1] * scale;
    const maxRadius = (get<number>('radius') / 100) * Math.hypot(width, height) / 2;
    const waveWidth = Math.max(1, get<number>('waveWidth') * scale);
    const waveHeight = get<number>('waveHeight') * scale;
    const phase = (get<number>('phase') * Math.PI) / 180 + time * get<number>('waveSpeed') * Math.PI * 2;
    const symmetric = Math.round(get<number>('conversion')) === 1;

    remapPixels(source, dest, width, height, (x, y, out) => {
      const dx = x - cx;
      const dy = y - cy;
      const distance = Math.hypot(dx, dy);
      if (maxRadius <= 0 || distance > maxRadius || distance === 0) return;
      // Rings fade out towards the edge of the ripple's reach.
      const falloff = symmetric ? 1 : 1 - distance / maxRadius;
      const push = Math.sin((distance / waveWidth) * Math.PI * 2 - phase) * waveHeight * falloff;
      out[0] = x + (dx / distance) * push;
      out[1] = y + (dy / distance) * push;
    });
  },
});

registerEffect({
  matchName: 'ADBE Corner Pin',
  name: 'Corner Pin',
  category: 'Distort',
  params: [
    { key: 'topLeft', name: 'Upper Left', kind: 'vec2', default: [0, 0], dimensionNames: ['X', 'Y'] },
    { key: 'topRight', name: 'Upper Right', kind: 'vec2', default: [0, 0], dimensionNames: ['X', 'Y'] },
    { key: 'bottomLeft', name: 'Lower Left', kind: 'vec2', default: [0, 0], dimensionNames: ['X', 'Y'] },
    { key: 'bottomRight', name: 'Lower Right', kind: 'vec2', default: [0, 0], dimensionNames: ['X', 'Y'] },
  ],
  apply: ({ source, dest, width, height, scale, get }) => {
    const corners = (['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const)
      .map((key) => get<Vec2>(key));
    const tl: [number, number] = [corners[0][0] * scale, corners[0][1] * scale];
    const tr: [number, number] = [width + corners[1][0] * scale, corners[1][1] * scale];
    const bl: [number, number] = [corners[2][0] * scale, height + corners[2][1] * scale];
    const br: [number, number] = [width + corners[3][0] * scale, height + corners[3][1] * scale];

    // Bilinear corner pin: each output point is found by interpolating the
    // four corners, then inverted by searching in normalized space.
    remapPixels(source, dest, width, height, (x, y, out) => {
      const found = invertBilinear(x, y, tl, tr, bl, br);
      if (!found) {
        out[0] = -1;
        out[1] = -1;
        return;
      }
      out[0] = found[0] * width;
      out[1] = found[1] * height;
    });
  },
});

/** Find (u,v) in 0..1 such that the bilinear quad maps it to (x,y). */
function invertBilinear(
  x: number, y: number,
  tl: [number, number], tr: [number, number],
  bl: [number, number], br: [number, number],
): [number, number] | null {
  let u = 0.5;
  let v = 0.5;
  for (let i = 0; i < 12; i += 1) {
    const top = [tl[0] + (tr[0] - tl[0]) * u, tl[1] + (tr[1] - tl[1]) * u];
    const bottom = [bl[0] + (br[0] - bl[0]) * u, bl[1] + (br[1] - bl[1]) * u];
    const px = top[0] + (bottom[0] - top[0]) * v;
    const py = top[1] + (bottom[1] - top[1]) * v;

    // Numerical Jacobian: two small steps tell us which way to move.
    const eps = 1e-3;
    const du = bilinearPoint(tl, tr, bl, br, u + eps, v);
    const dv = bilinearPoint(tl, tr, bl, br, u, v + eps);
    const j00 = (du[0] - px) / eps;
    const j01 = (dv[0] - px) / eps;
    const j10 = (du[1] - py) / eps;
    const j11 = (dv[1] - py) / eps;
    const det = j00 * j11 - j01 * j10;
    if (Math.abs(det) < 1e-9) return null;

    const rx = x - px;
    const ry = y - py;
    u += (j11 * rx - j01 * ry) / det;
    v += (-j10 * rx + j00 * ry) / det;
    if (u < -0.2 || u > 1.2 || v < -0.2 || v > 1.2) return null;
  }
  return u < 0 || u > 1 || v < 0 || v > 1 ? null : [u, v];
}

function bilinearPoint(
  tl: [number, number], tr: [number, number],
  bl: [number, number], br: [number, number],
  u: number, v: number,
): [number, number] {
  const top = [tl[0] + (tr[0] - tl[0]) * u, tl[1] + (tr[1] - tl[1]) * u];
  const bottom = [bl[0] + (br[0] - bl[0]) * u, bl[1] + (br[1] - bl[1]) * u];
  return [top[0] + (bottom[0] - top[0]) * v, top[1] + (bottom[1] - top[1]) * v];
}

registerEffect({
  matchName: 'ADBE Optics Compensation',
  name: 'Optics Compensation',
  category: 'Distort',
  params: [
    { key: 'fieldOfView', name: 'Field of View', kind: 'number', default: 0, min: 0, max: 200 },
    { key: 'reverse', name: 'Reverse Lens Distortion', kind: 'checkbox', default: 0 },
    { key: 'centre', name: 'View Center', kind: 'vec2', default: [0, 0], dimensionNames: ['X', 'Y'] },
  ],
  apply: ({ source, dest, width, height, scale, get }) => {
    const fov = get<number>('fieldOfView') / 100;
    if (fov <= 0) {
      copyBuffer(source, dest, width, height);
      return;
    }
    const reverse = get<number>('reverse') >= 0.5;
    const centre = get<Vec2>('centre');
    const cx = width / 2 + centre[0] * scale;
    const cy = height / 2 + centre[1] * scale;
    const maxRadius = Math.hypot(width, height) / 2;

    remapPixels(source, dest, width, height, (x, y, out) => {
      const dx = (x - cx) / maxRadius;
      const dy = (y - cy) / maxRadius;
      const r2 = dx * dx + dy * dy;
      // A simple radial polynomial: barrel one way, pincushion the other.
      const factor = reverse ? 1 / (1 + fov * r2) : 1 + fov * r2;
      out[0] = cx + dx * maxRadius * factor;
      out[1] = cy + dy * maxRadius * factor;
    });
  },
});
