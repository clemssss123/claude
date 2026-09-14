import { copyBuffer } from './pixels';
import { registerEffect } from './registry';

/**
 * Time effects.
 *
 * These re-render the layer at other times through the context's
 * `sampleAtTime`, which the renderer supplies for layers that have content of
 * their own. On an adjustment layer there is nothing to re-render, so they
 * pass the frame through untouched.
 */

registerEffect({
  matchName: 'ADBE Echo',
  name: 'Echo',
  category: 'Time',
  params: [
    { key: 'echoTime', name: 'Echo Time (seconds)', kind: 'number', default: -0.05, min: -5, max: 5, speedPerPixel: 0.005 },
    { key: 'echoes', name: 'Number Of Echoes', kind: 'number', default: 5, min: 1, max: 32 },
    { key: 'startIntensity', name: 'Starting Intensity', kind: 'number', default: 1, min: 0, max: 1, speedPerPixel: 0.01 },
    { key: 'decay', name: 'Decay', kind: 'number', default: 0.6, min: 0, max: 1, speedPerPixel: 0.01 },
    {
      key: 'operator', name: 'Echo Operator', kind: 'select', default: 0,
      options: ['Add', 'Maximum', 'Composite In Back', 'Composite In Front'],
    },
  ],
  apply: ({ source, dest, width, height, time, get, sampleAtTime }) => {
    const echoes = Math.max(1, Math.min(32, Math.round(get<number>('echoes'))));
    const step = get<number>('echoTime');
    const start = get<number>('startIntensity');
    const decay = get<number>('decay');
    const operator = Math.round(get<number>('operator'));

    dest.ctx.setTransform(1, 0, 0, 1, 0, 0);
    dest.ctx.globalCompositeOperation = 'copy';
    dest.ctx.globalAlpha = 1;
    dest.ctx.clearRect(0, 0, width, height);
    dest.ctx.globalCompositeOperation = 'source-over';

    if (!sampleAtTime) {
      copyBuffer(source, dest, width, height);
      return;
    }

    // Draw the oldest echo first so the newest lands on top.
    const composite: GlobalCompositeOperation = operator === 1 ? 'lighten'
      : operator === 2 ? 'destination-over' : operator === 3 ? 'source-over' : 'lighter';

    for (let i = echoes; i >= 1; i -= 1) {
      const sample = sampleAtTime(time + step * i);
      if (!sample) continue;
      dest.ctx.globalCompositeOperation = composite;
      dest.ctx.globalAlpha = Math.max(0, Math.min(1, start * decay ** i));
      dest.ctx.drawImage(sample.canvas as CanvasImageSource, 0, 0);
    }

    dest.ctx.globalCompositeOperation = operator === 2 ? 'destination-over' : 'source-over';
    dest.ctx.globalAlpha = Math.max(0, Math.min(1, start));
    dest.ctx.drawImage(source.canvas as CanvasImageSource, 0, 0);
    dest.ctx.globalAlpha = 1;
    dest.ctx.globalCompositeOperation = 'source-over';
  },
});

registerEffect({
  matchName: 'ADBE Posterize Time',
  name: 'Posterize Time',
  category: 'Time',
  params: [
    { key: 'frameRate', name: 'Frame Rate', kind: 'number', default: 12, min: 0.1, max: 120 },
  ],
  apply: ({ source, dest, width, height, time, get, sampleAtTime }) => {
    const rate = Math.max(0.1, get<number>('frameRate'));
    const stepped = Math.floor(time * rate) / rate;

    // Holding each frame for longer is the whole effect: sample the layer at
    // the quantized time instead of now.
    const sample = sampleAtTime?.(stepped);
    if (!sample) {
      copyBuffer(source, dest, width, height);
      return;
    }
    dest.ctx.setTransform(1, 0, 0, 1, 0, 0);
    dest.ctx.globalCompositeOperation = 'copy';
    dest.ctx.globalAlpha = 1;
    dest.ctx.drawImage(sample.canvas as CanvasImageSource, 0, 0);
    dest.ctx.globalCompositeOperation = 'source-over';
  },
});
