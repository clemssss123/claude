/**
 * Cubic bezier solving for temporal keyframe interpolation.
 *
 * The curve always runs from (0,0) to (1,1) in normalized segment space.
 * Control point X coordinates are constrained to 0..1 (they come from handle
 * influence, a percentage), which guarantees the curve is a function of X and
 * lets us solve X for T. Control point Y coordinates are unconstrained, so
 * overshoot (a handle that pushes past the keyframe value) works.
 */

const NEWTON_ITERATIONS = 8;
const NEWTON_EPSILON = 1e-7;
const SUBDIVISION_EPSILON = 1e-7;
const SUBDIVISION_MAX = 32;

function a(c1: number, c2: number) { return 1 - 3 * c2 + 3 * c1; }
function b(c1: number, c2: number) { return 3 * c2 - 6 * c1; }
function c(c1: number) { return 3 * c1; }

/** Evaluate one axis of the unit cubic bezier at parameter t. */
export function bezierAxis(t: number, c1: number, c2: number): number {
  return ((a(c1, c2) * t + b(c1, c2)) * t + c(c1)) * t;
}

/** d/dt of {@link bezierAxis}. */
export function bezierAxisSlope(t: number, c1: number, c2: number): number {
  return 3 * a(c1, c2) * t * t + 2 * b(c1, c2) * t + c(c1);
}

/** Find the curve parameter t such that X(t) === x, for x in 0..1. */
export function solveBezierT(x: number, x1: number, x2: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Newton-Raphson first: fast when the curve is well behaved.
  let t = x;
  for (let i = 0; i < NEWTON_ITERATIONS; i += 1) {
    const slope = bezierAxisSlope(t, x1, x2);
    if (Math.abs(slope) < NEWTON_EPSILON) break;
    const error = bezierAxis(t, x1, x2) - x;
    if (Math.abs(error) < NEWTON_EPSILON) return t;
    t -= error / slope;
  }

  // Bisection fallback: always converges, even on near-flat handles.
  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < SUBDIVISION_MAX; i += 1) {
    const value = bezierAxis(t, x1, x2);
    if (Math.abs(value - x) < SUBDIVISION_EPSILON) return t;
    if (value > x) hi = t; else lo = t;
    t = (lo + hi) / 2;
  }
  return t;
}

/**
 * Standard cubic-bezier easing: map a normalized time 0..1 to a normalized
 * progress, given the two control points (x1,y1) and (x2,y2).
 */
export function cubicBezierEase(
  x: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  if (x1 === y1 && x2 === y2) return x; // straight line, skip the solve
  return bezierAxis(solveBezierT(x, x1, x2), y1, y2);
}
