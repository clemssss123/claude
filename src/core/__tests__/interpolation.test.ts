import { describe, expect, it } from 'vitest';
import {
  applyEasyEase, evaluateKeyframes, interpolateKeyframes, lerpValue,
  segmentControlPoints, valueDelta,
} from '../interpolation';
import { addKeyframe, createProperty, setAnimated, valueAtTime } from '../property';
import type { Keyframe, Vec2 } from '../types';

function track(): Keyframe<number>[] {
  const prop = createProperty<number>('Opacity', 'ADBE Opacity', 'percent', 0);
  setAnimated(prop, 0, true);
  prop.keyframes = [];
  addKeyframe(prop, 0, 0);
  addKeyframe(prop, 1, 100);
  return prop.keyframes;
}

describe('interpolation', () => {
  it('lerps scalars and vectors component-wise', () => {
    expect(lerpValue(0, 10, 0.25)).toBe(2.5);
    expect(lerpValue<Vec2>([0, 100], [100, 0], 0.5)).toEqual([50, 50]);
  });

  it('measures vector deltas as magnitudes', () => {
    expect(valueDelta(0, 5)).toBe(5);
    expect(valueDelta([0, 0] as Vec2, [3, 4] as Vec2)).toBe(5);
  });

  it('interpolates linearly between two linear keyframes', () => {
    const kfs = track();
    expect(interpolateKeyframes(kfs[0], kfs[1], 0.5)).toBeCloseTo(50, 6);
    expect(interpolateKeyframes(kfs[0], kfs[1], 0.25)).toBeCloseTo(25, 6);
  });

  it('holds the outgoing value across a hold segment', () => {
    const kfs = track();
    kfs[0].outType = 'hold';
    expect(interpolateKeyframes(kfs[0], kfs[1], 0.99)).toBe(0);
  });

  it('slows the start and end of an Easy Ease segment', () => {
    const kfs = track();
    applyEasyEase(kfs[0], 'out');
    applyEasyEase(kfs[1], 'in');
    expect(interpolateKeyframes(kfs[0], kfs[1], 0.5)).toBeCloseTo(50, 4);
    expect(interpolateKeyframes(kfs[0], kfs[1], 0.25)).toBeLessThan(25);
    expect(interpolateKeyframes(kfs[0], kfs[1], 0.75)).toBeGreaterThan(75);
  });

  it('builds Easy Ease control points at one third influence and zero speed', () => {
    const [x1, y1, x2, y2] = segmentControlPoints(
      'bezier', { influence: 33.333333, speed: 0 },
      'bezier', { influence: 33.333333, speed: 0 },
      1, 100,
    );
    expect(x1).toBeCloseTo(0.3333, 3);
    expect(y1).toBeCloseTo(0, 6);
    expect(x2).toBeCloseTo(0.6667, 3);
    expect(y2).toBeCloseTo(1, 6);
  });

  it('holds the first and last values outside the keyframe range', () => {
    const kfs = track();
    expect(evaluateKeyframes(kfs, -5)).toBe(0);
    expect(evaluateKeyframes(kfs, 99)).toBe(100);
  });

  it('finds the right segment among many keyframes', () => {
    const prop = createProperty<number>('X', 'X', 'number', 0);
    setAnimated(prop, 0, true);
    prop.keyframes = [];
    for (let i = 0; i <= 10; i += 1) addKeyframe(prop, i, i * 10);
    expect(valueAtTime(prop, 4.5)).toBeCloseTo(45, 6);
    expect(valueAtTime(prop, 7.25)).toBeCloseTo(72.5, 6);
  });
});
