import { describe, expect, it } from 'vitest';
import { advancePlayback, snapToFrame } from '../time';

/**
 * The transport, at the refresh rates real screens run at.
 *
 * These are regression tests for a playhead that would not move: playback
 * used to add each display tick to the *snapped* time, so on any display
 * faster than 60 Hz the snap rounded the tick straight back to the frame it
 * came from and the composition sat still while the transport insisted it
 * was playing.
 */

const RANGE = { start: 0, end: 10, loop: true };

/** Run `seconds` of wall clock at a given display rate, as playback does. */
function play(displayHz: number, frameRate: number, seconds: number): number {
  const delta = 1 / displayHz;
  let clock = 0;
  let playhead = 0;
  for (let i = 0; i < displayHz * seconds; i += 1) {
    const step = advancePlayback(clock, delta, RANGE);
    clock = step.time;
    // What the store keeps is the snapped value; the clock is not.
    playhead = snapToFrame(step.time, frameRate);
  }
  return playhead;
}

describe('playback advances in real time', () => {
  for (const hz of [30, 60, 75, 120, 144, 165, 240]) {
    it(`runs at 1x on a ${hz} Hz display`, () => {
      const reached = play(hz, 30, 2);
      expect(reached).toBeGreaterThan(1.9);
      expect(reached).toBeLessThan(2.1);
    });
  }

  it('would have frozen if the clock were the snapped playhead', () => {
    // The old arithmetic, kept here so the bug cannot come back unnoticed.
    let playhead = 0;
    for (let i = 0; i < 120 * 2; i += 1) {
      playhead = snapToFrame(playhead + 1 / 120, 30);
    }
    expect(playhead).toBe(0);
  });
});

describe('playback range', () => {
  it('loops back into the work area', () => {
    const step = advancePlayback(9.98, 0.1, { start: 2, end: 10, loop: true });
    expect(step.playing).toBe(true);
    expect(step.time).toBeCloseTo(2.08, 5);
  });

  it('stops at the end when looping is off', () => {
    const step = advancePlayback(9.98, 0.1, { start: 0, end: 10, loop: false });
    expect(step.playing).toBe(false);
    expect(step.time).toBe(10);
  });

  it('never leaves the work area behind', () => {
    expect(advancePlayback(0, 0.016, { start: 4, end: 6, loop: true }).time).toBe(4);
  });

  it('survives a delta longer than the range', () => {
    const step = advancePlayback(0, 25, { start: 0, end: 10, loop: true });
    expect(step.time).toBeGreaterThanOrEqual(0);
    expect(step.time).toBeLessThan(10);
  });
});
