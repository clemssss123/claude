import { useEffect, useRef } from 'react';
import { activeComposition } from '@/core/project';
import { advancePlayback } from '@/core/time';
import { setFootagePlayback } from '@/render/assets';
import { useEditor } from './store';

/**
 * Real-time transport. Playback advances by wall-clock time so it stays
 * honest about dropped frames rather than slowing down, and loops over the
 * work area the way a RAM preview does.
 */
export function usePlayback(): void {
  const playing = useEditor((s) => s.playing);
  const frame = useRef(0);
  const clock = useRef(0);

  // Video layers play themselves while the composition does; see the note in
  // `setFootagePlayback`.
  useEffect(() => {
    setFootagePlayback(playing);
    return () => setFootagePlayback(false);
  }, [playing]);

  useEffect(() => {
    if (!playing) return undefined;

    // The clock runs in seconds alongside the playhead, which is snapped to
    // the frame grid; see `advancePlayback` for why the two cannot be the
    // same number.
    clock.current = useEditor.getState().time;
    let last = performance.now();
    const tick = (now: number) => {
      const state = useEditor.getState();
      const comp = activeComposition(state.project);
      if (!comp) return;

      const delta = Math.min(0.25, (now - last) / 1000);
      last = now;

      // Anything that moved the playhead from outside — a scrub, a jump to a
      // keyframe — takes the clock with it.
      if (Math.abs(state.time - clock.current) > 1 / comp.frameRate) {
        clock.current = state.time;
      }

      const start = comp.workAreaStart;
      const end = Math.max(start + 1 / comp.frameRate, comp.workAreaEnd);
      const step = advancePlayback(clock.current, delta, {
        start,
        end,
        loop: state.loopPlayback,
      });

      clock.current = step.time;
      state.setTime(step.time, true);
      if (!step.playing) {
        state.setPlaying(false);
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [playing]);
}
