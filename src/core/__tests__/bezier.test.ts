import { describe, expect, it } from 'vitest';
import { bezierAxis, cubicBezierEase, solveBezierT } from '../bezier';

describe('bezier', () => {
  it('solves t so that X(t) === x', () => {
    for (const x of [0, 0.1, 0.25, 0.5, 0.75, 0.99, 1]) {
      const t = solveBezierT(x, 0.42, 0.58);
      expect(bezierAxis(t, 0.42, 0.58)).toBeCloseTo(x, 6);
    }
  });

  it('is the identity when control points sit on the diagonal', () => {
    for (const x of [0.2, 0.4, 0.6, 0.8]) {
      expect(cubicBezierEase(x, 1 / 3, 1 / 3, 2 / 3, 2 / 3)).toBeCloseTo(x, 6);
    }
  });

  it('eases in and out symmetrically around the midpoint', () => {
    const ease = (x: number) => cubicBezierEase(x, 1 / 3, 0, 2 / 3, 1);
    expect(ease(0.5)).toBeCloseTo(0.5, 6);
    expect(ease(0.25)).toBeLessThan(0.25);
    expect(ease(0.75)).toBeGreaterThan(0.75);
    expect(ease(0.25) + ease(0.75)).toBeCloseTo(1, 6);
  });

  it('stays monotonic for handles inside the unit square', () => {
    let previous = -Infinity;
    for (let i = 0; i <= 100; i += 1) {
      const v = cubicBezierEase(i / 100, 0.9, 0.1, 0.1, 0.9);
      expect(v).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = v;
    }
  });

  it('handles overshoot from handles outside the unit square', () => {
    const overshoot = cubicBezierEase(0.8, 0.3, 0.2, 0.6, 1.6);
    expect(overshoot).toBeGreaterThan(1);
  });
});
