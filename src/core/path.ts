import type { Vec2 } from './types';

/**
 * Bezier paths.
 *
 * One shape is a list of vertices, each carrying tangent handles expressed
 * relative to its own point — the same layout After Effects uses for mask
 * paths and shape paths, and the reason a path can be keyframed by
 * interpolating vertices pairwise.
 */

export interface PathVertex {
  point: Vec2;
  /** Incoming tangent handle, relative to `point`. */
  inTangent: Vec2;
  /** Outgoing tangent handle, relative to `point`. */
  outTangent: Vec2;
}

export interface BezierPath {
  vertices: PathVertex[];
  closed: boolean;
}

/** Circle approximation constant: (4/3)·tan(π/8). */
const KAPPA = 0.5522847498307936;
const FLATTEN_STEPS = 16;

export function vertex(point: Vec2, inTangent: Vec2 = [0, 0], outTangent: Vec2 = [0, 0]): PathVertex {
  return { point, inTangent, outTangent };
}

export function emptyPath(): BezierPath {
  return { vertices: [], closed: false };
}

export function isBezierPath(value: unknown): value is BezierPath {
  return typeof value === 'object' && value !== null && Array.isArray((value as BezierPath).vertices);
}

export function clonePath(path: BezierPath): BezierPath {
  return {
    closed: path.closed,
    vertices: path.vertices.map((v) => ({
      point: [v.point[0], v.point[1]],
      inTangent: [v.inTangent[0], v.inTangent[1]],
      outTangent: [v.outTangent[0], v.outTangent[1]],
    })),
  };
}

// -- primitives ------------------------------------------------------------

export function rectPath(
  centre: Vec2, size: Vec2, roundness = 0,
): BezierPath {
  const hw = size[0] / 2;
  const hh = size[1] / 2;
  const r = Math.min(roundness, hw, hh);
  const [cx, cy] = centre;

  if (r <= 0) {
    return {
      closed: true,
      vertices: [
        vertex([cx + hw, cy - hh]),
        vertex([cx + hw, cy + hh]),
        vertex([cx - hw, cy + hh]),
        vertex([cx - hw, cy - hh]),
      ],
    };
  }

  const k = r * KAPPA;
  return {
    closed: true,
    vertices: [
      // Each rounded corner becomes two vertices with one curved side.
      vertex([cx + hw - r, cy - hh], [0, 0], [r - k, 0]),
      vertex([cx + hw, cy - hh + r], [0, -(r - k)], [0, 0]),
      vertex([cx + hw, cy + hh - r], [0, 0], [0, r - k]),
      vertex([cx + hw - r, cy + hh], [r - k, 0], [0, 0]),
      vertex([cx - hw + r, cy + hh], [0, 0], [-(r - k), 0]),
      vertex([cx - hw, cy + hh - r], [0, r - k], [0, 0]),
      vertex([cx - hw, cy - hh + r], [0, 0], [0, -(r - k)]),
      vertex([cx - hw + r, cy - hh], [-(r - k), 0], [0, 0]),
    ],
  };
}

export function ellipsePath(centre: Vec2, size: Vec2): BezierPath {
  const rx = size[0] / 2;
  const ry = size[1] / 2;
  const [cx, cy] = centre;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return {
    closed: true,
    vertices: [
      vertex([cx, cy - ry], [-kx, 0], [kx, 0]),
      vertex([cx + rx, cy], [0, -ky], [0, ky]),
      vertex([cx, cy + ry], [kx, 0], [-kx, 0]),
      vertex([cx - rx, cy], [0, ky], [0, -ky]),
    ],
  };
}

export function starPath(
  centre: Vec2,
  points: number,
  outerRadius: number,
  innerRadius: number,
  rotation = 0,
  star = true,
): BezierPath {
  const count = Math.max(3, Math.round(points));
  const vertices: PathVertex[] = [];
  const total = star ? count * 2 : count;
  for (let i = 0; i < total; i += 1) {
    const radius = !star || i % 2 === 0 ? outerRadius : innerRadius;
    const angle = ((i / total) * 360 + rotation - 90) * (Math.PI / 180);
    vertices.push(vertex([
      centre[0] + Math.cos(angle) * radius,
      centre[1] + Math.sin(angle) * radius,
    ]));
  }
  return { vertices, closed: true };
}

