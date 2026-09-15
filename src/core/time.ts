/** Conversions between comp time (seconds) and frames, plus display formatting. */

export function timeToFrame(time: number, frameRate: number): number {
  return time * frameRate;
}

export function frameToTime(frame: number, frameRate: number): number {
  return frame / frameRate;
}

/** Snap a time to the nearest whole frame. */
export function snapToFrame(time: number, frameRate: number): number {
  return Math.round(time * frameRate) / frameRate;
}

export function floorToFrame(time: number, frameRate: number): number {
  return Math.floor(time * frameRate + 1e-6) / frameRate;
}

/** "0:00:04:12" — the timecode format After Effects shows by default. */
export function formatTimecode(time: number, frameRate: number): string {
  const totalFrames = Math.round(time * frameRate);
  const fps = Math.round(frameRate);
  const sign = totalFrames < 0 ? '-' : '';
  const abs = Math.abs(totalFrames);
  const frames = abs % fps;
  const totalSeconds = Math.floor(abs / fps);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (v: number) => v.toString().padStart(2, '0');
  return `${sign}${hours}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
}

/** Frame number display, used when the timeline is in frames mode. */
export function formatFrames(time: number, frameRate: number): string {
  return Math.round(time * frameRate).toString();
}

/** Parse "0:00:04:12", "4:12" or a bare frame count into seconds. */
export function parseTimecode(input: string, frameRate: number): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const negative = trimmed.startsWith('-');
  const parts = trimmed.replace('-', '').split(':').map((p) => Number(p));
  if (parts.some((p) => Number.isNaN(p))) return null;
  const fps = Math.round(frameRate);
  let frames = 0;
  if (parts.length === 1) {
    frames = parts[0];
  } else {
    const [h, m, s, f] = [0, 0, 0, 0].map((_, i) => parts[parts.length - 4 + i] ?? 0);
    frames = ((h * 60 + m) * 60 + s) * fps + f;
  }
  const time = frames / frameRate;
  return negative ? -time : time;
}

export interface PlaybackStep {
  /** Where the playhead lands, before any frame snapping. */
  time: number;
  /** False once a non-looping playback has run past the end. */
  playing: boolean;
}

/**
 * Advance the playback clock by one display frame.
 *
 * The clock has to be kept separately from the playhead, in seconds, because
 * the playhead is snapped to the composition's frame grid. Accumulating on
 * top of the snapped value looks harmless and is not: on a 120 Hz display a
 * tick is a quarter of a 30 fps frame, the snap rounds it straight back to
 * the frame it came from, and the playhead never moves at all — the transport
 * sits there saying it is playing. At exactly 60 Hz the same rounding lands
 * on a half and plays at double speed. Only the unsnapped clock is safe to
 * add to.
 */
export function advancePlayback(
  clock: number,
  delta: number,
  range: { start: number; end: number; loop: boolean },
): PlaybackStep {
  const span = Math.max(1e-6, range.end - range.start);
  let next = clock + delta;

  if (next >= range.end) {
    if (!range.loop) return { time: range.end, playing: false };
    next = range.start + ((next - range.start) % span);
  }
  if (next < range.start) next = range.start;
  return { time: next, playing: true };
}
