import type { Vec2 } from './types';

/**
 * 2D affine transform, laid out like the canvas 2D context:
 * [a c e]
 * [b d f]
 * [0 0 1]
 */
export interface Matrix {
  a: number; b: number; c: number; d: number; e: number; f: number;
}

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function multiply(m: Matrix, n: Matrix): Matrix {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

export function translation(x: number, y: number): Matrix {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

export function scaling(x: number, y: number): Matrix {
  return { a: x, b: 0, c: 0, d: y, e: 0, f: 0 };
}

export function rotation(degrees: number): Matrix {
  const r = (degrees * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

export function applyToPoint(m: Matrix, p: Vec2): Vec2 {
  return [m.a * p[0] + m.c * p[1] + m.e, m.b * p[0] + m.d * p[1] + m.f];
}

/** Transform a direction, ignoring translation. */
export function applyToVector(m: Matrix, p: Vec2): Vec2 {
  return [m.a * p[0] + m.c * p[1], m.b * p[0] + m.d * p[1]];
}

export function determinant(m: Matrix): number {
  return m.a * m.d - m.b * m.c;
}

export function invert(m: Matrix): Matrix {
  const det = determinant(m);
  if (Math.abs(det) < 1e-12) return { ...IDENTITY };
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

export function toArray(m: Matrix): [number, number, number, number, number, number] {
  return [m.a, m.b, m.c, m.d, m.e, m.f];
}
