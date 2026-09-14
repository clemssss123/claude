import { useEffect, useRef, useState } from 'react';
import { findLayer } from '@/core/composition';
import { cubicBezierEase } from '@/core/bezier';
import { cubicBezierFromSegment } from '@/core/interpolation';
import { activeComposition } from '@/core/project';
import { getProperty } from '@/core/layer';
import { useEditor } from '@/state/store';
import type { EasingPreset } from '@/core/easings';

type Points = [number, number, number, number];

const SIZE = 168;
const PAD = 22;

/**
 * The live cubic-bezier editor: drag the two control points, or type the
 * numbers. What you build here can be applied straight to the selected
 * keyframes or saved into the preset library.
 */
export function CurveEditor({ onClose }: { onClose: () => void }) {
  const [points, setPoints] = useState<Points>([0.33, 0, 0.67, 1]);
  const [name, setName] = useState('My Ease');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef<0 | 1 | null>(null);

  const plot = SIZE - PAD * 2;
  const toScreen = (x: number, y: number): [number, number] => (
    [PAD + x * plot, PAD + (1 - y) * plot]
  );
  const toCurve = (sx: number, sy: number): [number, number] => (
    [(sx - PAD) / plot, 1 - (sy - PAD) / plot]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);

    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.strokeStyle = '#3a3a3a';
    ctx.strokeRect(PAD + 0.5, PAD + 0.5, plot, plot);
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(...toScreen(0, 0));
    ctx.lineTo(...toScreen(1, 1));
    ctx.stroke();
    ctx.setLineDash([]);

    const [x1, y1, x2, y2] = points;

    ctx.strokeStyle = '#6fa8ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 80; i += 1) {
      const t = i / 80;
      const [sx, sy] = toScreen(t, cubicBezierEase(t, x1, y1, x2, y2));
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.stroke();

    const handles: [number, number][] = [[x1, y1], [x2, y2]];
    const anchors: [number, number][] = [[0, 0], [1, 1]];
    handles.forEach((handle, i) => {
      ctx.strokeStyle = '#7a7a7a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(...toScreen(...anchors[i]));
      ctx.lineTo(...toScreen(...handle));
      ctx.stroke();
      ctx.fillStyle = i === 0 ? '#ffd24a' : '#6ede8a';
      const [hx, hy] = toScreen(...handle);
      ctx.beginPath();
      ctx.arc(hx, hy, 5, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [points, plot]);

  const onPointerDown = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const [p1, p2] = [toScreen(points[0], points[1]), toScreen(points[2], points[3])];
    const d1 = Math.hypot(p1[0] - sx, p1[1] - sy);
    const d2 = Math.hypot(p2[0] - sx, p2[1] - sy);
    if (Math.min(d1, d2) > 14) return;
    dragging.current = d1 <= d2 ? 0 : 1;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging.current === null) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const [cx, cy] = toCurve(e.clientX - rect.left, e.clientY - rect.top);
    // X stays inside the segment so the curve remains a function of time;
    // Y is free, which is what allows overshoot.
    const x = Math.min(1, Math.max(0, cx));
    const next: Points = [...points];
    if (dragging.current === 0) { next[0] = x; next[1] = cy; }
    else { next[2] = x; next[3] = cy; }
    setPoints(next);
  };

  const readFromSelection = () => {
    const state = useEditor.getState();
    const comp = activeComposition(state.project);
    const ref = state.selectedKeyframes[0];
    if (!comp || !ref) {
      state.setStatus('Select a segment first.');
      return;
    }
    const layer = findLayer(comp, ref.layerId);
    const prop = layer && getProperty(layer, ref.path);
    if (!prop) return;
    const index = prop.keyframes.findIndex((k) => k.id === ref.kfId);
    const a = prop.keyframes[index];
    const b = prop.keyframes[index + 1] ?? prop.keyframes[index - 1];
    if (!a || !b) return;
    const [first, second] = a.time <= b.time ? [a, b] : [b, a];
    setPoints(cubicBezierFromSegment(first, second));
  };

  const apply = () => {
    useEditor.getState().applyEasingPreset({
      id: 'custom-live', name: 'Custom Curve', group: 'Custom', kind: 'bezier', points,
    });
  };

  const save = () => {
    const preset: EasingPreset = {
      id: `user_${Date.now().toString(36)}`,
      name: name.trim() || 'Custom Ease',
      group: 'Custom',
      kind: 'bezier',
      points,
    };
    useEditor.getState().saveCustomPreset(preset);
  };

  const field = (index: number, label: string) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ color: 'var(--text-dim)' }}>{label}</span>
      <input
        type="number"
        step="0.01"
        value={Number(points[index].toFixed(3))}
        style={{ width: 62 }}
        onChange={(e) => {
          const next: Points = [...points];
          const v = Number(e.target.value);
          next[index] = index % 2 === 0 ? Math.min(1, Math.max(0, v)) : v;
          setPoints(next);
        }}
      />
    </label>
  );

  return (
    <div className="curve-editor">
      <div className="curve-editor-head">
        <strong>Curve</strong>
        <span style={{ flex: 1 }} />
        <button className="icon" onClick={onClose} title="Close">✕</button>
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: SIZE, height: SIZE, cursor: 'crosshair' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => { dragging.current = null; }}
      />
      <div className="curve-fields">
        {field(0, 'x1')}{field(1, 'y1')}
        {field(2, 'x2')}{field(3, 'y2')}
      </div>
      <div className="curve-actions">
        <button onClick={readFromSelection} title="Load the curve from the selected segment">
          Read
        </button>
        <button className="active" onClick={apply}>Apply</button>
      </div>
      <div className="curve-actions">
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
        <button onClick={save}>Save preset</button>
      </div>
    </div>
  );
}
