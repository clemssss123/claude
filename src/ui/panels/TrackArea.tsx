import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { findLayer } from '@/core/composition';
import { LABEL_COLORS } from '@/core/types';
import { formatTimecode, snapToFrame } from '@/core/time';
import { useEditor } from '@/state/store';
import type { KeyframeRef } from '@/state/store';
import type { Composition, Id } from '@/core/types';
import type { TimelineRow } from './timelineRows';
import { ROW_HEIGHT, RULER_HEIGHT } from './timelineRows';

export interface TimelineView { start: number; end: number }

interface Props {
  comp: Composition;
  rows: TimelineRow[];
  time: number;
  view: TimelineView;
  scrollTop: number;
  selectedLayerIds: Id[];
  selectedKeyframes: KeyframeRef[];
  onViewChange: (view: TimelineView) => void;
  onScroll: (top: number) => void;
  onKeyframeContextMenu: (x: number, y: number, ref: KeyframeRef) => void;
}

type Drag =
  | { kind: 'none' }
  | { kind: 'cti' }
  | { kind: 'work'; edge: 'start' | 'end' }
  | { kind: 'keyframes'; origin: number; entries: { ref: KeyframeRef; time: number }[] }
  | { kind: 'layer'; mode: 'move' | 'in' | 'out'; layerId: Id; origin: number;
      inPoint: number; outPoint: number; startTime: number }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number };

const KEYFRAME_HIT = 6;
const EDGE_HIT = 5;
/** Gutter so keyframes and bars at the range ends are not clipped. */
const TRACK_PAD = 10;

