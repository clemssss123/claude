import { clamp01, hashNoise, mapPixels, smoothNoise1D } from './pixels';
import { registerEffect } from './registry';
import type { Vec2 } from '@/core/types';

/**
 * Shake and Twitch.
 *
 * Both drive the layer from noise rather than from keyframes: Shake moves the
 * whole frame the way a handheld camera does, and Twitch chops the timeline
 * into blocks and glitches each one differently. They are the two effects you
 * reach for when you want motion you did not have to animate.
 */

/** One frame's worth of shake: where the frame sits and how it is turned. */
interface ShakeTransform {
  dx: number;
  dy: number;
  angle: number;
  zoom: number;
}

registerEffect({
  matchName: 'PLUGIN Shake',
  name: 'Shake',
  category: 'Distort',
  params: [
    { key: 'amplitude', name: 'Amplitude', kind: 'percent', default: 100, min: 0, max: 400, unit: '%' },
    { key: 'positionAmount', name: 'Position', kind: 'vec2', default: [30, 30], dimensionNames: ['X', 'Y'] },
    { key: 'rotationAmount', name: 'Rotation', kind: 'angle', default: 1.5, unit: '°' },
    { key: 'zoomAmount', name: 'Zoom', kind: 'percent', default: 2, min: 0, max: 100, unit: '%' },
    { key: 'frequency', name: 'Frequency', kind: 'number', default: 6, min: 0, max: 60, unit: ' Hz', speedPerPixel: 0.05 },
    { key: 'octaves', name: 'Octaves', kind: 'number', default: 3, min: 1, max: 6 },
    { key: 'roughness', name: 'Roughness', kind: 'percent', default: 50, min: 0, max: 100, unit: '%' },
    { key: 'wander', name: 'Wander', kind: 'percent', default: 25, min: 0, max: 200, unit: '%' },
    { key: 'wanderFrequency', name: 'Wander Frequency', kind: 'number', default: 0.4, min: 0.01, max: 10, unit: ' Hz', speedPerPixel: 0.01 },
    { key: 'motionBlur', name: 'Motion Blur', kind: 'percent', default: 0, min: 0, max: 100, unit: '%' },
    { key: 'shutterAngle', name: 'Shutter Angle', kind: 'angle', default: 180, min: 0, max: 720, unit: '°' },
    { key: 'blurSamples', name: 'Blur Samples', kind: 'number', default: 8, min: 2, max: 32 },
    {
      key: 'edges', name: 'Edges', kind: 'select', default: 0,
      options: ['Zoom to Fill', 'Reflect', 'Repeat', 'Transparent'],
    },
    { key: 'lockX', name: 'Lock Horizontal', kind: 'checkbox', default: 0 },
    { key: 'lockY', name: 'Lock Vertical', kind: 'checkbox', default: 0 },
    { key: 'timeOffset', name: 'Time Offset', kind: 'number', default: 0, min: -600, max: 600, unit: ' s', speedPerPixel: 0.01 },
    { key: 'seed', name: 'Random Seed', kind: 'number', default: 0, min: 0, max: 9999 },
  ],
  margin: (get) => {
    const position = get<Vec2>('positionAmount');
    const amplitude = get<number>('amplitude') / 100;
    const wander = 1 + get<number>('wander') / 100;
    return Math.max(position[0], position[1]) * amplitude * wander + 8;
  },
  apply: ({ source, dest, width, height, scale, time, frameRate, get }) => {
    const amplitude = get<number>('amplitude') / 100;
    const position = get<Vec2>('positionAmount');
    const rotationAmount = get<number>('rotationAmount');
    const zoomAmount = get<number>('zoomAmount') / 100;
    const frequency = get<number>('frequency');
    const octaves = Math.max(1, Math.min(6, Math.round(get<number>('octaves'))));
    // Roughness is how loud each finer octave is against the one below it.
    // At 0 the motion is a single smooth drift; at 100 it rattles.
    const roughness = clamp01(get<number>('roughness') / 100);
    const wander = get<number>('wander') / 100;
    const wanderFrequency = Math.max(0.01, get<number>('wanderFrequency'));
    const motionBlur = clamp01(get<number>('motionBlur') / 100);
    const shutter = Math.max(0, get<number>('shutterAngle')) / 360;
    const samples = Math.max(2, Math.min(32, Math.round(get<number>('blurSamples'))));
    const edges = Math.round(get<number>('edges'));
    const lockX = get<number>('lockX') >= 0.5;
    const lockY = get<number>('lockY') >= 0.5;
    const timeOffset = get<number>('timeOffset');
    const seed = get<number>('seed');

    /**
     * The shake channel at a moment: octaves of smooth noise, plus a slower
     * wander underneath. Sapphire's shake is two motions in one — a jitter
     * you read as the camera operator's hand, and a drift you read as them
     * losing the frame — and the drift is most of what sells it.
     */
    const channel = (index: number, at: number): number => {
      let sum = 0;
      let weight = 1;
      let step = frequency;
      let total = 0;
      for (let o = 0; o < octaves; o += 1) {
        sum += smoothNoise1D(at * step, index * 17.3 + o * 5.7, seed) * weight;
        total += weight;
        weight *= roughness;
        step *= 2;
      }
      const jitter = total === 0 ? 0 : sum / total;
      const drift = wander > 0
        ? smoothNoise1D(at * wanderFrequency, index * 17.3 + 101.5, seed + 7) * wander
        : 0;
      return jitter + drift;
    };

    const transformAt = (at: number): ShakeTransform => ({
      dx: lockX ? 0 : channel(0, at) * position[0] * amplitude * scale,
      dy: lockY ? 0 : channel(1, at) * position[1] * amplitude * scale,
      angle: (channel(2, at) * rotationAmount * amplitude * Math.PI) / 180,
      zoom: 1 + channel(3, at) * zoomAmount * amplitude,
    });

    // Zoom to Fill scales up by just enough that the shifted frame never
    // shows past its own edge — the usual way a shake is hidden, and the
    // reason Sapphire's default never reveals the plate underneath.
    //
    // The three motions each eat into the frame: a shift of d needs 2d more
    // width, a turn of θ needs the rotated rectangle to still cover, and the
    // zoom has to survive its own lowest point.
    let fill = 1;
    if (edges === 0) {
      const spread = amplitude * (1 + wander);
      const reachX = Math.abs(position[0]) * spread * scale;
      const reachY = Math.abs(position[1]) * spread * scale;
      const spin = Math.abs((rotationAmount * Math.PI) / 180) * spread;
      const cos = Math.cos(spin);
      const sin = Math.sin(spin);
      const forShift = Math.max(
        1 + (2 * reachX) / Math.max(1, width),
        1 + (2 * reachY) / Math.max(1, height),
      );
      const forSpin = Math.max(
        (width * cos + height * sin) / Math.max(1, width),
        (width * sin + height * cos) / Math.max(1, height),
      );
      const shrink = Math.max(0, 1 - zoomAmount * amplitude);
      fill = (forShift * forSpin) / Math.max(0.1, shrink);
    }

    dest.ctx.setTransform(1, 0, 0, 1, 0, 0);
    dest.ctx.globalCompositeOperation = 'copy';
    dest.ctx.globalAlpha = 1;
    dest.ctx.clearRect(0, 0, width, height);
    dest.ctx.globalCompositeOperation = 'source-over';

    const blurred = motionBlur > 0 && shutter > 0;
    const count = blurred ? samples : 1;
    // A shutter is open for a fraction of a frame, so the blur covers exactly
    // that slice of the shake's path — the same shutter-angle model the
    // composition's own motion blur uses.
    const open = blurred ? (shutter * motionBlur) / Math.max(1, frameRate) : 0;

    for (let i = 0; i < count; i += 1) {
      const offset = count === 1 ? 0 : (i / (count - 1) - 0.5) * open;
      const shake = transformAt(time + timeOffset + offset);
      // A running average: N copies at a flat 1/N never reach full alpha.
      dest.ctx.globalAlpha = 1 / (i + 1);
      drawShaken(dest, source, width, height, shake, fill, edges);
    }
    dest.ctx.globalAlpha = 1;
  },
});

