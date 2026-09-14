import { clamp01, mapPixels } from './pixels';
import { registerEffect } from './registry';
import type { Vec2 } from '@/core/types';

/** Transition. Each of these wipes the layer away by its own geometry. */

registerEffect({
  matchName: 'ADBE Linear Wipe',
  name: 'Linear Wipe',
  category: 'Transition',
  params: [
    { key: 'completion', name: 'Transition Completion', kind: 'percent', default: 0, min: 0, max: 100, unit: '%' },
    { key: 'angle', name: 'Wipe Angle', kind: 'angle', default: 90, unit: '°' },
    { key: 'feather', name: 'Feather', kind: 'number', default: 0, min: 0 },
  ],
  apply: ({ source, dest, width, height, scale, get }) => {
    const completion = get<number>('completion') / 100;
    const angle = ((get<number>('angle') - 90) * Math.PI) / 180;
    const feather = Math.max(0.001, get<number>('feather') * scale);

    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    // Project every corner to find how far the wipe has to travel.
    const extent = Math.abs(width * dx) + Math.abs(height * dy);
    const start = -extent / 2;

    mapPixels(source, dest, width, height, (_r, _g, _b, a, x, y, out) => {
      const projected = (x - width / 2) * dx + (y - height / 2) * dy;
      const edge = start + extent * completion;
      out[3] = a * clamp01((projected - edge) / feather);
    });
  },
});

registerEffect({
  matchName: 'ADBE Radial Wipe',
  name: 'Radial Wipe',
  category: 'Transition',
  params: [
    { key: 'completion', name: 'Transition Completion', kind: 'percent', default: 0, min: 0, max: 100, unit: '%' },
    { key: 'startAngle', name: 'Start Angle', kind: 'angle', default: 0, unit: '°' },
    { key: 'centre', name: 'Wipe Center', kind: 'vec2', default: [0, 0], dimensionNames: ['X', 'Y'] },
    { key: 'wipe', name: 'Wipe', kind: 'select', default: 0, options: ['Clockwise', 'Counterclockwise', 'Both'] },
    { key: 'feather', name: 'Feather', kind: 'number', default: 0, min: 0 },
  ],
  apply: ({ source, dest, width, height, scale, get }) => {
    const completion = get<number>('completion') / 100;
    const startAngle = (get<number>('startAngle') * Math.PI) / 180;
    const centre = get<Vec2>('centre');
    const mode = Math.round(get<number>('wipe'));
    const feather = Math.max(0.0001, (get<number>('feather') * scale) / 200);
    const cx = width / 2 + centre[0] * scale;
    const cy = height / 2 + centre[1] * scale;

    mapPixels(source, dest, width, height, (_r, _g, _b, a, x, y, out) => {
      let angle = Math.atan2(y - cy, x - cx) + Math.PI / 2 - startAngle;
      angle = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      let swept = angle / (Math.PI * 2);
      if (mode === 1) swept = 1 - swept;
      else if (mode === 2) swept = Math.abs(swept - 0.5) * 2;
      out[3] = a * clamp01((swept - completion) / feather);
    });
  },
});

registerEffect({
  matchName: 'ADBE Venetian Blinds',
  name: 'Venetian Blinds',
  category: 'Transition',
  params: [
    { key: 'completion', name: 'Transition Completion', kind: 'percent', default: 0, min: 0, max: 100, unit: '%' },
    { key: 'direction', name: 'Direction', kind: 'angle', default: 0, unit: '°' },
    { key: 'width', name: 'Width', kind: 'number', default: 40, min: 1 },
    { key: 'feather', name: 'Feather', kind: 'number', default: 0, min: 0 },
  ],
  apply: ({ source, dest, width, height, scale, get }) => {
    const completion = get<number>('completion') / 100;
    const angle = (get<number>('direction') * Math.PI) / 180;
    const slat = Math.max(1, get<number>('width') * scale);
    const feather = Math.max(0.001, get<number>('feather') * scale);
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    mapPixels(source, dest, width, height, (_r, _g, _b, a, x, y, out) => {
      const projected = (x - width / 2) * dx + (y - height / 2) * dy;
      // Position within one slat decides whether this pixel has closed yet.
      const withinSlat = ((projected % slat) + slat) % slat;
      out[3] = a * clamp01((withinSlat - completion * slat) / feather);
    });
  },
});

registerEffect({
  matchName: 'ADBE Block Dissolve',
  name: 'Block Dissolve',
  category: 'Transition',
  params: [
    { key: 'completion', name: 'Transition Completion', kind: 'percent', default: 0, min: 0, max: 100, unit: '%' },
    { key: 'blockWidth', name: 'Block Width', kind: 'number', default: 40, min: 1 },
    { key: 'blockHeight', name: 'Block Height', kind: 'number', default: 40, min: 1 },
    { key: 'feather', name: 'Feather', kind: 'percent', default: 0, min: 0, max: 100, unit: '%' },
    { key: 'softEdges', name: 'Soft Edges', kind: 'checkbox', default: 1 },
  ],
  apply: ({ source, dest, width, height, scale, get }) => {
    const completion = get<number>('completion') / 100;
    const bw = Math.max(1, get<number>('blockWidth') * scale);
    const bh = Math.max(1, get<number>('blockHeight') * scale);
    const feather = Math.max(0.0001, get<number>('feather') / 100);
    const soft = get<number>('softEdges') >= 0.5;

    mapPixels(source, dest, width, height, (_r, _g, _b, a, x, y, out) => {
      const bx = Math.floor(x / bw);
      const by = Math.floor(y / bh);
      // Each block gets a stable random threshold, so they vanish in a
      // scattered order rather than a sweep.
      const n = Math.sin(bx * 127.1 + by * 311.7) * 43758.5453;
      const threshold = n - Math.floor(n);
      out[3] = soft
        ? a * clamp01((threshold - completion) / feather)
        : a * (threshold > completion ? 1 : 0);
    });
  },
});

registerEffect({
  matchName: 'ADBE Gradient Wipe',
  name: 'Gradient Wipe',
  category: 'Transition',
  params: [
    { key: 'completion', name: 'Transition Completion', kind: 'percent', default: 0, min: 0, max: 100, unit: '%' },
    { key: 'softness', name: 'Transition Softness', kind: 'percent', default: 10, min: 0, max: 100, unit: '%' },
    {
      key: 'channel', name: 'Gradient Channel', kind: 'select', default: 0,
      options: ['Luminance', 'Red', 'Green', 'Blue', 'Alpha'],
    },
    { key: 'invert', name: 'Invert Gradient', kind: 'checkbox', default: 0 },
  ],
  apply: ({ source, dest, width, height, get }) => {
    // Without a second layer to read, the layer's own channels are the
    // gradient — which is how the effect is most often used in practice.
    const completion = get<number>('completion') / 100;
    const softness = Math.max(0.0001, get<number>('softness') / 100);
    const channel = Math.round(get<number>('channel'));
    const invert = get<number>('invert') >= 0.5;

    mapPixels(source, dest, width, height, (r, g, b, a, _x, _y, out) => {
      const value = channel === 1 ? r : channel === 2 ? g : channel === 3 ? b
        : channel === 4 ? a : 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const level = (invert ? 255 - value : value) / 255;
      out[3] = a * clamp01((level - completion * (1 + softness)) / softness + 1);
    });
  },
});