export function TrackArea({
  comp, rows, time, view, scrollTop, selectedLayerIds, selectedKeyframes,
  onViewChange, onScroll, onKeyframeContextMenu,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 600, height: 300 });
  const drag = useRef<Drag>({ kind: 'none' });
  const [marquee, setMarquee] = useState<Drag | null>(null);

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const span = view.end - view.start;
  const usable = Math.max(1, size.width - TRACK_PAD * 2);
  const timeToX = useCallback(
    (t: number) => TRACK_PAD + ((t - view.start) / span) * usable,
    [view.start, span, usable],
  );
  const xToTime = useCallback(
    (x: number) => view.start + ((x - TRACK_PAD) / usable) * span,
    [view.start, span, usable],
  );

  // -- paint --------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(size.width * dpr));
    canvas.height = Math.max(1, Math.round(size.height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawTracks(ctx, {
      comp, rows, time, view, scrollTop, size, selectedLayerIds, selectedKeyframes,
      timeToX,
      marquee: marquee && marquee.kind === 'marquee' ? marquee : null,
    });
  }, [comp, rows, time, view, scrollTop, size, selectedLayerIds, selectedKeyframes, timeToX, marquee]);

  // -- hit testing --------------------------------------------------------
  const rowAtY = (y: number): { row: TimelineRow; index: number } | null => {
    if (y < RULER_HEIGHT) return null;
    const index = Math.floor((y - RULER_HEIGHT + scrollTop) / ROW_HEIGHT);
    const row = rows[index];
    return row ? { row, index } : null;
  };

  const keyframeAt = (x: number, y: number): KeyframeRef | null => {
    const hit = rowAtY(y);
    if (!hit || hit.row.kind !== 'prop') return null;
    const { property, layerId, path } = hit.row;
    if (!property.animated) return null;
    for (const kf of property.keyframes) {
      if (Math.abs(timeToX(kf.time) - x) <= KEYFRAME_HIT) {
        return { layerId, path, kfId: kf.id };
      }
    }
    return null;
  };

  const localPoint = (e: React.PointerEvent | React.MouseEvent) => {
    const rect = hostRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const store = useEditor.getState();
    const { x, y } = localPoint(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    if (y < RULER_HEIGHT) {
      const workStartX = timeToX(comp.workAreaStart);
      const workEndX = timeToX(comp.workAreaEnd);
      if (Math.abs(x - workStartX) <= EDGE_HIT && y < RULER_HEIGHT / 2) {
        drag.current = { kind: 'work', edge: 'start' };
        return;
      }
      if (Math.abs(x - workEndX) <= EDGE_HIT && y < RULER_HEIGHT / 2) {
        drag.current = { kind: 'work', edge: 'end' };
        return;
      }
      drag.current = { kind: 'cti' };
      store.setTime(xToTime(x));
      return;
    }

    const kfRef = keyframeAt(x, y);
    if (kfRef) {
      const already = selectedKeyframes.some((k) => k.kfId === kfRef.kfId);
      if (!already) store.toggleKeyframeSelection(kfRef, e.shiftKey);
      const refs = already || e.shiftKey
        ? useEditor.getState().selectedKeyframes
        : [kfRef];
      const entries = refs.map((ref) => {
        const layer = findLayer(comp, ref.layerId);
        const prop = layer && rows.find(
          (r) => r.kind === 'prop' && r.layerId === ref.layerId && r.path === ref.path,
        );
        const kf = prop && prop.kind === 'prop'
          ? prop.property.keyframes.find((k) => k.id === ref.kfId)
          : undefined;
        return { ref, time: kf?.time ?? 0 };
      });
      drag.current = { kind: 'keyframes', origin: xToTime(x), entries };
      return;
    }

    const hit = rowAtY(y);
    if (hit && hit.row.kind === 'layer') {
      const layer = hit.row.layer;
      store.selectLayer(layer.id, e.shiftKey || e.ctrlKey);
      const inX = timeToX(layer.inPoint);
      const outX = timeToX(layer.outPoint);
      if (x >= inX - EDGE_HIT && x <= outX + EDGE_HIT) {
        const mode = Math.abs(x - inX) <= EDGE_HIT ? 'in'
          : Math.abs(x - outX) <= EDGE_HIT ? 'out' : 'move';
        drag.current = {
          kind: 'layer', mode, layerId: layer.id, origin: xToTime(x),
          inPoint: layer.inPoint, outPoint: layer.outPoint, startTime: layer.startTime,
        };
        return;
      }
    }

    drag.current = { kind: 'marquee', x0: x, y0: y, x1: x, y1: y };
    setMarquee(drag.current);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const mode = drag.current;
    if (mode.kind === 'none') return;
    const store = useEditor.getState();
    const { x, y } = localPoint(e);

    switch (mode.kind) {
      case 'cti':
        store.setTime(xToTime(x));
        break;
      case 'work':
        if (mode.edge === 'start') store.setWorkAreaStart(snapToFrame(xToTime(x), comp.frameRate));
        else store.setWorkAreaEnd(snapToFrame(xToTime(x), comp.frameRate));
        break;
      case 'keyframes': {
        const delta = snapToFrame(xToTime(x) - mode.origin, comp.frameRate);
        store.moveKeyframesTo(
          mode.entries.map(({ ref, time: t }) => ({
            ref,
            time: Math.max(0, snapToFrame(t + delta, comp.frameRate)),
          })),
          'tl:keyframes',
        );
        break;
      }
      case 'layer': {
        const delta = snapToFrame(xToTime(x) - mode.origin, comp.frameRate);
        store.mutateComp('Move Layer', (draft) => {
          const layer = findLayer(draft, mode.layerId);
          if (!layer) return;
          if (mode.mode === 'move') {
            layer.inPoint = mode.inPoint + delta;
            layer.outPoint = mode.outPoint + delta;
            layer.startTime = mode.startTime + delta;
          } else if (mode.mode === 'in') {
            layer.inPoint = Math.min(mode.inPoint + delta, layer.outPoint - 1 / draft.frameRate);
          } else {
            layer.outPoint = Math.max(mode.outPoint + delta, layer.inPoint + 1 / draft.frameRate);
          }
        }, { coalesceKey: `tl:layer:${mode.layerId}` });
        break;
      }
      case 'marquee': {
        const next: Drag = { ...mode, x1: x, y1: y };
        drag.current = next;
        setMarquee(next);
        break;
      }
      default:
        break;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const mode = drag.current;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (mode.kind === 'marquee') {
      const refs = keyframesInRect(rows, mode, scrollTop, timeToX);
      useEditor.getState().setSelectedKeyframes(refs);
      setMarquee(null);
    }
    drag.current = { kind: 'none' };
  };

  const onContextMenu = (e: React.MouseEvent) => {
    const { x, y } = localPoint(e);
    const ref = keyframeAt(x, y);
    if (!ref) return;
    e.preventDefault();
    if (!selectedKeyframes.some((k) => k.kfId === ref.kfId)) {
      useEditor.getState().toggleKeyframeSelection(ref, false);
    }
    onKeyframeContextMenu(e.clientX, e.clientY, ref);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) {
      // Zoom the time range about the pointer.
      const { x } = localPoint(e);
      const anchor = xToTime(x);
      const factor = e.deltaY < 0 ? 0.85 : 1 / 0.85;
      const nextSpan = Math.min(
        comp.duration,
        Math.max(2 / comp.frameRate, (view.end - view.start) * factor),
      );
      const ratio = (anchor - view.start) / (view.end - view.start);
      let start = anchor - nextSpan * ratio;
      let end = start + nextSpan;
      if (start < 0) { start = 0; end = nextSpan; }
      if (end > comp.duration) { end = comp.duration; start = Math.max(0, end - nextSpan); }
      onViewChange({ start, end });
      return;
    }
    if (e.shiftKey) {
      const shift = (e.deltaY / size.width) * span;
      const start = Math.max(0, Math.min(comp.duration - span, view.start + shift));
      onViewChange({ start, end: start + span });
      return;
    }
    onScroll(Math.max(0, scrollTop + e.deltaY));
  };

  return (
    <div
      className="timeline-tracks"
      ref={hostRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={onContextMenu}
      onWheel={onWheel}
    >
      <canvas ref={canvasRef} style={{ width: size.width, height: size.height, display: 'block' }} />
    </div>
  );
}

// -- painting --------------------------------------------------------------

interface DrawArgs {
  comp: Composition;
  rows: TimelineRow[];
  time: number;
  view: TimelineView;
  scrollTop: number;
  size: { width: number; height: number };
  selectedLayerIds: Id[];
  selectedKeyframes: KeyframeRef[];
  timeToX: (t: number) => number;
  marquee: { x0: number; y0: number; x1: number; y1: number } | null;
}

function drawTracks(ctx: CanvasRenderingContext2D, args: DrawArgs): void {
  const { rows, time, size, scrollTop, selectedLayerIds, selectedKeyframes, timeToX } = args;
  const { width, height } = size;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#262626';
  ctx.fillRect(0, RULER_HEIGHT, width, height - RULER_HEIGHT);

  drawRuler(ctx, args);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, RULER_HEIGHT, width, height - RULER_HEIGHT);
  ctx.clip();
  ctx.translate(0, RULER_HEIGHT - scrollTop);

  rows.forEach((row, index) => {
    const y = index * ROW_HEIGHT;
    if (y - scrollTop > height || y - scrollTop + ROW_HEIGHT < 0) return;

    const selected = selectedLayerIds.includes(row.layerId);
    ctx.fillStyle = row.kind === 'layer'
      ? (selected ? '#34435c' : '#262626')
      : '#222222';
    ctx.fillRect(0, y, width, ROW_HEIGHT);
    ctx.strokeStyle = '#1c1c1c';
    ctx.beginPath();
    ctx.moveTo(0, y + ROW_HEIGHT - 0.5);
    ctx.lineTo(width, y + ROW_HEIGHT - 0.5);
    ctx.stroke();

    if (row.kind === 'layer') {
      const x0 = timeToX(row.layer.inPoint);
      const x1 = timeToX(row.layer.outPoint);
      const color = LABEL_COLORS[row.layer.label % LABEL_COLORS.length];
      ctx.fillStyle = hexWithAlpha(color, row.layer.enabled ? 0.75 : 0.3);
      ctx.fillRect(x0, y + 5, Math.max(2, x1 - x0), ROW_HEIGHT - 11);
      ctx.strokeStyle = hexWithAlpha(color, 1);
      ctx.strokeRect(x0 + 0.5, y + 5.5, Math.max(2, x1 - x0) - 1, ROW_HEIGHT - 12);
    }

    if (row.kind === 'prop' && row.property.animated) {
      for (const kf of row.property.keyframes) {
        const x = timeToX(kf.time);
        if (x < -10 || x > width + 10) continue;
        const isSelected = selectedKeyframes.some((k) => k.kfId === kf.id);
        drawKeyframe(ctx, x, y + ROW_HEIGHT / 2, kf.inType, kf.outType, isSelected);
      }
    }
  });

  ctx.restore();

  // Current time indicator over everything.
  const ctiX = Math.round(timeToX(time)) + 0.5;
  ctx.strokeStyle = '#f0453a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ctiX, 0);
  ctx.lineTo(ctiX, height);
  ctx.stroke();

  if (args.marquee) {
    const { x0, y0, x1, y1 } = args.marquee;
    ctx.strokeStyle = 'rgba(120,170,255,0.9)';
    ctx.fillStyle = 'rgba(120,170,255,0.12)';
    const rx = Math.min(x0, x1);
    const ry = Math.min(y0, y1);
    ctx.fillRect(rx, ry, Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.strokeRect(rx + 0.5, ry + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
  }
}

function drawRuler(ctx: CanvasRenderingContext2D, args: DrawArgs): void {
  const { comp, view, size, time, timeToX } = args;
  const { width } = size;

  ctx.fillStyle = '#2e2e2e';
  ctx.fillRect(0, 0, width, RULER_HEIGHT);

  // Work area.
  const wx0 = timeToX(comp.workAreaStart);
  const wx1 = timeToX(comp.workAreaEnd);
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  ctx.fillRect(wx0, 0, wx1 - wx0, RULER_HEIGHT / 2);
  ctx.fillStyle = '#b9b9b9';
  ctx.fillRect(wx0 - 2, 0, 4, RULER_HEIGHT / 2);
  ctx.fillRect(wx1 - 2, 0, 4, RULER_HEIGHT / 2);

  const step = chooseTickStep(view.end - view.start, width, comp.frameRate);
  ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  const first = Math.ceil(view.start / step) * step;
  for (let t = first; t <= view.end + 1e-9; t += step) {
    const x = Math.round(timeToX(t)) + 0.5;
    ctx.strokeStyle = '#4a4a4a';
    ctx.beginPath();
    ctx.moveTo(x, RULER_HEIGHT - 8);
    ctx.lineTo(x, RULER_HEIGHT);
    ctx.stroke();
    ctx.fillStyle = '#9a9a9a';
    ctx.fillText(formatTimecode(t, comp.frameRate), x + 3, RULER_HEIGHT - 10);
  }

  ctx.strokeStyle = '#121212';
  ctx.beginPath();
  ctx.moveTo(0, RULER_HEIGHT - 0.5);
  ctx.lineTo(width, RULER_HEIGHT - 0.5);
  ctx.stroke();

  // CTI head.
  const ctiX = Math.round(timeToX(time)) + 0.5;
  ctx.fillStyle = '#f0453a';
  ctx.beginPath();
  ctx.moveTo(ctiX - 6, RULER_HEIGHT - 14);
  ctx.lineTo(ctiX + 6, RULER_HEIGHT - 14);
  ctx.lineTo(ctiX + 6, RULER_HEIGHT - 6);
  ctx.lineTo(ctiX, RULER_HEIGHT);
  ctx.lineTo(ctiX - 6, RULER_HEIGHT - 6);
  ctx.closePath();
  ctx.fill();
}

function drawKeyframe(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  inType: string,
  outType: string,
  selected: boolean,
): void {
  ctx.fillStyle = selected ? '#ffd24a' : '#b9c6d8';
  ctx.strokeStyle = '#11151c';
  const size = 5;

  if (inType === 'hold' || outType === 'hold') {
    // Hold keyframes render as a square, as in After Effects.
    ctx.fillRect(x - size, y - size, size * 2, size * 2);
    ctx.strokeRect(x - size + 0.5, y - size + 0.5, size * 2 - 1, size * 2 - 1);
    return;
  }
  if (inType === 'bezier' && outType === 'bezier') {
    // Eased keyframes render as an hourglass.
    ctx.beginPath();
    ctx.moveTo(x - size, y - size);
    ctx.lineTo(x + size, y - size);
    ctx.lineTo(x - size, y + size);
    ctx.lineTo(x + size, y + size);
    ctx.closePath();
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - size, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

/** Pick a tick spacing that keeps labels roughly 90px apart. */
function chooseTickStep(span: number, width: number, frameRate: number): number {
  const targetTicks = Math.max(2, Math.floor(width / 90));
  const raw = span / targetTicks;
  const candidates = [
    1 / frameRate, 2 / frameRate, 5 / frameRate, 10 / frameRate,
    0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600,
  ];
  return candidates.find((c) => c >= raw) ?? candidates[candidates.length - 1];
}

function keyframesInRect(
  rows: TimelineRow[],
  rect: { x0: number; y0: number; x1: number; y1: number },
  scrollTop: number,
  timeToX: (t: number) => number,
): KeyframeRef[] {
  const left = Math.min(rect.x0, rect.x1);
  const right = Math.max(rect.x0, rect.x1);
  const top = Math.min(rect.y0, rect.y1);
  const bottom = Math.max(rect.y0, rect.y1);

  const refs: KeyframeRef[] = [];
  rows.forEach((row, index) => {
    if (row.kind !== 'prop' || !row.property.animated) return;
    const rowTop = RULER_HEIGHT + index * ROW_HEIGHT - scrollTop;
    const rowBottom = rowTop + ROW_HEIGHT;
    if (rowBottom < top || rowTop > bottom) return;
    for (const kf of row.property.keyframes) {
      const x = timeToX(kf.time);
      if (x >= left && x <= right) {
        refs.push({ layerId: row.layerId, path: row.path, kfId: kf.id });
      }
    }
  });
  return refs;
}

function hexWithAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
}
