import { segmentProgress, upperBound } from './interpolation';
import { valueAtTime } from './property';
import type { Keyframe, Property, Vec2 } from './types';

/**
 * Motion paths.
 *
 * A positional property has two independent interpolations: the temporal one
 * (how fast it moves, edited in the graph editor) and the spatial one (the
 * shape of the path through the composition, edited on the motion path in the
 * viewer). This module owns the spatial half.
 *
 * Progress along a segment comes from the temporal curve, and is converted to
 * a curve parameter by arc length, so an eased path still moves at the speed
 * the speed graph says it does.
 */

/** Samples used to build the arc-length table for one segment. */
const ARC_SAMPLES = 32;
/** Catmull-Rom tangents scale by a sixth of the span between neighbours. */
const AUTO_TANGENT_SCALE = 1 / 6;

function add(a: Vec2, b: Vec2): Vec2 { return [a[0] + b[0], a[1] + b[1]]; }
function sub(a: Vec2, b: Vec2): Vec2 { return [a[0] - b[0], a[1] - b[1]]; }
function scale(a: Vec2, k: number): Vec2 { return [a[0] * k, a[1] * k]; }

/**
 * Outgoing tangent of keyframe `index`, honouring its spatial type.
 * Auto keyframes derive a smooth tangent from their neighbours; end keyframes
 * flatten, which is why a two-keyframe move is a straight line.
 */
export function spatialOutTangent(keyframes: Keyframe<Vec2>[], index: number): Vec2 {
  const kf = keyframes[index];
  if (!kf) return [0, 0];
  if (kf.spatialType === 'bezier') return kf.spatialOut ?? [0, 0];
  if (kf.spatialType === 'linear') return [0, 0];

  const previous = keyframes[index - 1];
  const next = keyframes[index + 1];
  if (!previous || !next) return [0, 0];
  return scale(sub(next.value, previous.value), AUTO_TANGENT_SCALE);
}

/** Incoming tangent of keyframe `index`. */
export function spatialInTangent(keyframes: Keyframe<Vec2>[], index: number): Vec2 {
  const kf = keyframes[index];
  if (!kf) return [0, 0];
  if (kf.spatialType === 'bezier') return kf.spatialIn ?? [0, 0];
  if (kf.spatialType === 'linear') return [0, 0];

  const previous = keyframes[index - 1];
  const next = keyframes[index + 1];
  if (!previous || !next) return [0, 0];
  return scale(sub(previous.value, next.value), AUTO_TANGENT_SCALE);
}

/** The four control points of the path between two keyframes. */
export function segmentControlPointsSpatial(
  keyframes: Keyframe<Vec2>[],
  index: number,
): [Vec2, Vec2, Vec2, Vec2] {
  const a = keyframes[index];
  const b = keyframes[index + 1];
  return [
    a.value,
    add(a.value, spatialOutTangent(keyframes, index)),
    add(b.value, spatialInTangent(keyframes, index + 1)),
    b.value,
  ];
}

export function cubicPoint(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

function isStraight(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2): boolean {
  return p1[0] === p0[0] && p1[1] === p0[1] && p2[0] === p3[0] && p2[1] === p3[1];
}

/**
 * Curve parameter at a given fraction of the segment's arc length. Without
 * this a curved path would speed up through the straight parts and crawl
 * around the corners, because bezier parameter is not distance.
 */
function tAtArcFraction(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, fraction: number): number {
  if (fraction <= 0) return 0;
  if (fraction >= 1) return 1;

  const lengths: number[] = [0];
  let previous = p0;
  for (let i = 1; i <= ARC_SAMPLES; i += 1) {
    const point = cubicPoint(p0, p1, p2, p3, i / ARC_SAMPLES);
    const dx = point[0] - previous[0];
    const dy = point[1] - previous[1];
    lengths.push(lengths[i - 1] + Math.hypot(dx, dy));
    previous = point;
  }

  const total = lengths[ARC_SAMPLES];
  if (total <= 0) return fraction;

  const target = total * fraction;
  for (let i = 1; i <= ARC_SAMPLES; i += 1) {
    if (lengths[i] >= target) {
      const span = lengths[i] - lengths[i - 1];
      const local = span === 0 ? 0 : (target - lengths[i - 1]) / span;
      return (i - 1 + local) / ARC_SAMPLES;
    }
  }
  return 1;
}

/**
 * Value of a positional property at a time, following its motion path.
 * Falls back to plain interpolation for straight segments and for properties
 * that are not spatial.
 */
export function positionAtTime(prop: Property<Vec2>, time: number): Vec2 {
  if (!prop.spatial || prop.separated || !prop.animated || prop.keyframes.length < 2) {
    return valueAtTime(prop, time);
  }
  const kfs = prop.keyframes;
  if (time <= kfs[0].time) return kfs[0].value;
  if (time >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value;

  const index = upperBound(kfs, time) - 1;
  const a = kfs[index];
  const b = kfs[index + 1];
  if (a.outType === 'hold') return a.value;

  const [p0, p1, p2, p3] = segmentControlPointsSpatial(kfs, index);
  const progress = segmentProgress(a, b, time);
  if (isStraight(p0, p1, p2, p3)) {
    return [
      p0[0] + (p3[0] - p0[0]) * progress,
      p0[1] + (p3[1] - p0[1]) * progress,
    ];
  }
  return cubicPoint(p0, p1, p2, p3, tAtArcFraction(p0, p1, p2, p3, progress));
}

/** Polyline approximation of the whole motion path, for drawing. */
export function motionPathPoints(prop: Property<Vec2>, samplesPerSegment = 24): Vec2[] {
  const kfs = prop.keyframes;
  if (!prop.animated || kfs.length < 2) return [];
  const points: Vec2[] = [kfs[0].value];
  for (let i = 0; i < kfs.length - 1; i += 1) {
    const [p0, p1, p2, p3] = segmentControlPointsSpatial(kfs, i);
    for (let s = 1; s <= samplesPerSegment; s += 1) {
      points.push(cubicPoint(p0, p1, p2, p3, s / samplesPerSegment));
    }
  }
  return points;
}