/** Draw the source under one shake transform, honouring the edge mode. */
function drawShaken(
  dest: { ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D },
  source: { canvas: HTMLCanvasElement | OffscreenCanvas },
  width: number,
  height: number,
  shake: ShakeTransform,
  fill: number,
  edges: number,
): void {
  const ctx = dest.ctx;
  ctx.save();
  ctx.translate(width / 2 + shake.dx, height / 2 + shake.dy);
  ctx.rotate(shake.angle);
  ctx.scale(shake.zoom * fill, shake.zoom * fill);
  ctx.translate(-width / 2, -height / 2);

  const image = source.canvas as CanvasImageSource;
  if (edges === 1) {
    // Reflect: the frame is mirrored across each edge, so the gap the shake
    // opens is filled with the image folded back on itself.
    for (const [sx, ox] of [[1, 0], [-1, -2 * width], [-1, 2 * width]] as const) {
      for (const [sy, oy] of [[1, 0], [-1, -2 * height], [-1, 2 * height]] as const) {
        ctx.save();
        ctx.translate(sx === -1 ? width - ox : 0, sy === -1 ? height - oy : 0);
        ctx.scale(sx, sy);
        ctx.drawImage(image, 0, 0);
        ctx.restore();
      }
    }
  } else if (edges === 2) {
    for (const ox of [-width, 0, width]) {
      for (const oy of [-height, 0, height]) {
        ctx.drawImage(image, ox, oy);
      }
    }
  } else {
    ctx.drawImage(image, 0, 0);
  }
  ctx.restore();
}

