import { blurBuffer, copyBuffer, luminance, mapPixels } from './pixels';
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
    for (let i = 0; i < samples; i += 1) {
      const t = i - (samples - 1) / 2;
      // A running average: the nth copy goes on at 1/(n+1), which leaves an
      // opaque region opaque. Drawing every copy at a flat 1/samples never
      // reaches full alpha (it converges to about 63%), so the blur would
      // quietly make the layer see-through.
      dest.ctx.globalAlpha = 1 / (i + 1);
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

    for (let i = 0; i < samples; i += 1) {
      const t = (i / (samples - 1) - 0.5) * 2;
      // Running average, so the blur keeps the layer's opacity — see the
      // note in Directional Blur.
      dest.ctx.globalAlpha = 1 / (i + 1);
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

registerEffect({
  matchName: 'ADBE Channel Blur',
  name: 'Channel Blur',
  category: 'Blur & Sharpen',
  params: [
    { key: 'red', name: 'Red Blurriness', kind: 'number', default: 0, min: 0 },
    { key: 'green', name: 'Green Blurriness', kind: 'number', default: 0, min: 0 },
    { key: 'blue', name: 'Blue Blurriness', kind: 'number', default: 0, min: 0 },
    { key: 'alpha', name: 'Alpha Blurriness', kind: 'number', default: 0, min: 0 },
  ],
  margin: (get) => Math.max(
    get<number>('red'), get<number>('green'), get<number>('blue'), get<number>('alpha'),
  ) * 2,
  apply: ({ source, dest, width, height, scale, pool, get }) => {
    // Each channel is blurred on its own copy and the results recombined.
    const radii = [
      get<number>('red') * scale,
      get<number>('green') * scale,
      get<number>('blue') * scale,
      get<number>('alpha') * scale,
    ];
    const planes = radii.map((radius, channel) => {
      if (radius <= 0.01) return null;
      const buffer = pool.sized(`fxChannel${channel}`, width, height);
      blurBuffer(source, buffer, width, height, radius, radius, pool);
      return buffer.ctx.getImageData(0, 0, width, height).data;
    });

    mapPixels(source, dest, width, height, (r, g, b, a, x, y, out) => {
      const i = (y * width + x) * 4;
      out[0] = planes[0] ? planes[0][i] : r;
      out[1] = planes[1] ? planes[1][i + 1] : g;
      out[2] = planes[2] ? planes[2][i + 2] : b;
      out[3] = planes[3] ? planes[3][i + 3] : a;
    });
  },
});

registerEffect({
  matchName: 'ADBE Unsharp Mask2',
  name: 'Unsharp Mask',
  category: 'Blur & Sharpen',
  params: [
    { key: 'amount', name: 'Amount', kind: 'percent', default: 50, min: 0, max: 500, unit: '%' },
    { key: 'radius', name: 'Radius', kind: 'number', default: 2, min: 0.1 },
    { key: 'threshold', name: 'Threshold', kind: 'number', default: 0, min: 0, max: 255 },
  ],
  apply: ({ source, dest, width, height, scale, pool, get }) => {
    const amount = get<number>('amount') / 100;
    const radius = Math.max(0.1, get<number>('radius') * scale);
    const threshold = get<number>('threshold');

    const blurred = pool.sized('fxUnsharp', width, height);
    blurBuffer(source, blurred, width, height, radius, radius, pool);
    const blurData = blurred.ctx.getImageData(0, 0, width, height).data;

    mapPixels(source, dest, width, height, (r, g, b, a, x, y, out) => {
      const i = (y * width + x) * 4;
      // Below the threshold the difference is noise, not detail, so leave it.
      const dr = r - blurData[i];
      const dg = g - blurData[i + 1];
      const db = b - blurData[i + 2];
      out[0] = Math.abs(dr) > threshold ? r + dr * amount : r;
      out[1] = Math.abs(dg) > threshold ? g + dg * amount : g;
      out[2] = Math.abs(db) > threshold ? b + db * amount : b;
      out[3] = a;
    });
  },
});

registerEffect({
  matchName: 'ADBE Camera Lens Blur',
  name: 'Camera Lens Blur',
  category: 'Blur & Sharpen',
  params: [
    { key: 'radius', name: 'Blur Radius', kind: 'number', default: 12, min: 0 },
    { key: 'blades', name: 'Iris Blades', kind: 'number', default: 6, min: 3, max: 12 },
    { key: 'rotation', name: 'Iris Rotation', kind: 'angle', default: 0, unit: '°' },
    { key: 'highlightGain', name: 'Highlight Gain', kind: 'number', default: 0, min: 0, max: 100 },
  ],
  margin: (get) => get<number>('radius') * 2,
  apply: ({ source, dest, width, height, scale, pool, get }) => {
    const radius = get<number>('radius') * scale;
    if (radius <= 0.5) {
      copyBuffer(source, dest, width, height);
      return;
    }
    const blades = Math.max(3, Math.round(get<number>('blades')));
    const rotation = (get<number>('rotation') * Math.PI) / 180;
    const gain = get<number>('highlightGain') / 100;

    // A polygonal iris is approximated by offsetting copies around the blade
    // vertices, which is what gives lens bokeh its shape rather than a disc.
    const boosted = pool.sized('fxLensBoost', width, height);
    if (gain > 0) {
      mapPixels(source, boosted, width, height, (r, g, b, a, _x, _y, out) => {
        const l = luminance(r, g, b) / 255;
        const boost = 1 + gain * 3 * l * l;
        out[0] = r * boost;
        out[1] = g * boost;
        out[2] = b * boost;
        out[3] = a;
      });
    } else {
      copyBuffer(source, boosted, width, height);
    }

    dest.ctx.setTransform(1, 0, 0, 1, 0, 0);
    dest.ctx.globalCompositeOperation = 'copy';
    dest.ctx.clearRect(0, 0, width, height);
    dest.ctx.globalCompositeOperation = 'source-over';

    const rings = 3;
    // Running average again: a flat 1/samples would leave the whole layer
    // translucent, which an out-of-focus image is not.
    let drawn = 0;
    const average = () => { dest.ctx.globalAlpha = 1 / (drawn + 1); drawn += 1; };
    dest.ctx.filter = `blur(${radius / 6}px)`;
    average();
    dest.ctx.drawImage(boosted.canvas as CanvasImageSource, 0, 0);
    for (let ring = 1; ring <= rings; ring += 1) {
      const r = (radius * ring) / rings;
      for (let blade = 0; blade < blades; blade += 1) {
        const angle = rotation + (blade / blades) * Math.PI * 2;
        average();
        dest.ctx.drawImage(
          boosted.canvas as CanvasImageSource,
          Math.cos(angle) * r,
          Math.sin(angle) * r,
        );
      }
    }
    dest.ctx.filter = 'none';
    dest.ctx.globalAlpha = 1;
  },
});

registerEffect({
  matchName: 'ADBE Bilateral',
  name: 'Bilateral Blur',
  category: 'Blur & Sharpen',
  params: [
    { key: 'radius', name: 'Radius', kind: 'number', default: 3, min: 1, max: 12 },
    { key: 'threshold', name: 'Threshold', kind: 'number', default: 40, min: 1, max: 255 },
  ],
  apply: ({ source, dest, width, height, get }) => {
    const radius = Math.min(12, Math.max(1, Math.round(get<number>('radius'))));
    const threshold = Math.max(1, get<number>('threshold'));
    const data = source.ctx.getImageData(0, 0, width, height).data;

    // Neighbours only count when they are close in colour, which smooths flat
    // areas while leaving edges alone.
    mapPixels(source, dest, width, height, (r, g, b, a, x, y, out) => {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let total = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const px = Math.min(width - 1, Math.max(0, x + dx));
          const py = Math.min(height - 1, Math.max(0, y + dy));
          const i = (py * width + px) * 4;
          const difference = Math.abs(data[i] - r) + Math.abs(data[i + 1] - g)
            + Math.abs(data[i + 2] - b);
          if (difference > threshold * 3) continue;
          const weight = 1 - difference / (threshold * 3);
          sr += data[i] * weight;
          sg += data[i + 1] * weight;
          sb += data[i + 2] * weight;
          total += weight;
        }
      }
      if (total <= 0) return;
      out[0] = sr / total;
      out[1] = sg / total;
      out[2] = sb / total;
      out[3] = a;
    });
  },
});
