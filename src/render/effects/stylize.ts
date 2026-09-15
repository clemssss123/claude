import {
  blurBuffer, clamp, clamp01, copyBuffer, fbm, hashNoise, luminance, mapPixels,
  remapPixels, rgbaTo255,
} from './pixels';
import { registerEffect } from './registry';
import type { Buffer } from '../buffers';
import type { RGBA, Vec2 } from '@/core/types';

/** Stylize. */

registerEffect({
  matchName: 'ADBE Glo2',
  name: 'Glow',
  category: 'Stylize',
  params: [
    {
      key: 'basedOn', name: 'Glow Based On', kind: 'select', default: 0,
      options: ['Color Channels', 'Alpha Channel'],
    },
    { key: 'threshold', name: 'Glow Threshold', kind: 'percent', default: 60, min: 0, max: 100, unit: '%' },
    { key: 'radius', name: 'Glow Radius', kind: 'number', default: 30, min: 0 },
    { key: 'intensity', name: 'Glow Intensity', kind: 'number', default: 1, min: 0, max: 10, speedPerPixel: 0.02 },
    {
      key: 'composite', name: 'Composite Original', kind: 'select', default: 0,
      options: ['On Top', 'Behind', 'None'],
    },
    {
      key: 'operation', name: 'Glow Operation', kind: 'select', default: 1,
      options: ['Normal', 'Add', 'Screen'],
    },
    {
      key: 'colours', name: 'Glow Colors', kind: 'select', default: 0,
      options: ['Original Colors', 'A & B Colors'],
    },
    {
      key: 'looping', name: 'Color Looping', kind: 'select', default: 1,
      options: ['Sawtooth A>B', 'Triangle A>B>A', 'Sawtooth B>A'],
    },
    { key: 'loops', name: 'Color Loops', kind: 'number', default: 1, min: 0.1, max: 16, speedPerPixel: 0.02 },
    { key: 'phase', name: 'Color Phase', kind: 'angle', default: 0, unit: '°' },
    { key: 'midpoint', name: 'A & B Midpoint', kind: 'percent', default: 50, min: 1, max: 99, unit: '%' },
    { key: 'colourA', name: 'Color A', kind: 'color', default: [1, 0.35, 0.1, 1] },
    { key: 'colourB', name: 'Color B', kind: 'color', default: [0.1, 0.45, 1, 1] },
    {
      key: 'dimensions', name: 'Glow Dimensions', kind: 'select', default: 0,
      options: ['Horizontal and Vertical', 'Horizontal', 'Vertical'],
    },
  ],
  margin: (get) => get<number>('radius') * 2,
  apply: ({ source, dest, width, height, scale, pool, get }) => {
    const basedOnAlpha = Math.round(get<number>('basedOn')) === 1;
    const threshold = (get<number>('threshold') / 100) * 255;
    const radius = get<number>('radius') * scale;
    const intensity = get<number>('intensity');
    const composite = Math.round(get<number>('composite'));
    const operation = Math.round(get<number>('operation'));
    const tinted = Math.round(get<number>('colours')) === 1;
    const dimensions = Math.round(get<number>('dimensions'));

    // Keep only what is brighter than the threshold, blur it, add it back.
    const bright = pool.sized('fxGlowBright', width, height);
    mapPixels(source, bright, width, height, (r, g, b, a, _x, _y, out) => {
      // AE glows on either the colour channels or the alpha, and the two
      // give quite different results on a soft-edged layer.
      const level = basedOnAlpha ? a : luminance(r, g, b);
      if (level <= threshold || a === 0) {
        out[3] = 0;
        return;
      }
      const strength = clamp01((level - threshold) / Math.max(1, 255 - threshold));
      out[0] = r;
      out[1] = g;
      out[2] = b;
      out[3] = a * strength;
    });

    const blurred = pool.sized('fxGlowBlur', width, height);
    blurBuffer(
      bright, blurred, width, height,
      dimensions === 2 ? 0 : radius,
      dimensions === 1 ? 0 : radius,
      pool,
    );

    // A & B Colors runs the glow's own brightness through a two-colour ramp,
    // which is where the sci-fi look of AE's Glow comes from.
    let painted = blurred;
    if (tinted) {
      const ramp = pool.sized('fxGlowRamp', width, height);
      const a255 = rgbaTo255(get<RGBA>('colourA'));
      const b255 = rgbaTo255(get<RGBA>('colourB'));
      const loops = Math.max(0.1, get<number>('loops'));
      const phase = get<number>('phase') / 360;
      const midpoint = clamp01(get<number>('midpoint') / 100);
      const looping = Math.round(get<number>('looping'));

      mapPixels(blurred, ramp, width, height, (r, g, b, a, _x, _y, out) => {
        if (a === 0) return;
        const level = luminance(r, g, b) / 255;
        let t = (level * loops + phase) % 1;
        if (t < 0) t += 1;
        if (looping === 1) t = t < 0.5 ? t * 2 : 2 - t * 2;
        else if (looping === 2) t = 1 - t;
        // The midpoint bends the ramp towards one colour or the other.
        const shaped = t < midpoint
          ? (t / midpoint) * 0.5
          : 0.5 + ((t - midpoint) / (1 - midpoint)) * 0.5;
        out[0] = a255[0] + (b255[0] - a255[0]) * shaped;
        out[1] = a255[1] + (b255[1] - a255[1]) * shaped;
        out[2] = a255[2] + (b255[2] - a255[2]) * shaped;
        out[3] = a;
      });
      painted = ramp;
    }

    dest.ctx.setTransform(1, 0, 0, 1, 0, 0);
    dest.ctx.globalCompositeOperation = 'copy';
    dest.ctx.globalAlpha = 1;
    dest.ctx.clearRect(0, 0, width, height);
    dest.ctx.globalCompositeOperation = 'source-over';

    if (composite === 1) drawGlow(dest, painted, intensity, operation);
    if (composite !== 2) dest.ctx.drawImage(source.canvas as CanvasImageSource, 0, 0);
    if (composite !== 1) drawGlow(dest, painted, intensity, operation);
  },
});

