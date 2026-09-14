import { useCallback, useRef } from 'react';

interface Props {
  orientation: 'vertical' | 'horizontal';
  onDrag: (delta: number) => void;
}

/** Thin draggable divider. Reports pixel deltas; the parent owns the sizes. */
export function Splitter({ orientation, onDrag }: Props) {
  const last = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    last.current = orientation === 'vertical' ? e.clientX : e.clientY;
  }, [orientation]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!(e.target as HTMLElement).hasPointerCapture?.(e.pointerId)) return;
    const current = orientation === 'vertical' ? e.clientX : e.clientY;
    onDrag(current - last.current);
    last.current = current;
  }, [orientation, onDrag]);

  return (
    <div
      className={orientation === 'vertical' ? 'splitter-v' : 'splitter-h'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
    />
  );
}