registerEffect({
  matchName: 'PLUGIN Twitch',
  name: 'Twitch',
  category: 'Stylize',
  params: [
    { key: 'amount', name: 'Amount', kind: 'percent', default: 100, min: 0, max: 400, unit: '%' },
    { key: 'speed', name: 'Speed', kind: 'number', default: 8, min: 0.1, max: 60, speedPerPixel: 0.05 },
    { key: 'probability', name: 'Probability', kind: 'percent', default: 60, min: 0, max: 100, unit: '%' },
    { key: 'blockSlide', name: 'Block Slide', kind: 'percent', default: 60, min: 0, max: 100, unit: '%' },
    { key: 'blockHeight', name: 'Block Height', kind: 'number', default: 40, min: 1 },
    { key: 'slide', name: 'Slide', kind: 'percent', default: 40, min: 0, max: 100, unit: '%' },
    { key: 'scaleAmount', name: 'Scale', kind: 'percent', default: 20, min: 0, max: 100, unit: '%' },
    { key: 'colourSplit', name: 'Color Split', kind: 'percent', default: 60, min: 0, max: 100, unit: '%' },
    { key: 'blurAmount', name: 'Blur', kind: 'percent', default: 30, min: 0, max: 100, unit: '%' },
    { key: 'seed', name: 'Random Seed', kind: 'number', default: 0, min: 0, max: 9999 },
  ],
  apply: ({ source, dest, width, height, scale, time, pool, get }) => {
    const amount = get<number>('amount') / 100;
    const speed = Math.max(0.1, get<number>('speed'));
    const probability = get<number>('probability') / 100;
    const blockSlide = get<number>('blockSlide') / 100;
    const blockHeight = Math.max(1, get<number>('blockHeight') * scale);
    const slide = get<number>('slide') / 100;
    const scaleAmount = get<number>('scaleAmount') / 100;
    const colourSplit = get<number>('colourSplit') / 100;
    const blurAmount = get<number>('blurAmount') / 100;
    const seed = get<number>('seed');

    // Time is chopped into blocks; every block draws the same random numbers,
    // so a glitch holds for a beat instead of flickering every frame.
    const block = Math.floor(time * speed);
    const fire = hashNoise(block, seed, 3.1);
    if (amount <= 0 || fire > probability) {
      dest.ctx.setTransform(1, 0, 0, 1, 0, 0);
      dest.ctx.globalCompositeOperation = 'copy';
      dest.ctx.globalAlpha = 1;
      dest.ctx.drawImage(source.canvas as CanvasImageSource, 0, 0);
      dest.ctx.globalCompositeOperation = 'source-over';
      return;
    }

    const random = (channel: number) => hashNoise(block, seed + channel * 31.7, channel) * 2 - 1;

    // 1. Torn horizontal bands, each shifted by its own amount.
    const torn = pool.sized('fxTwitchTorn', width, height);
    if (blockSlide > 0) {
      const data = source.ctx.getImageData(0, 0, width, height);
      const src = data.data;
      const out = torn.ctx.createImageData(width, height);
      const dst = out.data;
      for (let y = 0; y < height; y += 1) {
        const band = Math.floor(y / blockHeight);
        const shift = Math.round(
          (hashNoise(band, block + seed, 7.7) * 2 - 1) * blockSlide * amount * width * 0.15,
        );
        for (let x = 0; x < width; x += 1) {
          const sx = ((x - shift) % width + width) % width;
          const from = (y * width + sx) * 4;
          const to = (y * width + x) * 4;
          dst[to] = src[from];
          dst[to + 1] = src[from + 1];
          dst[to + 2] = src[from + 2];
          dst[to + 3] = src[from + 3];
        }
      }
      torn.ctx.putImageData(out, 0, 0);
    } else {
      torn.ctx.setTransform(1, 0, 0, 1, 0, 0);
      torn.ctx.globalCompositeOperation = 'copy';
      torn.ctx.drawImage(source.canvas as CanvasImageSource, 0, 0);
      torn.ctx.globalCompositeOperation = 'source-over';
    }

    // 2. A whole-frame jolt: slide and scale.
    const dx = random(1) * slide * amount * width * 0.08;
    const dy = random(2) * slide * amount * height * 0.08;
    const zoom = 1 + Math.abs(random(3)) * scaleAmount * amount * 0.4;

    dest.ctx.setTransform(1, 0, 0, 1, 0, 0);
    dest.ctx.globalCompositeOperation = 'copy';
    dest.ctx.globalAlpha = 1;
    dest.ctx.clearRect(0, 0, width, height);
    dest.ctx.globalCompositeOperation = 'source-over';
    dest.ctx.save();
    dest.ctx.translate(width / 2 + dx, height / 2 + dy);
    dest.ctx.scale(zoom, zoom);
    dest.ctx.translate(-width / 2, -height / 2);
    if (blurAmount > 0) {
      dest.ctx.filter = `blur(${blurAmount * amount * 6 * scale}px)`;
    }
    dest.ctx.drawImage(torn.canvas as CanvasImageSource, 0, 0);
    dest.ctx.filter = 'none';
    dest.ctx.restore();

    // 3. Colour split: pull the red and blue channels apart.
    if (colourSplit > 0) {
      const split = random(4) * colourSplit * amount * 24 * scale;
      const shifted = pool.sized('fxTwitchSplit', width, height);
      shifted.ctx.setTransform(1, 0, 0, 1, 0, 0);
      shifted.ctx.globalCompositeOperation = 'copy';
      shifted.ctx.drawImage(dest.canvas as CanvasImageSource, 0, 0);
      shifted.ctx.globalCompositeOperation = 'source-over';
      const base = shifted.ctx.getImageData(0, 0, width, height).data;

      mapPixels(dest, dest, width, height, (_r, g, _b, a, x, y, out) => {
        const at = (offset: number, channel: number) => {
          const sx = Math.min(width - 1, Math.max(0, Math.round(x + offset)));
          return base[(y * width + sx) * 4 + channel];
        };
        out[0] = at(split, 0);
        out[1] = g;
        out[2] = at(-split, 2);
        out[3] = a;
      });
    }
  },
});