/**
 * Lay the glow over the frame. Intensity above 1 means drawing it more than
 * once: a single pass cannot exceed full brightness, and a glow that cannot
 * blow out is not a glow.
 */
function drawGlow(
  dest: { ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D },
  blurred: { canvas: HTMLCanvasElement | OffscreenCanvas },
  intensity: number,
  operation: number,
): void {
  if (intensity <= 0) return;
  const mode = operation === 0 ? 'source-over' : operation === 2 ? 'screen' : 'lighter';
  const passes = Math.max(1, Math.ceil(intensity));
  dest.ctx.globalCompositeOperation = mode as GlobalCompositeOperation;
  for (let i = 0; i < passes; i += 1) {
    dest.ctx.globalAlpha = Math.min(1, intensity - i);
    dest.ctx.drawImage(blurred.canvas as CanvasImageSource, 0, 0);
  }
  dest.ctx.globalAlpha = 1;
  dest.ctx.globalCompositeOperation = 'source-over';
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
        // Phase slides *alternate* rows (or columns) along — a brick course,
        // not a shear. Multiplying by the row index instead walks the tiles
        // further and further off, which no amount of phase in the original
        // ever does.
        const shift = horizontalPhase && row % 2 === 1 ? phase * tileW : 0;
        const verticalShift = !horizontalPhase && column % 2 === 1 ? phase * tileH : 0;
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
      const linear = clamp01((distance - maxDistance * (1 - softness)) / (maxDistance * softness));
      // Smoothstep rather than a straight ramp: a linear vignette has a
      // visible crease where it starts, because the eye reads the change in
      // gradient, not the gradient itself.
      const t = linear * linear * (3 - 2 * linear);
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

registerEffect({
  matchName: 'PLUGIN Deep Glow',
  name: 'Deep Glow',
  category: 'Stylize',
  params: [
    { key: 'exposure', name: 'Exposure', kind: 'number', default: 1, min: 0, max: 8, speedPerPixel: 0.02 },
    { key: 'radius', name: 'Radius', kind: 'number', default: 60, min: 0 },
    { key: 'threshold', name: 'Threshold', kind: 'percent', default: 40, min: 0, max: 100, unit: '%' },
    { key: 'knee', name: 'Threshold Softness', kind: 'percent', default: 40, min: 0, max: 100, unit: '%' },
    { key: 'iterations', name: 'Quality', kind: 'number', default: 5, min: 1, max: 8 },
    { key: 'falloff', name: 'Falloff', kind: 'number', default: 1, min: 0.2, max: 4, speedPerPixel: 0.01 },
    { key: 'chromatic', name: 'Chromatic Aberration', kind: 'percent', default: 20, min: 0, max: 100, unit: '%' },
    { key: 'tint', name: 'Tint', kind: 'color', default: [1, 1, 1, 1] },
    { key: 'tintAmount', name: 'Tint Amount', kind: 'percent', default: 0, min: 0, max: 100, unit: '%' },
    {
      key: 'composite', name: 'Composite', kind: 'select', default: 0,
      options: ['On Top', 'Behind', 'Glow Only'],
    },
  ],
  margin: (get) => get<number>('radius') * 1.5,
  apply: ({ source, dest, width, height, scale, pool, get }) => {
    const exposure = get<number>('exposure');
    const radius = get<number>('radius') * scale;
    const threshold = (get<number>('threshold') / 100) * 255;
    const knee = (get<number>('knee') / 100) * 255 * 0.5;
    const quality = Math.max(1, Math.min(8, Math.round(get<number>('iterations'))));
    const falloff = Math.max(0.2, get<number>('falloff'));
    const chromatic = get<number>('chromatic') / 100;
    const [tr, tg, tb] = rgbaTo255(get<RGBA>('tint'));
    const tintAmount = get<number>('tintAmount') / 100;
    const composite = Math.round(get<number>('composite'));

    // 1. Highlights, with a soft knee. A hard threshold makes the glow start
    //    at a visible contour; the knee eases it in over a range either side,
    //    which is what keeps a real bloom from banding.
    const bright = pool.sized('fxDeepBright', width, height);
    mapPixels(source, bright, width, height, (r, g, b, a, _x, _y, out) => {
      const l = luminance(r, g, b);
      if (a === 0) {
        out[3] = 0;
        return;
      }
      // The standard soft-knee curve: quadratic through the knee, linear
      // past it, nothing below. `gain` is how much of this pixel is glow.
      const soft = clamp(l - threshold + knee, 0, 2 * knee);
      const contribution = Math.max((soft * soft) / (4 * knee + 1e-6), l - threshold);
      const gain = contribution / Math.max(1, l);
      if (gain <= 0) {
        out[3] = 0;
        return;
      }
      out[0] = r + (tr - r) * tintAmount;
      out[1] = g + (tg - g) * tintAmount;
      out[2] = b + (tb - b) * tintAmount;
      out[3] = a * clamp01(gain);
    });

    // 2. A mip pyramid down, then progressively back up, adding each level
    //    into the one above it. Summing separate blurs at full size — the
    //    obvious way — gives a glow made of visible rings, because each blur
    //    has its own hard-edged reach. Carrying the small levels up through
    //    the big ones instead is what produces one smooth falloff that
    //    reaches across the frame, and it is the shape a real lens gives.
    const levels = Math.max(1, Math.min(quality, Math.floor(Math.log2(Math.max(2, radius))) + 1));
    const bloomWidth = Math.max(2, Math.round(width / 2));
    const bloomHeight = Math.max(2, Math.round(height / 2));
    const chain: { buffer: Buffer; w: number; h: number }[] = [];

    let previous = bright;
    let pw = width;
    let ph = height;
    for (let level = 0; level < levels; level += 1) {
      const lw = Math.max(2, Math.round(width / 2 ** (level + 1)));
      const lh = Math.max(2, Math.round(height / 2 ** (level + 1)));
      const down = pool.sized(`fxDeepDown${level}`, lw, lh);
      down.ctx.imageSmoothingEnabled = true;
      down.ctx.imageSmoothingQuality = 'high';
      // A touch of blur before the halving keeps the small levels from
      // sparkling as the source moves under them.
      down.ctx.filter = 'blur(1px)';
      down.ctx.drawImage(previous.canvas as CanvasImageSource, 0, 0, pw, ph, 0, 0, lw, lh);
      down.ctx.filter = 'none';
      chain.push({ buffer: down, w: lw, h: lh });
      previous = down;
      pw = lw;
      ph = lh;
    }

    // Every level is then added back at full size. Each one is a blur at its
    // own resolution, so its *peak* brightness survives the halving even
    // though its reach doubles — which is what lets a handful of cheap
    // levels stand in for one enormous blur. Chaining them into one another
    // instead (a lerp up the pyramid) is the other standard way and it is
    // wrong for a glow: the widest level ends up at a few percent of its
    // strength and the halo disappears.
    const accumulate = pool.sized('fxDeepAccumulate', bloomWidth, bloomHeight);
    let weightTotal = 0;
    for (let level = 0; level < levels; level += 1) weightTotal += 1 / (level * falloff + 1);

    accumulate.ctx.globalCompositeOperation = 'lighter';
    for (let level = 0; level < levels; level += 1) {
      const from = chain[level];
      accumulate.ctx.globalAlpha = clamp01((1 / (level * falloff + 1)) / weightTotal * levels * 0.5);
      accumulate.ctx.drawImage(
        from.buffer.canvas as CanvasImageSource,
        0, 0, from.w, from.h,
        0, 0, bloomWidth, bloomHeight,
      );
    }
    accumulate.ctx.globalAlpha = 1;
    accumulate.ctx.globalCompositeOperation = 'source-over';

    const bloom = { buffer: accumulate, w: bloomWidth, h: bloomHeight };
    dest.ctx.setTransform(1, 0, 0, 1, 0, 0);
    dest.ctx.globalCompositeOperation = 'copy';
    dest.ctx.clearRect(0, 0, width, height);
    dest.ctx.globalCompositeOperation = 'source-over';
    dest.ctx.globalAlpha = 1;

    // Chromatic aberration is radial in a lens, not sideways: each channel
    // focuses at its own scale, so the fringe spreads outward from the centre
    // and warms one side of the bloom while it cools the other.
    let glow = bloom.buffer;
    if (chromatic > 0.01) {
      const aberrated = pool.sized('fxDeepAberrated', bloom.w, bloom.h);
      const channel = pool.sized('fxDeepChannel', bloom.w, bloom.h);
      const spread = chromatic * 0.03;
      const masks: [string, number][] = [
        ['#ff0000', 1 + spread],
        ['#00ff00', 1],
        ['#0000ff', 1 - spread],
      ];
      for (const [mask, zoom] of masks) {
        channel.ctx.setTransform(1, 0, 0, 1, 0, 0);
        channel.ctx.globalAlpha = 1;
        channel.ctx.globalCompositeOperation = 'copy';
        channel.ctx.drawImage(bloom.buffer.canvas as CanvasImageSource, 0, 0);
        // Multiplying by a pure primary keeps that channel and zeroes the
        // other two — but it also leaves every pixel opaque, so the alpha
        // has to be put back from the bloom, or the glow arrives as a solid
        // rectangle. (It did.)
        channel.ctx.globalCompositeOperation = 'multiply';
        channel.ctx.fillStyle = mask;
        channel.ctx.fillRect(0, 0, bloom.w, bloom.h);
        channel.ctx.globalCompositeOperation = 'destination-in';
        channel.ctx.drawImage(bloom.buffer.canvas as CanvasImageSource, 0, 0);
        channel.ctx.globalCompositeOperation = 'source-over';

        const dw = bloom.w * zoom;
        const dh = bloom.h * zoom;
        aberrated.ctx.globalCompositeOperation = 'lighter';
        aberrated.ctx.drawImage(
          channel.canvas as CanvasImageSource,
          0, 0, bloom.w, bloom.h,
          (bloom.w - dw) / 2, (bloom.h - dh) / 2, dw, dh,
        );
      }
      // Three additive passes triple the coverage; the bloom's own alpha is
      // the truth, so it is stamped back over the result.
      aberrated.ctx.globalCompositeOperation = 'destination-in';
      aberrated.ctx.drawImage(bloom.buffer.canvas as CanvasImageSource, 0, 0);
      aberrated.ctx.globalCompositeOperation = 'source-over';
      glow = aberrated;
    }

    // Exposure is in stops, as it is in the plugin. The levels factor is the
    // part that has to be there: spreading a highlight over a hundred times
    // its own area divides its brightness by a hundred, and in 8 bits that
    // is a halo of two or three values — invisible. A real bloom carries
    // that energy in float and exposes it back afterwards; this puts the
    // same energy back by drawing the glow that many times over.
    const gain = Math.min(24, 2 ** exposure * levels * 0.5);
    const drawBloom = () => {
      if (gain <= 0) return;
      dest.ctx.globalCompositeOperation = 'lighter';
      for (let pass = 0; pass < Math.ceil(gain); pass += 1) {
        dest.ctx.globalAlpha = Math.min(1, gain - pass);
        dest.ctx.drawImage(
          glow.canvas as CanvasImageSource,
          0, 0, bloom.w, bloom.h,
          0, 0, width, height,
        );
      }
      dest.ctx.globalAlpha = 1;
      dest.ctx.globalCompositeOperation = 'source-over';
    };

    if (composite === 1) drawBloom();
    if (composite !== 2) dest.ctx.drawImage(source.canvas as CanvasImageSource, 0, 0);
    if (composite !== 1) drawBloom();
  },
});

registerEffect({
  matchName: 'ADBE Roughen Edges',
  name: 'Roughen Edges',
  category: 'Stylize',
  params: [
    {
      key: 'edgeType', name: 'Edge Type', kind: 'select', default: 0,
      options: ['Roughen', 'Roughen Color', 'Cut', 'Spiky', 'Photocopy'],
    },
    { key: 'edgeColour', name: 'Edge Color', kind: 'color', default: [1, 1, 1, 1] },
    { key: 'border', name: 'Border', kind: 'number', default: 20, min: 0 },
    { key: 'edgeSharpness', name: 'Edge Sharpness', kind: 'number', default: 1, min: 0.1, max: 8, speedPerPixel: 0.02 },
    { key: 'influence', name: 'Fractal Influence', kind: 'percent', default: 100, min: 0, max: 200, unit: '%' },
    { key: 'scaleAmount', name: 'Scale', kind: 'percent', default: 100, min: 1, max: 1000, unit: '%' },
    { key: 'stretch', name: 'Stretch Width or Height', kind: 'percent', default: 100, min: 10, max: 1000, unit: '%' },
    { key: 'offset', name: 'Offset (Turbulence)', kind: 'vec2', default: [0, 0], dimensionNames: ['X', 'Y'] },
    { key: 'complexity', name: 'Complexity', kind: 'number', default: 2, min: 1, max: 6 },
    { key: 'evolution', name: 'Evolution', kind: 'angle', default: 0, unit: '°' },
    { key: 'seed', name: 'Random Seed', kind: 'number', default: 0, min: 0, max: 9999 },
  ],
  apply: ({ source, dest, width, height, scale, pool, get }) => {
    const edgeType = Math.round(get<number>('edgeType'));
    const [er, eg, eb] = rgbaTo255(get<RGBA>('edgeColour'));
    const border = get<number>('border') * scale;
    const sharpness = Math.max(0.1, get<number>('edgeSharpness'));
    const influence = get<number>('influence') / 100;
    const noiseScale = Math.max(1, get<number>('scaleAmount')) * scale * 0.25;
    const stretch = Math.max(0.1, get<number>('stretch') / 100);
    const offset = get<Vec2>('offset');
    const octaves = Math.max(1, Math.min(6, Math.round(get<number>('complexity'))));
    const evolution = get<number>('evolution') / 360 + get<number>('seed') * 13.7;

    if (border <= 0 || influence <= 0) {
      copyBuffer(source, dest, width, height);
      return;
    }

    /**
     * How far inside the shape each pixel is.
     *
     * This is the whole effect. Roughening the alpha everywhere — which is
     * the obvious reading of "roughen" — eats holes out of the middle of the
     * layer; the original only disturbs a band of `Border` pixels along the
     * edge and leaves the interior alone. Blurring the alpha by the border
     * width gives that depth cheaply: it stays at full strength well inside
     * the shape and falls away towards the edge.
     */
    const depth = pool.sized('fxRoughDepth', width, height);
    blurBuffer(source, depth, width, height, border, border, pool);
    const depthData = depth.ctx.getImageData(0, 0, width, height).data;

    mapPixels(source, dest, width, height, (r, g, b, a, x, y, out) => {
      if (a === 0) return;
      // A blurred hard edge sits at half strength on the boundary itself, so
      // this maps the band to 0 at the outline and 1 a border's depth in.
      const inside = depthData[(y * width + x) * 4 + 3] / 255;
      const depthIn = clamp01((inside - 0.5) * 2);
      if (depthIn >= 0.999) return;

      const n = fbm(
        (x + offset[0] * scale) / noiseScale,
        (y + offset[1] * scale) / (noiseScale * stretch),
        evolution,
        octaves,
        { fractal: edgeType === 3 ? 'ridged' : 'smooth' },
      );

      // The noise decides how deep the bite goes at this point along the
      // edge; a pixel survives if it lies deeper than the bite. That is what
      // makes the outline ragged rather than merely faded.
      const cut = clamp01(n * influence);
      let keep: number;
      if (edgeType === 2) keep = depthIn > cut ? 1 : 0;
      else keep = clamp01((depthIn - cut) * 4 * sharpness + 0.5);

      out[3] = a * keep;
      if (edgeType === 1 || edgeType === 4) {
        // Roughen Color and Photocopy paint the disturbed band rather than
        // only removing it, so the edge reads as ink rather than erosion.
        const paint = clamp01((1 - depthIn) * (edgeType === 4 ? 1.6 : 1) * influence);
        out[0] = r + (er - r) * paint;
        out[1] = g + (eg - g) * paint;
        out[2] = b + (eb - b) * paint;
        if (edgeType === 4) out[3] = Math.max(a * keep, a * paint);
      }
    });
  },
});

registerEffect({
  matchName: 'ADBE Scatter',
  name: 'Scatter',
  category: 'Stylize',
  params: [
    { key: 'amount', name: 'Scatter Amount', kind: 'number', default: 20, min: 0 },
    { key: 'grain', name: 'Grain', kind: 'select', default: 0, options: ['Both', 'Horizontal', 'Vertical'] },
    { key: 'randomness', name: 'Randomize Every Frame', kind: 'checkbox', default: 0 },
  ],
  apply: ({ source, dest, width, height, scale, time, get }) => {
    const amount = get<number>('amount') * scale;
    const grain = Math.round(get<number>('grain'));
    const seed = get<number>('randomness') >= 0.5 ? Math.round(time * 1000) : 1;

    remapPixels(source, dest, width, height, (x, y, out) => {
      const jitterX = (hashNoise(x, y, seed) - 0.5) * 2 * amount;
      const jitterY = (hashNoise(x + 57.3, y + 11.7, seed) - 0.5) * 2 * amount;
      out[0] = x + (grain === 2 ? 0 : jitterX);
      out[1] = y + (grain === 1 ? 0 : jitterY);
    // Scatter displaces whole pixels; interpolating would smear the grain
    // into a blur, which is not what the effect is for.
    }, { sampling: 'nearest', edges: 'clamp' });
  },
});

registerEffect({
  matchName: 'ADBE Cartoon',
  name: 'Cartoon',
  category: 'Stylize',
  params: [
    {
      key: 'render', name: 'Render', kind: 'select', default: 2,
      options: ['Fill', 'Edges', 'Fill & Edges'],
    },
    { key: 'shadingSteps', name: 'Shading Steps', kind: 'number', default: 6, min: 2, max: 32 },
    { key: 'edgeThreshold', name: 'Edge Threshold', kind: 'number', default: 30, min: 0, max: 255 },
    { key: 'edgeWidth', name: 'Edge Width', kind: 'number', default: 1, min: 0, max: 8, speedPerPixel: 0.05 },
    { key: 'edgeSoftness', name: 'Edge Softness', kind: 'percent', default: 30, min: 0, max: 100, unit: '%' },
    { key: 'edgeColour', name: 'Edge Color', kind: 'color', default: [0, 0, 0, 1] },
    { key: 'smoothness', name: 'Smoothness', kind: 'number', default: 3, min: 0, max: 12 },
  ],
  apply: ({ source, dest, width, height, pool, get }) => {
    const render = Math.round(get<number>('render'));
    const steps = Math.max(2, Math.round(get<number>('shadingSteps')));
    const threshold = get<number>('edgeThreshold');
    const edgeWidth = get<number>('edgeWidth');
    const softness = clamp01(get<number>('edgeSoftness') / 100);
    const [cr, cg, cb] = rgbaTo255(get<RGBA>('edgeColour'));
    const smoothness = get<number>('smoothness');

    // Flatten the shading first, then draw the outlines back over it.
    const smoothed = pool.sized('fxCartoonSmooth', width, height);
    if (smoothness > 0) blurBuffer(source, smoothed, width, height, smoothness, smoothness, pool);
    else copyBuffer(source, smoothed, width, height);

    const data = smoothed.ctx.getImageData(0, 0, width, height).data;
    const step = 255 / (steps - 1);

    mapPixels(smoothed, dest, width, height, (r, g, b, a, x, y, out) => {
      const at = (dx: number, dy: number) => {
        const px = Math.min(width - 1, Math.max(0, x + dx));
        const py = Math.min(height - 1, Math.max(0, y + dy));
        const i = (py * width + px) * 4;
        return luminance(data[i], data[i + 1], data[i + 2]);
      };
      const gx = at(-1, -1) + 2 * at(-1, 0) + at(-1, 1) - at(1, -1) - 2 * at(1, 0) - at(1, 1);
      const gy = at(-1, -1) + 2 * at(0, -1) + at(1, -1) - at(-1, 1) - 2 * at(0, 1) - at(1, 1);
      // Softness widens the band over which an edge fades in, so the outline
      // reads as a drawn line rather than an aliased one.
      const span = 4 + softness * 120;
      const edge = clamp01((Math.hypot(gx, gy) - threshold) / span) * clamp01(edgeWidth);

      // Fill posterizes the shading; Edges keeps only the outline.
      const fill = render === 1 ? 255 : 0;
      const shaded = [
        render === 1 ? fill : Math.round(r / step) * step,
        render === 1 ? fill : Math.round(g / step) * step,
        render === 1 ? fill : Math.round(b / step) * step,
      ];
      const drawEdges = render !== 0;
      out[0] = drawEdges ? shaded[0] + (cr - shaded[0]) * edge : shaded[0];
      out[1] = drawEdges ? shaded[1] + (cg - shaded[1]) * edge : shaded[1];
      out[2] = drawEdges ? shaded[2] + (cb - shaded[2]) * edge : shaded[2];
      out[3] = render === 1 ? Math.max(a * edge, 0) : a;
    });
  },
});

registerEffect({
  matchName: 'CC Kaleida',
  name: 'CC Kaleida',
  category: 'Stylize',
  params: [
    { key: 'centre', name: 'Center', kind: 'vec2', default: [0, 0], dimensionNames: ['X', 'Y'] },
    { key: 'size', name: 'Size', kind: 'percent', default: 50, min: 1, max: 200, unit: '%' },
    {
      key: 'mirroring', name: 'Mirroring', kind: 'select', default: 2,
      options: ['Kaleidoscope', '1 Mirror', '2 Mirror', '4 Mirror', '6 Mirror', '12 Mirror', 'Rectangle'],
    },
    { key: 'rotation', name: 'Rotation', kind: 'angle', default: 0, unit: '°' },
    { key: 'floatingCentre', name: 'Floating Center', kind: 'checkbox', default: 1 },
  ],
  apply: ({ source, dest, width, height, scale, get }) => {
    const centre = get<Vec2>('centre');
    const cx = width / 2 + centre[0] * scale;
    const cy = height / 2 + centre[1] * scale;
    const size = Math.max(0.01, get<number>('size') / 100);
    const mode = Math.round(get<number>('mirroring'));
    const rotation = (get<number>('rotation') * Math.PI) / 180;
    const floating = get<number>('floatingCentre') >= 0.5;
    // Where the wedge reads its pixels from: under the centre it moves with
    // it, otherwise the pattern is always sampled from the middle of the frame.
    const sampleX = floating ? cx : width / 2;
    const sampleY = floating ? cy : height / 2;

    // The named modes are wedge counts; Kaleidoscope is the six-fold fold
    // everyone pictures, and Rectangle folds in x and y instead of in angle.
    const segments = [6, 1, 2, 4, 6, 12, 0][Math.max(0, Math.min(6, mode))];

    if (segments === 0) {
      remapPixels(source, dest, width, height, (x, y, out) => {
        const dx = (x - cx) * size;
        const dy = (y - cy) * size;
        out[0] = sampleX + Math.abs(dx) - Math.abs(dx) % 1;
        out[1] = sampleY + Math.abs(dy) - Math.abs(dy) % 1;
      }, { edges: 'reflect' });
      return;
    }

    const wedge = (Math.PI * 2) / segments;
    remapPixels(source, dest, width, height, (x, y, out) => {
      const dx = x - cx;
      const dy = y - cy;
      let angle = Math.atan2(dy, dx) - rotation;
      const radius = Math.hypot(dx, dy) * size;
      // Fold the angle into one wedge and mirror every second one, so the
      // seams meet instead of repeating the same slice round the circle.
      angle = ((angle % wedge) + wedge) % wedge;
      if (angle > wedge / 2) angle = wedge - angle;
      out[0] = sampleX + Math.cos(angle + rotation) * radius;
      out[1] = sampleY + Math.sin(angle + rotation) * radius;
    }, { edges: 'reflect' });
  },
});
