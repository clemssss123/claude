import { blurBuffer, copyBuffer, mapPixels } from './pixels';
import { registerEffect } from './registry';
import type { Vec2 } from '@/core/types';

/** Blur & Sharpen. */

registerEffect({
  matchName: 'ADBE Gaussian Blur 2',
  name: 'Gaussian Blur',
  category: 'Blur & Sharpen',
  params: [
    { key: 'blurriness', name: 'Blurriness', kind: 'number', default: 20, min: 0 },
    {
      key: 'dimensions',
      name: 'Blur Dimensions',
      kind: 'select',
      default: 0,
      options: ['Horizontal and Vertical', 'Horizontal', 'Vertical'],
    },
  ],
  margin: (get) => get<number>('blurriness') * 2,
  apply: ({ source, dest, width, height, scale, pool, get }) => {
    const amount = get<number>('blurriness') * scale;
    const dimensions = Math.round(get<number>('dimensions'));
    blurBuffer(
      source, dest, width, height,
      dimensions === 2 ? 0 : amount,
      dimensions === 1 ? 0 : amount,
      pool,
    );
  },
});

registerEffect({
  matchName: 'ADBE Box Blur2',
  name: 'Fast Box Blur',
  category: 'Blur & Sharpen',
  params: [
    { key: 'radius', name: 'Blur Radius', kind: 'number', default: 12, min: 0 },
    { key: 'iterations', name: 'Iterations', kind: 'number', default: 2, min: 1, max: 8 },
  ],
  margin: (get) => get<number>('radius') * 2,
  apply: ({ source, dest, width, height, scale, pool, get }) => {
    const radius = get<number>('radius') * scale;
    const iterations = Math.max(1, Math.round(get<number>('iterations')));
    // Repeated small blurs approach a gaussian, which is the point of a box
    // blur: each pass costs the same but the falloff gets smoother.
    const perPass = radius / Math.sqrt(iterations);

    let from = source;
    let to = dest;
    const temp = pool.sized('fxBoxTemp', width, height);
    for (let i = 0; i < iterations; i += 1) {
      blurBuffer(from, to, width, height, perPass, perPass, pool);
      if (i < iterations - 1) {
        const next = to === dest ? temp : dest;
        from = to;
        to = next;
      }
    }
    if (to !== dest) copyBuffer(from, dest, width, height);
  },
});

registerEffect({
  matchName: 'ADBE Motion Blur',
  name: 'Directional Blur',
  category: 'Blur & Sharpen',
  params: [
    { key: 'direction', name: 'Direction', kind: 'angle', default: 0, unit: '°' },
    { key: 'length', name: 'Blur Length', kind: 'number', default: 20, min: 0 },
  ],
  margin: (get) => get<number>('length'),
  apply: ({ source, dest, width, height, scale, get }) => {
    const length = get<number>('length') * scale;
    if (length <= 0.5) {
      copyBuffer(source, dest, width, height);
      return;
    }
    const angle = ((get<number>('direction') - 90) * Math.PI) / 180;
    const samples = Math.min(64, Math.max(3, Math.round(length)));
    const dx = (Math.cos(angle) * length) / (samples - 1);
    const dy = (Math.sin(angle) * length) / (samples - 1);

    dest.ctx.setTransform(1, 0, 0, 1, 0, 0);
    dest.ctx.globalCompositeOperation = 'copy';
    dest.ctx.globalAlpha = 1;
    dest.ctx.clearRect(0, 0, width, height);
    dest.ctx.globalCompositeOperation = 'source-over';
    dest.ctx.globalAlpha = 1 / samples;
    for (let i = 0; i < samples; i += 1) {
      const t = i - (samples - 1) / 2;
      dest.ctx.drawImage(source.canvas as CanvasImageSource, dx * t, dy * t);
    }
    dest.ctx.globalAlpha = 1;
  },
});

registerEffect({
  matchName: 'ADBE Radial Blur',
  name: 'Radial Blur',
  category: 'Blur & Sharpen',
  params: [
    { key: 'amount', name: 'Amount', kind: 'number', default: 10, min: 0 },
    { key: 'centre', name: 'Center', kind: 'vec2', default: [0, 0], dimensionNames: ['X', 'Y'] },
    { key: 'type', name: 'Type', kind: 'select', default: 0, options: ['Spin', 'Zoom'] },
    { key: 'samples', name: 'Samples', kind: 'number', default: 16, min: 2, max: 64 },
  ],
  apply: ({ source, dest, width, height, scale, get }) => {
    const amount = get<number>('amount');
    const samples = Math.min(64, Math.max(2, Math.round(get<number>('samples'))));
    const centre = get<Vec2>('centre');
    const cx = width / 2 + centre[0] * scale;
    const cy = height / 2 + centre[1] * scale;
    const spin = Math.round(get<number>('type')) === 0;

    dest.ctx.setTransform(1, 0, 0, 1, 0, 0);
    dest.ctx.globalCompositeOperation = 'copy';
    dest.ctx.clearRect(0, 0, width, height);
    dest.ctx.globalCompositeOperation = 'source-over';
    dest.ctx.globalAlpha = 1 / samples;

    for (let i = 0; i < samples; i += 1) {
      const t = (i / (samples - 1) - 0.5) * 2;
      dest.ctx.save();
      dest.ctx.translate(cx, cy);
      if (spin) dest.ctx.rotate((amount * t * Math.PI) / 180);
      else {
        const zoom = 1 + (amount / 100) * t * 0.5;
        dest.ctx.scale(zoom, zoom);
      }
      dest.ctx.translate(-cx, -cy);
      dest.ctx.drawImage(source.canvas as CanvasImageSource, 0, 0);
      dest.ctx.restore();
    }
    dest.ctx.globalAlpha = 1;
  },
});

registerEffect({
  matchName: 'ADBE Sharpen',
  name: 'Sharpen',
  category: 'Blur & Sharpen',
  params: [
    { key: 'amount', name: 'Sharpen Amount', kind: 'number', default: 20, min: 0, max: 400 },
  ],
  apply: ({ source, dest, width, height, pool, get }) => {
    const amount = get<number>('amount') / 100;
    if (amount <= 0) {
      copyBuffer(source, dest, width, height);
      return;
    }
    // Unsharp mask: the difference between the image and a blurred copy of
    // it is the detail, and sharpening is adding that detail back.
    const blurred = pool.sized('fxSharpenBlur', width, height);
    blurBuffer(source, blurred, width, height, 2, 2, pool);
    const blurData = blurred.ctx.getImageData(0, 0, width, height).data;

    mapPixels(source, dest, width, height, (r, g, b, a, x, y, out) => {
      const i = (y * width + x) * 4;
      out[0] = r + (r - blurData[i]) * amount;
      out[1] = g + (g - blurData[i + 1]) * amount;
      out[2] = b + (b - blurData[i + 2]) * amount;
      out[3] = a;
    });
  },
});
