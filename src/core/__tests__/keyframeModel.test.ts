import { describe, expect, it } from 'vitest';
import { applyBezierToSegment } from '../easings';
import { autoTangentSpeed, enforceTangentMode } from '../interpolation';
import {
  addKeyframe, applyRoving, createProperty, mergeDimensions, separateDimensions,
  setAnimated, setRoving, valueAtTime,
} from '../property';
import { motionPathPoints, positionAtTime } from '../spatial';
import type { Vec2 } from '../types';

function positionProp(): ReturnType<typeof createProperty<Vec2>> {
  const prop = createProperty<Vec2>('Position', 'ADBE Position', 'vec2', [0, 0], {
    dimensionNames: ['X', 'Y'],
  });
  prop.spatial = true;
  return prop;
}

describe('separate dimensions', () => {
  it('splits a vector losslessly, easing included', () => {
    const prop = positionProp();
    setAnimated(prop, 0, true);
    prop.keyframes = [];
    addKeyframe(prop, 0, [0, 100]);
    addKeyframe(prop, 1, [200, 400]);
    addKeyframe(prop, 2, [300, 0]);
    applyBezierToSegment(prop.keyframes[0], prop.keyframes[1], [0.83, 0, 0.17, 1]);
    applyBezierToSegment(prop.keyframes[1], prop.keyframes[2], [0.34, 1.56, 0.64, 1]);

    const before = [0.15, 0.4, 0.9, 1.2, 1.7].map((t) => valueAtTime(prop, t) as Vec2);
    separateDimensions(prop);

    expect(prop.separated).toBe(true);
    expect(prop.dimensions).toHaveLength(2);
    expect(prop.dimensions![0].name).toBe('X Position');

    const after = [0.15, 0.4, 0.9, 1.2, 1.7].map((t) => valueAtTime(prop, t) as Vec2);
    after.forEach((value, i) => {
      expect(value[0]).toBeCloseTo(before[i][0], 4);
      expect(value[1]).toBeCloseTo(before[i][1], 4);
    });
  });

  it('merges the dimensions back together', () => {
    const prop = positionProp();
    setAnimated(prop, 0, true);
    prop.keyframes = [];
    addKeyframe(prop, 0, [0, 0]);
    addKeyframe(prop, 1, [100, 50]);

    separateDimensions(prop);
    mergeDimensions(prop);

    expect(prop.separated).toBe(false);
    expect(prop.dimensions).toBeUndefined();
    expect(prop.keyframes).toHaveLength(2);
    expect(valueAtTime(prop, 0.5)).toEqual([50, 25]);
  });

  it('keeps dimension keyframes independent once split', () => {
    const prop = positionProp();
    setAnimated(prop, 0, true);
    prop.keyframes = [];
    addKeyframe(prop, 0, [0, 0]);
    addKeyframe(prop, 1, [100, 100]);
    separateDimensions(prop);

    addKeyframe(prop.dimensions![0], 0.5, 400);
    expect((valueAtTime(prop, 0.5) as Vec2)[0]).toBe(400);
    expect((valueAtTime(prop, 0.5) as Vec2)[1]).toBeCloseTo(50, 6);
  });
});

describe('roving keyframes', () => {
  it('redistributes time so speed stays constant', () => {
    const prop = createProperty<number>('X', 'X', 'number', 0);
    setAnimated(prop, 0, true);
    prop.keyframes = [];
    addKeyframe(prop, 0, 0);
    addKeyframe(prop, 0.1, 20);   // badly timed middle keyframe
    addKeyframe(prop, 1, 100);

    setRoving(prop, prop.keyframes[1].id, true);
    // 20 of the 100 units of travel, so a fifth of the way through the second.
    expect(prop.keyframes[1].time).toBeCloseTo(0.2, 6);
  });

  it('never roves the first or last keyframe', () => {
    const prop = createProperty<number>('X', 'X', 'number', 0);
    setAnimated(prop, 0, true);
    prop.keyframes = [];
    addKeyframe(prop, 0, 0);
    addKeyframe(prop, 1, 100);

    setRoving(prop, prop.keyframes[0].id, true);
    setRoving(prop, prop.keyframes[1].id, true);
    expect(prop.keyframes.every((k) => !k.roving)).toBe(true);
  });

  it('spaces a degenerate run evenly', () => {
    const prop = createProperty<number>('X', 'X', 'number', 0);
    setAnimated(prop, 0, true);
    prop.keyframes = [];
    addKeyframe(prop, 0, 50);
    addKeyframe(prop, 0.1, 50);
    addKeyframe(prop, 0.2, 50);
    addKeyframe(prop, 1, 50);
    prop.keyframes[1].roving = true;
    prop.keyframes[2].roving = true;
    applyRoving(prop);

    expect(prop.keyframes[1].time).toBeCloseTo(1 / 3, 6);
    expect(prop.keyframes[2].time).toBeCloseTo(2 / 3, 6);
  });
});

