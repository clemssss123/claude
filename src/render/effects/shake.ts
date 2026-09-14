import { clamp01, hashNoise, mapPixels, valueNoise } from './pixels';
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

registerEffect({
  matchName: 'PLUGIN Shake',
  name: 'Shake',
  category: 'Distort',
  params: [
    { key: 'magnitude', name: 'Magnitude', kind: 'percent', default: 100, min: 0, max: 400, unit: '%' },
    { key: 'frequency', name: 'Frequency', kind: 'number', default: 4, min: 0, max: 60, speedPerPixel: 0.05 },
    { key: 'octaves', name: 'Octaves', kind: 'number', default: 2, min: 1, max: 6 },
    { key: 'smoothness', name: 'Smoothness', kind: 'percent', default: 50, min: 0, max: 100, unit: '%' },
    { key: 'positionAmount', name: 'Position', kind: 'vec2', default: [30, 30], dimensionNames: ['X', 'Y'] },
    { key: 'rotationAmount', name: 'Rotation', kind: 'angle', default: 2, unit: '°' },
    { key: 'scaleAmount', name: 'Scale', kind: 'percent', default: 0, min: 0, max: 100, unit: '%' },
    { key: 'lockX', name: 'Lock Horizontal', kind: 'checkbox', default: 0 },
    { key: 'lockY', name: 'Lock Vertical', kind: 'checkbox', default: 0 },
    { key: 'seed', name: 'Random Seed', kind: 'number', default: 0, min: 0, max: 9999 },
  ],
  margin: (get) => {
    const position = get<Vec2>('positionAmount');
    return Math.max(position[0], position[1]) * (get<number>('magnitude') / 100) + 8;
  },
  apply: ({ source, dest, width, height, scale, time, get }) => {
    const magnitude = get<number>('magnitude') / 100;
    const frequency = get<number>('frequency');
    const octaves = Math.max(1, Math.min(6, Math.round(get<number>('octaves'))));
    // Smoothness rolls off the fine octaves, which is the difference between
    // a hand-held drift and a rattle.
    const smoothness = clamp01(get<number>('smoothness') / 100);
    const position = get<Vec2>('positionAmount');
    const rotation = get<number>('rotationAmount');
    const scaleAmount = get<number>('scaleAmount') / 100;
    const lockX = get<number>('lockX') >= 0.5;
    const lockY = get<number>('lockY') >= 0.5;
    const seed = get<number>('seed');

    const shake = (channel: number): number => {
      let sum = 0;
      let amplitude = 1;
      let step = frequency;
      let total = 0;
      for (let o = 0; o < octaves; o += 1) {
        const weight = amplitude * (o === 0 ? 1 : 1 - smoothness);
        sum += (valueNoise(time * step, channel * 17.3 + o * 5.7, seed) * 2 - 1) * weight;
        total += weight;
        amplitude *= 0.5;
        step *= 2;
      }
      return total === 0 ? 0 : sum / total;
    };

    const dx = lockX ? 0 : shake(0) * position[0] * magnitude * scale;
    const dy = lockY ? 0 : shake(1) * position[1] * magnitude * scale;
    const angle = (shake(2) * rotation * magnitude * Math.PI) / 180;
    const zoom = 1 + shake(3) * scaleAmount * magnitude;

    dest.ctx.setTransform(1, 0, 0, 1, 0, 0);
    dest.ctx.globalCompositeOperation = 'copy';
    dest.ctx.globalAlpha = 1;
    dest.ctx.clearRect(0, 0, width, height);
    dest.ctx.globalCompositeOperation = 'source-over';

    dest.ctx.save();
    dest.ctx.translate(width / 2 + dx, height / 2 + dy);
    dest.ctx.rotate(angle);
    dest.ctx.scale(zoom, zoom);
    dest.ctx.translate(-width / 2, -height / 2);
    dest.ctx.drawImage(source.canvas as CanvasImageSource, 0, 0);
    dest.ctx.restore();
  },
});

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
