import { pathSegments } from '@/core/path';
import type { BezierPath } from '@/core/path';

/** Build a canvas path from a bezier path, in the current context space. */
export function tracePath(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | Path2D,
  path: BezierPath,
): void {
  const segments = pathSegments(path);
  if (segments.length === 0) {
    if (path.vertices.length === 1) {
      const [x, y] = path.vertices[0].point;
      ctx.moveTo(x, y);
    }
    return;
  }
  ctx.moveTo(segments[0].p0[0], segments[0].p0[1]);
  for (const { p1, p2, p3 } of segments) {
    ctx.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
  }
  if (path.closed) ctx.closePath();
}

export function toPath2D(paths: BezierPath[]): Path2D {
  const out = new Path2D();
  for (const path of paths) tracePath(out, path);
  return out;
}
