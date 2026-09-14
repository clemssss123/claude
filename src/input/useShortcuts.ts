import { useEffect, useRef } from 'react';
import { useEditor } from '@/state/store';
import { SHORTCUT_BY_CHORD, chordFromEvent, runShortcut } from './shortcuts';

/** Two presses of the same letter within this window make a UU/MM/EE chord. */
const DOUBLE_TAP_MS = 400;

function unavailableMessage(shortcut: { label: string; note?: string; phase?: number }): string {
  if (shortcut.note) return `${shortcut.label} — ${shortcut.note}.`;
  return `${shortcut.label} arrives in phase ${shortcut.phase ?? '?'}.`;
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

export function useShortcuts(): void {
  const lastKey = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat) return;
      const chord = chordFromEvent(event);
      const inText = isTextEntry(event.target);

      // Double-tap letters (U -> UU, M -> MM, E -> EE) take priority.
      const bare = /^[a-z]$/.test(chord);
      if (bare && !inText) {
        const previous = lastKey.current;
        const now = performance.now();
        if (previous && previous.key === chord && now - previous.at < DOUBLE_TAP_MS) {
          const doubled = SHORTCUT_BY_CHORD.get(chord + chord);
          if (doubled) {
            lastKey.current = null;
            event.preventDefault();
            if (!runShortcut(doubled)) {
              useEditor.getState().setStatus(unavailableMessage(doubled));
            }
            return;
          }
        }
        lastKey.current = { key: chord, at: now };
      }

      const shortcut = SHORTCUT_BY_CHORD.get(chord);
      if (!shortcut) return;
      if (inText && !shortcut.allowInInput) return;

      event.preventDefault();
      if (!runShortcut(shortcut)) {
        useEditor.getState().setStatus(unavailableMessage(shortcut));
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
