import { useEffect, useRef, useState } from 'react';

interface Props {
  value: number;
  onChange: (value: number, phase: 'drag' | 'commit') => void;
  /** Value units per pixel of horizontal drag. */
  speed?: number;
  min?: number;
  max?: number;
  unit?: string;
  precision?: number;
  title?: string;
}

const DRAG_THRESHOLD = 3;

/**
 * After Effects' scrubbable value: drag sideways to change it, click to type.
 * Shift slows the drag to a tenth, as it does in AE.
 */
export function ScrubbableNumber({
  value, onChange, speed = 1, min, max, unit = '', precision = 2, title,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; start: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const clamp = (v: number) => {
    let out = v;
    if (min !== undefined) out = Math.max(min, out);
    if (max !== undefined) out = Math.min(max, out);
    return out;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (editing) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, start: value, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const state = drag.current;
    if (!state) return;
    const dx = e.clientX - state.x;
    if (!state.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
    state.moved = true;
    const factor = e.shiftKey ? 0.1 : 1;
    onChange(clamp(state.start + dx * speed * factor), 'drag');
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const state = drag.current;
    drag.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (!state) return;
    if (state.moved) onChange(value, 'commit');
    else {
      setDraft(String(round(value, precision)));
      setEditing(true);
    }
  };

  const commitDraft = () => {
    setEditing(false);
    const parsed = Number(draft);
    if (!Number.isNaN(parsed)) onChange(clamp(parsed), 'commit');
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="scrub editing"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitDraft();
          if (e.key === 'Escape') setEditing(false);
          e.stopPropagation();
        }}
        style={{ width: 62 }}
      />
    );
  }

  return (
    <span
      className="scrub"
      title={title}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {round(value, precision)}{unit}
    </span>
  );
}

function round(v: number, precision: number): number {
  const f = 10 ** precision;
  return Math.round(v * f) / f;
}