/** Map a path through an affine matrix, tangents included. */
export function transformPath(
  path: BezierPath,
  m: { a: number; b: number; c: number; d: number; e: number; f: number },
): BezierPath {
  const point = (p: Vec2): Vec2 => [
    m.a * p[0] + m.c * p[1] + m.e,
    m.b * p[0] + m.d * p[1] + m.f,
  ];
  // Tangents are directions, so they pick up no translation.
  const direction = (p: Vec2): Vec2 => [
    m.a * p[0] + m.c * p[1],
    m.b * p[0] + m.d * p[1],
  ];
  return {
    closed: path.closed,
    vertices: path.vertices.map((v) => ({
      point: point(v.point),
      inTangent: direction(v.inTangent),
      outTangent: direction(v.outTangent),
    })),
  };
}

// -- geometry --------------------------------------------------------------

export interface CubicSegment {
  p0: Vec2; p1: Vec2; p2: Vec2; p3: Vec2;
}

/** The cubic segments that make up a path, in order. */
export function pathSegments(path: BezierPath): CubicSegment[] {
  const { vertices, closed } = path;
  const segments: CubicSegment[] = [];
  const last = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < last; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    segments.push({
      p0: a.point,
      p1: [a.point[0] + a.outTangent[0], a.point[1] + a.outTangent[1]],
      p2: [b.point[0] + b.inTangent[0], b.point[1] + b.inTangent[1]],
      p3: b.point,
    });
  }
  return segments;
}

export function cubicAt(segment: CubicSegment, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  const { p0, p1, p2, p3 } = segment;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

/** de Casteljau split; returns the two halves of the segment. */
export function splitCubic(segment: CubicSegment, t: number): [CubicSegment, CubicSegment] {
  const lerp = (a: Vec2, b: Vec2): Vec2 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
  ];
  const { p0, p1, p2, p3 } = segment;
  const a = lerp(p0, p1);
  const b = lerp(p1, p2);
  const c = lerp(p2, p3);
  const d = lerp(a, b);
  const e = lerp(b, c);
  const f = lerp(d, e);
  return [
    { p0, p1: a, p2: d, p3: f },
    { p0: f, p1: e, p2: c, p3 },
  ];
}

export function segmentLength(segment: CubicSegment, steps = FLATTEN_STEPS): number {
  let length = 0;
  let previous = segment.p0;
  for (let i = 1; i <= steps; i += 1) {
    const point = cubicAt(segment, i / steps);
    length += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    previous = point;
  }
  return length;
}

export function pathLength(path: BezierPath): number {
  return pathSegments(path).reduce((sum, s) => sum + segmentLength(s), 0);
}

export function flattenPath(path: BezierPath, stepsPerSegment = FLATTEN_STEPS): Vec2[] {
  const points: Vec2[] = [];
  const segments = pathSegments(path);
  if (segments.length === 0) return path.vertices.map((v) => v.point);
  points.push(segments[0].p0);
  for (const segment of segments) {
    for (let i = 1; i <= stepsPerSegment; i += 1) {
      points.push(cubicAt(segment, i / stepsPerSegment));
    }
  }
  return points;
}

