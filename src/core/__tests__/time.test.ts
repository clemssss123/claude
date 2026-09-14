import { describe, expect, it } from 'vitest';
import {
  formatFrames, formatTimecode, frameToTime, parseTimecode, snapToFrame, timeToFrame,
} from '../time';

describe('time', () => {
  it('converts between seconds and frames', () => {
    expect(timeToFrame(2, 30)).toBe(60);
    expect(frameToTime(60, 30)).toBe(2);
  });

  it('snaps to the nearest frame', () => {
    expect(snapToFrame(0.51, 30)).toBeCloseTo(15 / 30, 9);
    expect(snapToFrame(0.49, 30)).toBeCloseTo(15 / 30, 9);
  });

  it('formats timecode', () => {
    expect(formatTimecode(0, 30)).toBe('0:00:00:00');
    expect(formatTimecode(4.4, 30)).toBe('0:00:04:12');
    expect(formatTimecode(3671.5, 30)).toBe('1:01:11:15');
    expect(formatFrames(4.4, 30)).toBe('132');
  });

  it('parses timecode and bare frame counts', () => {
    expect(parseTimecode('0:00:04:12', 30)).toBeCloseTo(4.4, 9);
    expect(parseTimecode('4:12', 30)).toBeCloseTo(4.4, 9);
    expect(parseTimecode('132', 30)).toBeCloseTo(4.4, 9);
    expect(parseTimecode('', 30)).toBeNull();
    expect(parseTimecode('abc', 30)).toBeNull();
  });
});
