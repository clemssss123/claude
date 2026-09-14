import { useEffect, useRef } from 'react';
import { activeComposition } from '@/core/project';
import { useEditor } from './store';

/**
 * Real-time transport. Playback advances by wall-clock time so it stays
 * honest about dropped frames rather than slowing down, and loops over the
 * work area the way a RAM preview does.
 */
export function usePlayback(): void {
  const playing = useEditor((s) => s.playing);
  const frame = useRef(0);

  useEffect(() => {
    if (!playing) return undefined;

    let last = performance.now();
    const tick = (now: number) => {
      const state = useEditor.getState();
      const comp = activeComposition(state.project);
      if (!comp) return;

      const delta = Math.min(0.25, (now - last) / 1000);
      last = now;

      const start = comp.workAreaStart;
      const end = Math.max(start + 1 / comp.frameRate, comp.workAreaEnd);
      let next = state.time + delta;
      if (next >= end) {
        next = state.loopPlayback ? start + ((next - start) % (end - start)) : end;
        if (!state.loopPlayback) {
          state.setTime(end);
          state.setPlaying(false);
          return;
        }
      }
      if (next < start) next = start;

      state.setTime(next, true);
      frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [playing]);
}
