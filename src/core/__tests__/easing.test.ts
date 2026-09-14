import { describe, expect, it } from 'vitest';
import { cubicBezierEase } from '../bezier';
import {
  BUILTIN_PRESETS, applyBezierToSegment, bakeIntoSegment, samplePreset,
} from '../easings';
import { cubicBezierFromSegment, easeFromCubicBezier } from '../interpolation';
import { addKeyframe, createProperty, setAnimated, valueAtTime } from '../property';

function twoKeyframes(from = 0, to = 100, duration = 1) {
  const prop = createProperty<number>('X', 'X', 'number', from);
  setAnimated(prop, 0, true);
  addKeyframe(prop, 0, from);
  addKeyframe(prop, duration, to);
  return prop;
}

describe('easing presets', () => {
  it('round-trips a cubic bezier through the influence/speed handles', () => {
    const points: [number, number, number, number] = [0.25, 0.1, 0.6, 1.4];
    const prop = twoKeyframes();
    const [a, b] = prop.keyframes;
    applyBezierToSegment(a, b, points);

    const recovered = cubicBezierFromSegment(a, b);
    recovered.forEach((v, i) => expect(v).toBeCloseTo(points[i], 6));
  });

  it('reproduces the preset curve in the evaluated values', () => {
    const points: [number, number, number, number] = [0.83, 0, 0.17, 1];
    const prop = twoKeyframes(0, 100, 2);
    applyBezierToSegment(prop.keyframes[0], prop.keyframes[1], points);

    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const expected = cubicBezierEase(t, ...points) * 100;
      expect(valueAtTime(prop, t * 2)).toBeCloseTo(expected, 4);
    }
  });

  it('survives a segment whose value does not change', () => {
    const prop = twoKeyframes(50, 50);
    applyBezierToSegment(prop.keyframes[0], prop.keyframes[1], [0.33, 0, 0.67, 1]);
    expect(valueAtTime(prop, 0.5)).toBe(50);
  });

  it('handles a preset with a zero-length first handle', () => {
    const { easeOut } = easeFromCubicBezier(0, 0, 0.5, 1, 1, 100);
    expect(easeOut.speed).toBe(0);
    expect(easeOut.influence).toBeGreaterThan(0);
  });

  it('ships every documented preset family', () => {
    const groups = new Set(BUILTIN_PRESETS.map((p) => p.group));
    for (const family of ['Sine', 'Quad', 'Cubic', 'Quart', 'Quint', 'Expo', 'Circ', 'Back', 'Elastic', 'Bounce']) {
      expect(groups.has(family)).toBe(true);
    }
    expect(BUILTIN_PRESETS.every((p) => p.kind === 'baked' || p.points)).toBe(true);
  });

  it('starts and ends every preset curve at 0 and 1', () => {
    for (const preset of BUILTIN_PRESETS) {
      expect(samplePreset(preset, 0)).toBeCloseTo(0, 6);
      expect(samplePreset(preset, 1)).toBeCloseTo(1, 6);
    }
  });

  it('overshoots for Back and oscillates for Bounce', () => {
    const back = BUILTIN_PRESETS.find((p) => p.id === 'backOut')!;
    const samples = Array.from({ length: 50 }, (_, i) => samplePreset(back, i / 49));
    expect(Math.max(...samples)).toBeGreaterThan(1);

    const bounce = BUILTIN_PRESETS.find((p) => p.id === 'bounceOut')!;
    const values = Array.from({ length: 60 }, (_, i) => samplePreset(bounce, i / 59));
    const descents = values.filter((v, i) => i > 0 && v < values[i - 1]).length;
    expect(descents).toBeGreaterThan(1);
  });

  it('bakes an oscillating preset into keyframes inside the segment', () => {
    const prop = twoKeyframes(0, 100, 1);
    bakeIntoSegment(prop, prop.keyframes[0], prop.keyframes[1], 'bounceOut', 30);

    expect(prop.keyframes.length).toBeGreaterThan(10);
    expect(prop.keyframes[0].time).toBe(0);
    expect(prop.keyframes[prop.keyframes.length - 1].time).toBeCloseTo(1, 9);
    expect(valueAtTime(prop, 1)).toBeCloseTo(100, 6);

    // A bounce comes back down at least once on the way.
    const samples = Array.from({ length: 60 }, (_, i) => valueAtTime(prop, i / 59));
    expect(samples.some((v, i) => i > 0 && v < samples[i - 1])).toBe(true);
  });

  it('replaces a previous bake rather than stacking keyframes', () => {
    const prop = twoKeyframes(0, 100, 1);
    bakeIntoSegment(prop, prop.keyframes[0], prop.keyframes[1], 'bounceOut', 30);
    const first = prop.keyframes.length;
    const last = prop.keyframes[prop.keyframes.length - 1];
    bakeIntoSegment(prop, prop.keyframes[0], last, 'elasticOut', 30);
    expect(prop.keyframes.length).toBe(first);
  });
});