export function pathBounds(path: BezierPath): { x: number; y: number; width: number; height: number } {
  const points = flattenPath(path, 8);
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Even-odd containment test against the flattened outline. */
export function pathContains(path: BezierPath, point: Vec2): boolean {
  const points = flattenPath(path, 10);
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersects = (yi > point[1]) !== (yj > point[1])
      && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// -- animation -------------------------------------------------------------

/**
 * Blend two paths vertex by vertex. Paths with different vertex counts cannot
 * be blended meaningfully, so the earlier shape is held until the end of the
 * segment — the same thing After Effects does when a keyframed mask gains or
 * loses a vertex.
 */
export function interpolatePaths(a: BezierPath, b: BezierPath, t: number): BezierPath {
  if (a.vertices.length !== b.vertices.length || a.closed !== b.closed) {
    return t >= 1 ? clonePath(b) : clonePath(a);
  }
  return {
    closed: a.closed,
    vertices: a.vertices.map((va, i) => {
      const vb = b.vertices[i];
      const mix = (p: Vec2, q: Vec2): Vec2 => [
        p[0] + (q[0] - p[0]) * t,
        p[1] + (q[1] - p[1]) * t,
      ];
      return {
        point: mix(va.point, vb.point),
        inTangent: mix(va.inTangent, vb.inTangent),
        outTangent: mix(va.outTangent, vb.outTangent),
      };
    }),
  };
}

/** Total vertex travel between two paths, used as the segment's speed scale. */
export function pathDelta(a: BezierPath, b: BezierPath): number {
  if (a.vertices.length !== b.vertices.length) return 1;
  let sum = 0;
  for (let i = 0; i < a.vertices.length; i += 1) {
    sum += Math.hypot(
      b.vertices[i].point[0] - a.vertices[i].point[0],
      b.vertices[i].point[1] - a.vertices[i].point[1],
    );
  }
  return sum;
}

// -- modifiers -------------------------------------------------------------

/**
 * Trim Paths: keep the part of the outline between two fractions of its
 * length. Returns an open path, or the original when nothing is trimmed.
 */
export function trimPath(path: BezierPath, start: number, end: number, offset = 0): BezierPath {
  const segments = pathSegments(path);
  if (segments.length === 0) return clonePath(path);

  let from = start + offset;
  let to = end + offset;
  if (to < from) [from, to] = [to, from];
  if (to - from >= 1) return clonePath(path);

  // Wrapping past the end of a closed path yields two runs.
  const runs: [number, number][] = [];
  const wrap = (v: number) => v - Math.floor(v);
  if (Math.floor(from) !== Math.floor(to) && path.closed) {
    runs.push([wrap(from), 1], [0, wrap(to)]);
  } else {
    runs.push([wrap(from), wrap(from) + (to - from)]);
  }

  const lengths = segments.map((s) => segmentLength(s));
  const total = lengths.reduce((sum, l) => sum + l, 0);
  if (total <= 0) return clonePath(path);

  const vertices: PathVertex[] = [];
  for (const [runStart, runEnd] of runs) {
    const kept = sliceSegments(segments, lengths, total * runStart, total * Math.min(1, runEnd));
    appendSegments(vertices, kept);
  }
  return { vertices, closed: false };
}

function sliceSegments(
  segments: CubicSegment[],
  lengths: number[],
  fromLength: number,
  toLength: number,
): CubicSegment[] {
  const kept: CubicSegment[] = [];
  let travelled = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const length = lengths[i];
    const segStart = travelled;
    const segEnd = travelled + length;
    travelled = segEnd;
    if (segEnd <= fromLength || segStart >= toLength || length <= 0) continue;

    let segment = segments[i];
    if (segStart < fromLength) {
      segment = splitCubic(segment, (fromLength - segStart) / length)[1];
    }
    if (segEnd > toLength) {
      const consumed = Math.max(fromLength, segStart);
      const remaining = segEnd - consumed;
      const t = remaining <= 0 ? 1 : (toLength - consumed) / remaining;
      segment = splitCubic(segment, Math.min(1, Math.max(0, t)))[0];
    }
    kept.push(segment);
  }
  return kept;
}

function appendSegments(vertices: PathVertex[], segments: CubicSegment[]): void {
  for (const segment of segments) {
    const last = vertices[vertices.length - 1];
    if (!last || last.point[0] !== segment.p0[0] || last.point[1] !== segment.p0[1]) {
      vertices.push(vertex(segment.p0, [0, 0], [
        segment.p1[0] - segment.p0[0], segment.p1[1] - segment.p0[1],
      ]));
    } else {
      last.outTangent = [segment.p1[0] - segment.p0[0], segment.p1[1] - segment.p0[1]];
    }
    vertices.push(vertex(segment.p3, [
      segment.p2[0] - segment.p3[0], segment.p2[1] - segment.p3[1],
    ]));
  }
}

/**
 * Offset Paths: push every point along its outward normal.
 *
 * This is the flattened-polyline approximation — good for the gentle offsets
 * shape layers usually want, and honest about not being a true Minkowski
 * offset, which would need self-intersection removal.
 */
export function offsetPath(path: BezierPath, amount: number): BezierPath {
  if (amount === 0 || path.vertices.length < 2) return clonePath(path);
  const points = flattenPath(path, 8);
  const count = path.closed ? points.length - 1 : points.length;
  const moved: Vec2[] = [];

  for (let i = 0; i < count; i += 1) {
    const previous = points[(i - 1 + count) % count];
    const next = points[(i + 1) % count];
    const dx = next[0] - previous[0];
    const dy = next[1] - previous[1];
    const length = Math.hypot(dx, dy) || 1;
    // Outward normal of the local tangent.
    moved.push([
      points[i][0] + (dy / length) * amount,
      points[i][1] - (dx / length) * amount,
    ]);
  }

  return { vertices: moved.map((p) => vertex(p)), closed: path.closed };
}