describe('tangent modes', () => {
  it('gives an auto keyframe the slope through its neighbours', () => {
    const prop = createProperty<number>('X', 'X', 'number', 0);
    setAnimated(prop, 0, true);
    prop.keyframes = [];
    addKeyframe(prop, 0, 0);
    addKeyframe(prop, 1, 50);
    addKeyframe(prop, 2, 200);

    expect(autoTangentSpeed(prop.keyframes[0], prop.keyframes[1], prop.keyframes[2]))
      .toBeCloseTo(100, 6);
    expect(autoTangentSpeed(undefined, prop.keyframes[0], prop.keyframes[1])).toBe(0);
  });

  it('mirrors speed across a continuous keyframe', () => {
    const prop = createProperty<number>('X', 'X', 'number', 0);
    setAnimated(prop, 0, true);
    prop.keyframes = [];
    addKeyframe(prop, 0, 0);
    addKeyframe(prop, 1, 50);
    addKeyframe(prop, 2, 200);

    const middle = prop.keyframes[1];
    middle.tangentMode = 'continuous';
    middle.easeOut = { influence: 20, speed: 75 };
    enforceTangentMode(prop.keyframes, 1, 'out');
    expect(middle.easeIn.speed).toBe(75);
    expect(middle.easeIn.influence).toBe(middle.easeIn.influence); // influence stays free
  });
});

describe('motion path', () => {
  it('stays a straight line for two keyframes', () => {
    const prop = positionProp();
    setAnimated(prop, 0, true);
    prop.keyframes = [];
    addKeyframe(prop, 0, [0, 0]);
    addKeyframe(prop, 1, [100, 0]);

    const mid = positionAtTime(prop, 0.5);
    expect(mid[0]).toBeCloseTo(50, 6);
    expect(mid[1]).toBeCloseTo(0, 6);
  });

  it('curves through a middle keyframe with auto tangents', () => {
    const prop = positionProp();
    setAnimated(prop, 0, true);
    prop.keyframes = [];
    addKeyframe(prop, 0, [0, 0]);
    addKeyframe(prop, 1, [100, 100]);
    addKeyframe(prop, 2, [200, 0]);

    // A straight-line interpolation would put this exactly on the segment.
    const point = positionAtTime(prop, 0.5);
    expect(point[1]).toBeGreaterThan(point[0] + 1);
    expect(motionPathPoints(prop).length).toBeGreaterThan(40);
  });

  it('respects hold segments on the path', () => {
    const prop = positionProp();
    setAnimated(prop, 0, true);
    prop.keyframes = [];
    addKeyframe(prop, 0, [0, 0]);
    addKeyframe(prop, 1, [100, 100]);
    prop.keyframes[0].outType = 'hold';
    expect(positionAtTime(prop, 0.9)).toEqual([0, 0]);
  });

  it('moves at a constant rate along a curved path for a linear segment', () => {
    const prop = positionProp();
    setAnimated(prop, 0, true);
    prop.keyframes = [];
    addKeyframe(prop, 0, [0, 0]);
    addKeyframe(prop, 1, [100, 100]);
    addKeyframe(prop, 2, [200, 0]);

    const step = (t: number) => {
      const a = positionAtTime(prop, t);
      const b = positionAtTime(prop, t + 0.05);
      return Math.hypot(b[0] - a[0], b[1] - a[1]);
    };
    const distances = [0.1, 0.3, 0.5, 0.7].map(step);
    const spread = Math.max(...distances) - Math.min(...distances);
    expect(spread).toBeLessThan(Math.max(...distances) * 0.1);
  });
});
