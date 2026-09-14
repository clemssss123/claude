import { describe, expect, it } from 'vitest';
import {
  addKeyframe, createProperty, findKeyframeAt, moveKeyframe, nextKeyframeTime,
  prevKeyframeTime, setAnimated, setValueAtTime, valueAtTime, velocityAtTime,
} from '../property';
import type { Vec2 } from '../types';

describe('property', () => {
  it('ignores keyframes while the stopwatch is off', () => {
    const prop = createProperty<number>('Opacity', 'ADBE Opacity', 'percent', 42);
    addKeyframe(prop, 0, 0);
    addKeyframe(prop, 1, 100);
    expect(valueAtTime(prop, 0.5)).toBe(42);
    prop.animated = true;
    expect(valueAtTime(prop, 0.5)).toBeCloseTo(50, 6);
  });

  it('captures the current value when the stopwatch is enabled', () => {
    const prop = createProperty<number>('Rotation', 'ADBE Rotate Z', 'angle', 30);
    setAnimated(prop, 2, true);
    expect(prop.keyframes).toHaveLength(1);
    expect(prop.keyframes[0].time).toBe(2);
    expect(prop.keyframes[0].value).toBe(30);
  });

  it('freezes the evaluated value when the stopwatch is disabled', () => {
    const prop = createProperty<number>('Rotation', 'ADBE Rotate Z', 'angle', 0);
    setAnimated(prop, 0, true);
    addKeyframe(prop, 1, 90);
    setAnimated(prop, 0.5, false);
    expect(prop.keyframes).toHaveLength(0);
    expect(prop.value).toBeCloseTo(45, 6);
  });

  it('adds a keyframe without changing the animated value', () => {
    const prop = createProperty<number>('X', 'X', 'number', 0);
    setAnimated(prop, 0, true);
    addKeyframe(prop, 2, 100);
    const before = valueAtTime(prop, 1);
    addKeyframe(prop, 1);
    expect(valueAtTime(prop, 1)).toBeCloseTo(before, 6);
  });

  it('keeps keyframes sorted and replaces collisions when moving', () => {
    const prop = createProperty<number>('X', 'X', 'number', 0);
    setAnimated(prop, 0, true);
    const a = addKeyframe(prop, 1, 10);
    addKeyframe(prop, 2, 20);
    moveKeyframe(prop, a.id, 3);
    expect(prop.keyframes.map((k) => k.time)).toEqual([0, 2, 3]);

    moveKeyframe(prop, a.id, 2);
    expect(prop.keyframes).toHaveLength(2);
    expect(findKeyframeAt(prop, 2)?.value).toBe(10);
  });

  it('clamps values to the property range', () => {
    const prop = createProperty<number>('Opacity', 'ADBE Opacity', 'percent', 100, {
      min: 0, max: 100,
    });
    setValueAtTime(prop, 0, 250);
    expect(prop.value).toBe(100);
    setValueAtTime(prop, 0, -10);
    expect(prop.value).toBe(0);
  });

  it('writes keyframes instead of the static value while animating', () => {
    const prop = createProperty<Vec2>('Position', 'ADBE Position', 'vec2', [0, 0]);
    setAnimated(prop, 0, true);
    setValueAtTime(prop, 1, [100, 200]);
    expect(prop.keyframes).toHaveLength(2);
    expect(valueAtTime(prop, 1)).toEqual([100, 200]);
  });

  it('navigates to the neighbouring keyframes', () => {
    const prop = createProperty<number>('X', 'X', 'number', 0);
    setAnimated(prop, 0, true);
    addKeyframe(prop, 1, 1);
    addKeyframe(prop, 2, 2);
    expect(nextKeyframeTime(prop, 0)).toBe(1);
    expect(nextKeyframeTime(prop, 2)).toBeNull();
    expect(prevKeyframeTime(prop, 2)).toBe(1);
    expect(prevKeyframeTime(prop, 0)).toBeNull();
  });

  it('reports velocity in units per second', () => {
    const prop = createProperty<number>('X', 'X', 'number', 0);
    setAnimated(prop, 0, true);
    addKeyframe(prop, 1, 100);
    expect(velocityAtTime(prop, 0.5)).toBeCloseTo(100, 1);
  });
});
