import { useEffect, useRef } from 'react';
import { splineAt } from '@/render/effects/pixels';

interface Props {
  /** Five output levels, 0..255, at evenly spaced inputs. */
  points: number[];
  onChange: (points: number[], phase: 'drag' | 'commit') => void;
}

const SIZE = 132;
const PAD = 8;

/**
 * The Curves control: drag the five points, or type them in the rows below.
 * The plotted line is the same spline the effect samples, so what you see is
 * what the pixels get.
 */
export function CurveControl({ points, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef<number | null>(null);
  const plot = SIZE - PAD * 2;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.strokeStyle = '#333';
    ctx.strokeRect(PAD + 0.5, PAD + 0.5, plot, plot);
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(PAD, PAD + plot);
    ctx.lineTo(PAD + plot, PAD);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = '#6fa8ff';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i <= 64; i += 1) {
      const t = i / 64;
      const x = PAD + t * plot;
      const y = PAD + (1 - Math.min(1, Math.max(0, splineAt(points, t) / 255))) * plot;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    points.forEach((value, i) => {
      const x = PAD + (i / (points.length - 1)) * plot;
      const y = PAD + (1 - Math.min(1, Math.max(0, value / 255))) * plot;
      ctx.fillStyle = '#ffd24a';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [points, plot]);

  const pointAt = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const index = Math.round(((x - PAD) / plot) * (points.length - 1));
    return {
      index: Math.min(points.length - 1, Math.max(0, index)),
      value: Math.min(255, Math.max(0, (1 - (y - PAD) / plot) * 255)),
    };
  };

  return (
    <canvas
      ref={canvasRef}
      className="curve-control"
      style={{ width: SIZE, height: SIZE }}
      onPointerDown={(e) => {
        const { index, value } = pointAt(e.clientX, e.clientY);
        dragging.current = index;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const next = [...points];
        next[index] = value;
        onChange(next, 'drag');
      }}
      onPointerMove={(e) => {
        if (dragging.current === null) return;
        const { value } = pointAt(e.clientX, e.clientY);
        const next = [...points];
        next[dragging.current] = value;
        onChange(next, 'drag');
      }}
      onPointerUp={(e) => {
        if (dragging.current !== null) onChange(points, 'commit');
        dragging.current = null;
        (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      }}
    />
  );
}
