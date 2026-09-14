import { cubicBezierEase } from './bezier';
import { interpolatePaths, isBezierPath, pathDelta } from './path';
import type {
  Ease, InterpolationType, Keyframe, PropertyValue, RGBA, TangentMode, Vec2,
} from './types';

/** After Effects' default handle influence for a fresh bezier handle. */
export const DEFAULT_INFLUENCE = 16.666666;
/** The influence Easy Ease (F9) applies. */
export const EASY_EASE_INFLUENCE = 33.333333;

export function defaultEase(): Ease {
  return { influence: DEFAULT_INFLUENCE, speed: 0 };
}

export function clampInfluencePercent(value: number): number {
  return Math.min(100, Math.max(0.1, value));
}

export function isVec2(v: PropertyValue): v is Vec2 {
  return Array.isArray(v) && v.length === 2;
}

export function isRGBA(v: PropertyValue): v is RGBA {
  return Array.isArray(v) && v.length === 4;
}

/** Component-wise linear blend of two values of the same shape. */
export function lerpValue<T extends PropertyValue>(from: T, to: T, t: number): T {
  if (typeof from === 'number' && typeof to === 'number') {
    return (from + (to - from) * t) as T;
  }
  if (isBezierPath(from) && isBezierPath(to)) {
    return interpolatePaths(from, to, t) as T;
  }
  const a = from as number[];
  const b = to as number[];
  const out = new Array(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = a[i] + (b[i] - a[i]) * t;
  return out as T;
}

/**
 * Scalar magnitude of the change across a segment. Multi-dimensional
 * properties share a single speed curve (this is what After Effects does
 * until you separate dimensions), so their speed is expressed as the
 * magnitude of the delta vector per second.
 */
export function valueDelta(from: PropertyValue, to: PropertyValue): number {
  if (typeof from === 'number' && typeof to === 'number') return to - from;
  if (isBezierPath(from) && isBezierPath(to)) return pathDelta(from, to);
  const a = from as number[];
  const b = to as number[];
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += (b[i] - a[i]) ** 2;
  return Math.sqrt(sum);
}

function clampInfluence(v: number): number {
  return Math.min(100, Math.max(0.1, v)) / 100;
}

/**
 * Control points of the normalized (0,0)->(1,1) easing curve for a segment.
 *
 * A handle's Y offset is `speed * duration * influence` in value units; the
 * curve is normalized by the segment's value delta, so the handles become
 * `(influence, normalizedSpeed * influence)` from each end.
 *
 * A linear side contributes a handle that lies on the straight line (y = x),
 * which is why a linear/linear segment collapses to the identity.
 */
export function segmentControlPoints(
  outType: InterpolationType,
  easeOut: Ease,
  inType: InterpolationType,
  easeIn: Ease,
  duration: number,
  delta: number,
): [number, number, number, number] {
  const x1 = clampInfluence(outType === 'bezier' ? easeOut.influence : DEFAULT_INFLUENCE);
  const i2 = clampInfluence(inType === 'bezier' ? easeIn.influence : DEFAULT_INFLUENCE);
  const x2 = 1 - i2;

  // A zero delta cannot be normalized; fall back to a pure influence curve so
  // the segment still eases instead of dividing by zero.
  const scale = delta === 0 || duration === 0 ? 0 : duration / delta;

  const y1 = outType === 'bezier' ? easeOut.speed * scale * x1 : x1;
  const y2 = inType === 'bezier' ? 1 - easeIn.speed * scale * i2 : x2;

  return [x1, y1, x2, y2];
}

/**
 * Eased progress through a segment, 0..1 (or beyond, when handles overshoot).
 * Separated from value interpolation because a motion path needs the progress
 * on its own to walk along a curve in space.
 */
export function segmentProgress(a: Keyframe, b: Keyframe, time: number): number {
  if (a.outType === 'hold') return 0;
  const duration = b.time - a.time;
  if (duration <= 0) return 1;

  const x = Math.min(1, Math.max(0, (time - a.time) / duration));
  const [x1, y1, x2, y2] = segmentControlPoints(
    a.outType, a.easeOut, b.inType, b.easeIn, duration, valueDelta(a.value, b.value),
  );
  return cubicBezierEase(x, x1, y1, x2, y2);
}

/** Interpolate between two adjacent keyframes at an absolute comp time. */
export function interpolateKeyframes<T extends PropertyValue>(
  a: Keyframe<T>,
  b: Keyframe<T>,
  time: number,
): T {
  if (a.outType === 'hold') return a.value;
  if (b.time - a.time <= 0) return b.value;
  return lerpValue(a.value, b.value, segmentProgress(a, b, time));
}

/**
 * Value of a keyframe track at a time. Times before the first or after the
 * last keyframe hold that keyframe's value, as After Effects does.
 */
export function evaluateKeyframes<T extends PropertyValue>(
  keyframes: Keyframe<T>[],
  time: number,
): T | undefined {
  if (keyframes.length === 0) return undefined;
  if (keyframes.length === 1) return keyframes[0].value;
  if (time <= keyframes[0].time) return keyframes[0].value;
  const last = keyframes[keyframes.length - 1];
  if (time >= last.time) return last.value;

  const index = upperBound(keyframes, time) - 1;
  return interpolateKeyframes(keyframes[index], keyframes[index + 1], time);
}

/** Index of the first keyframe strictly after `time` (binary search). */
export function upperBound<T extends PropertyValue>(
  keyframes: Keyframe<T>[],
  time: number,
): number {
  let lo = 0;
  let hi = keyframes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid].time <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Convert a standard CSS-style cubic-bezier easing, (0,0)->(1,1) with control
 * points (x1,y1) and (x2,y2), into the influence/speed handles a segment needs
 * to reproduce it. This is what makes an easing preset library possible: a
 * preset is just a curve, and this is how it lands on two keyframes.
 */
export function easeFromCubicBezier(
  x1: number, y1: number, x2: number, y2: number,
  duration: number,
  delta: number,
): { easeOut: Ease; easeIn: Ease } {
  const influenceOut = clampInfluencePercent(x1 * 100);
  const influenceIn = clampInfluencePercent((1 - x2) * 100);

  // Normalized slope of each handle, converted back into value units/second.
  const scale = duration === 0 ? 0 : delta / duration;
  const slopeOut = x1 === 0 ? 0 : y1 / x1;
  const slopeIn = x2 === 1 ? 0 : (1 - y2) / (1 - x2);

  return {
    easeOut: { influence: influenceOut, speed: slopeOut * scale },
    easeIn: { influence: influenceIn, speed: slopeIn * scale },
  };
}

/** The inverse of {@link easeFromCubicBezier}, for display and editing. */
export function cubicBezierFromSegment(
  a: Keyframe,
  b: Keyframe,
): [number, number, number, number] {
  const duration = b.time - a.time;
  const delta = valueDelta(a.value, b.value);
  return segmentControlPoints(a.outType, a.easeOut, b.inType, b.easeIn, duration, delta);
}

/**
 * Auto Bezier tangent speed: the slope of the line through the neighbouring
 * keyframes, which is what makes the curve pass smoothly through this one.
 * End keyframes flatten to zero, as they do in After Effects.
 */
export function autoTangentSpeed(
  previous: Keyframe | undefined,
  current: Keyframe,
  next: Keyframe | undefined,
): number {
  if (!previous || !next) return 0;
  const span = next.time - previous.time;
  if (span <= 0) return 0;
  const rise = signedDelta(previous.value, next.value, current.value);
  return rise / span;
}

/**
 * Signed change from `from` to `to`. Vectors have no sign, so their magnitude
 * is signed by which side of `pivot` the motion is heading.
 */
function signedDelta(from: PropertyValue, to: PropertyValue, pivot: PropertyValue): number {
  if (typeof from === 'number' && typeof to === 'number') return to - from;
  const magnitude = valueDelta(from, to);
  const toPivot = valueDelta(from, pivot);
  return toPivot >= 0 ? magnitude : -magnitude;
}

/**
 * Re-apply a keyframe's tangent mode after an edit. Auto keyframes recompute
 * both handles; continuous keyframes mirror the speed that was just changed.
 */
export function enforceTangentMode(
  keyframes: Keyframe[],
  index: number,
  changedSide: 'in' | 'out' | 'both' = 'both',
): void {
  const kf = keyframes[index];
  if (!kf) return;
  const mode: TangentMode = kf.tangentMode ?? 'independent';
  if (mode === 'independent') return;

  if (mode === 'auto') {
    const speed = autoTangentSpeed(keyframes[index - 1], kf, keyframes[index + 1]);
    kf.easeIn = { influence: kf.easeIn.influence, speed };
    kf.easeOut = { influence: kf.easeOut.influence, speed };
    if (kf.inType !== 'hold') kf.inType = 'bezier';
    if (kf.outType !== 'hold') kf.outType = 'bezier';
    return;
  }

  // Continuous: the two handles stay collinear, so they share one speed.
  if (changedSide === 'out') kf.easeIn = { ...kf.easeIn, speed: kf.easeOut.speed };
  else if (changedSide === 'in') kf.easeOut = { ...kf.easeOut, speed: kf.easeIn.speed };
  else kf.easeIn = { ...kf.easeIn, speed: kf.easeOut.speed };
}

/** Apply Easy Ease to one or both sides of a keyframe, in place. */
export function applyEasyEase(
  kf: Keyframe,
  side: 'in' | 'out' | 'both' = 'both',
): void {
  if (side === 'in' || side === 'both') {
    kf.inType = 'bezier';
    kf.easeIn = { influence: EASY_EASE_INFLUENCE, speed: 0 };
  }
  if (side === 'out' || side === 'both') {
    kf.outType = 'bezier';
    kf.easeOut = { influence: EASY_EASE_INFLUENCE, speed: 0 };
  }
  // Easy Ease flattens both handles, which is a continuous tangent.
  if (side === 'both' && kf.tangentMode === 'auto') kf.tangentMode = 'continuous';
}
