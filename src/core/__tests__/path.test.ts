import { describe, expect, it } from 'vitest';
import {
  clonePath, ellipsePath, flattenPath, interpolatePaths, offsetPath, pathBounds,
  pathContains, pathLength, pathSegments, rectPath, splitCubic, starPath,
  transformPath, trimPath, vertex,
} from '../path';
import { rotation, scaling, translation } from '../matrix';
import type { Vec2 } from '../types';

const square = () => rectPath([0, 0], [100, 100]);

describe('path primitives', () => {
  it('builds a rectangle with four corners', () => {
    const path = square();
    expect(path.vertices).toHaveLength(4);
    expect(path.closed).toBe(true);
    const bounds = pathBounds(path);
    expect(bounds.width).toBeCloseTo(100, 6);
    expect(bounds.height).toBeCloseTo(100, 6);
  });

  it('rounds rectangle corners without changing the bounds', () => {
    const bounds = pathBounds(rectPath([0, 0], [100, 100], 20));
    expect(bounds.width).toBeCloseTo(100, 4);
    expect(bounds.height).toBeCloseTo(100, 4);
  });

  it('approximates an ellipse closely enough to measure', () => {
    const path = ellipsePath([0, 0], [200, 200]);
    // Circumference of a circle of radius 100.
    expect(pathLength(path)).toBeCloseTo(2 * Math.PI * 100, 0);
  });

  it('alternates radii for a star and not for a polygon', () => {
    expect(starPath([0, 0], 5, 100, 50).vertices).toHaveLength(10);
    expect(starPath([0, 0], 5, 100, 50, 0, false).vertices).toHaveLength(5);
  });
});

describe('path geometry', () => {
  it('measures a square perimeter', () => {
    expect(pathLength(square())).toBeCloseTo(400, 4);
  });

  it('splits a cubic without moving the curve', () => {
    const [seg] = pathSegments(ellipsePath([0, 0], [200, 200]));
    const [a, b] = splitCubic(seg, 0.4);
    expect(a.p3).toEqual(b.p0);
    expect(a.p0).toEqual(seg.p0);
    expect(b.p3).toEqual(seg.p3);
  });

  it('tests containment', () => {
    const path = square();
    expect(pathContains(path, [0, 0])).toBe(true);
    expect(pathContains(path, [80, 0])).toBe(false);
  });

  it('transforms points and tangents but never translates a tangent', () => {
    const path = { vertices: [vertex([10, 0], [-5, 0], [5, 0])], closed: false };
    const moved = transformPath(path, translation(100, 50));
    expect(moved.vertices[0].point).toEqual([110, 50]);
    expect(moved.vertices[0].outTangent).toEqual([5, 0]);

    const scaled = transformPath(path, scaling(2, 2));
    expect(scaled.vertices[0].outTangent).toEqual([10, 0]);

    const turned = transformPath(path, rotation(90));
    expect(turned.vertices[0].outTangent[0]).toBeCloseTo(0, 6);
    expect(turned.vertices[0].outTangent[1]).toBeCloseTo(5, 6);
  });
});

describe('trim paths', () => {
  it('keeps the whole outline when nothing is trimmed', () => {
    const trimmed = trimPath(square(), 0, 1);
    expect(pathLength(trimmed)).toBeCloseTo(400, 3);
  });

  it('keeps half the outline for a half trim', () => {
    const trimmed = trimPath(square(), 0, 0.5);
    expect(pathLength(trimmed)).toBeCloseTo(200, 1);
    expect(trimmed.closed).toBe(false);
  });

  it('offsets the trimmed run around a closed path', () => {
    const a = trimPath(square(), 0, 0.25);
    const b = trimPath(square(), 0, 0.25, 0.5);
    expect(pathLength(a)).toBeCloseTo(pathLength(b), 1);
    expect(a.vertices[0].point).not.toEqual(b.vertices[0].point);
  });

  it('produces an empty run when start and end meet', () => {
    expect(pathLength(trimPath(square(), 0.5, 0.5))).toBeCloseTo(0, 6);
  });
});

describe('offset paths', () => {
  it('grows a closed shape outward and shrinks it inward', () => {
    const grown = pathBounds(offsetPath(square(), 10));
    const shrunk = pathBounds(offsetPath(square(), -10));
    expect(grown.width).toBeGreaterThan(100);
    expect(shrunk.width).toBeLessThan(100);
  });

  it('returns the path untouched for a zero offset', () => {
    const path = square();
    expect(offsetPath(path, 0).vertices).toHaveLength(path.vertices.length);
  });
});

describe('path animation', () => {
  it('blends vertex by vertex when the counts match', () => {
    const a = rectPath([0, 0], [100, 100]);
    const b = rectPath([0, 0], [200, 200]);
    const mid = interpolatePaths(a, b, 0.5);
    expect(pathBounds(mid).width).toBeCloseTo(150, 4);
  });

  it('holds the first shape when the vertex counts differ', () => {
    const a = rectPath([0, 0], [100, 100]);
    const b = starPath([0, 0], 5, 100, 50);
    expect(interpolatePaths(a, b, 0.5).vertices).toHaveLength(4);
    expect(interpolatePaths(a, b, 1).vertices).toHaveLength(10);
  });

  it('clones without sharing references', () => {
    const path = square();
    const copy = clonePath(path);
    copy.vertices[0].point[0] = 999;
    expect(path.vertices[0].point[0]).not.toBe(999);
  });

  it('flattens into a polyline that follows the outline', () => {
    const points: Vec2[] = flattenPath(square(), 4);
    expect(points.length).toBeGreaterThan(8);
    for (const [x, y] of points) {
      expect(Math.max(Math.abs(x), Math.abs(y))).toBeLessThanOrEqual(50.001);
    }
  });
});
