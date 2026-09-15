import { describe, expect, it } from 'vitest';
import {
  fbm, gradientNoise, hashNoise, latticeNoise, smoothNoise1D,
} from '@/render/effects/pixels';

/**
 * The noise underneath the fractal effects and the shake. These are the
 * properties the look depends on: no structure where there should be none,
 * and continuity where the eye would see a corner.
 */

describe('hashNoise', () => {
  it('spreads evenly over 0..1', () => {
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 10_000; i += 1) {
      buckets[Math.min(9, Math.floor(hashNoise(i, (i * 7) % 313, (i * 13) % 97) * 10))] += 1;
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(800);
      expect(count).toBeLessThan(1200);
    }
  });

  it('does not ramp near the origin', () => {
    // The sine hash this replaced climbed 0.00, 0.04, 0.13, 0.24 along the
    // first few integers with the other inputs at zero, which put a drift
    // into every effect that seeded from there.
    const first = Array.from({ length: 8 }, (_, i) => hashNoise(i, 0, 0));
    const rising = first.every((value, i) => i === 0 || value > first[i - 1]);
    expect(rising).toBe(false);
    expect(Math.max(...first)).toBeGreaterThan(0.6);
    expect(Math.min(...first)).toBeLessThan(0.4);
  });

  it('gives the same answer for the same inputs', () => {
    expect(hashNoise(12, 7, 3)).toBe(hashNoise(12, 7, 3));
    expect(hashNoise(12, 7, 3)).not.toBe(hashNoise(12, 7, 4));
  });
});

describe('smoothNoise1D', () => {
  it('is continuous across lattice points', () => {
    // Shake is judged by its motion, so a step here would read as a tick.
    let biggest = 0;
    for (let t = 0; t < 40; t += 0.01) {
      biggest = Math.max(biggest, Math.abs(smoothNoise1D(t + 0.01, 0, 0) - smoothNoise1D(t, 0, 0)));
    }
    expect(biggest).toBeLessThan(0.15);
  });

  it('actually moves, and differs per channel', () => {
    const samples = Array.from({ length: 40 }, (_, i) => smoothNoise1D(i * 0.37, 0, 0));
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.8);
    expect(smoothNoise1D(3.2, 0, 0)).not.toBeCloseTo(smoothNoise1D(3.2, 1, 0), 3);
  });

  it('stays within about ±1', () => {
    for (let t = 0; t < 60; t += 0.13) {
      expect(Math.abs(smoothNoise1D(t, 2, 5))).toBeLessThan(1.4);
    }
  });
});

describe('lattice and gradient noise', () => {
  it('holds a block interpolation flat within a cell', () => {
    const a = latticeNoise(4.1, 2.2, 0, 'block');
    const b = latticeNoise(4.9, 2.8, 0, 'block');
    expect(a).toBe(b);
    expect(latticeNoise(4.1, 2.2, 0, 'spline')).not.toBe(latticeNoise(4.9, 2.8, 0, 'spline'));
  });

  it('keeps gradient noise inside 0..1 and off the lattice', () => {
    let onLattice = 0;
    for (let i = 0; i < 200; i += 1) {
      const value = gradientNoise(i * 1.7, i * 0.3, 0);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      if (Math.abs(gradientNoise(i, i, 0) - 0.5) < 1e-9) onLattice += 1;
    }
    // Gradient noise is exactly 0.5 at every lattice point; that is the
    // definition, and it is why its features land between them.
    expect(onLattice).toBeGreaterThan(190);
  });
});

describe('fbm', () => {
  it('reduces to one octave when the gain is zero', () => {
    const one = fbm(1.3, 2.4, 0, 1, { kind: 'value' });
    const many = fbm(1.3, 2.4, 0, 5, { gain: 0, kind: 'value' });
    expect(many).toBeCloseTo(one, 6);
  });

  it('adds detail as octaves are added', () => {
    const roughness = (octaves: number) => {
      let sum = 0;
      for (let x = 0; x < 200; x += 1) {
        sum += Math.abs(fbm(x * 0.05, 0, 0, octaves) - fbm((x + 1) * 0.05, 0, 0, octaves));
      }
      return sum;
    };
    expect(roughness(6)).toBeGreaterThan(roughness(1));
  });

  it('stays in range for every fractal shape', () => {
    for (const fractal of ['smooth', 'turbulent', 'ridged'] as const) {
      for (let i = 0; i < 100; i += 1) {
        const value = fbm(i * 0.31, i * 0.17, 0, 4, { fractal });
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});
