import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatTimecode, snapToFrame } from '@/core/time';
import { valueAtTime, velocityAtTime } from '@/core/property';
import { useEditor } from '@/state/store';
import type { KeyframeRef } from '@/state/store';
import type { Composition, Keyframe, PropertyValue } from '@/core/types';
import { buildGraphTracks } from './graphTracks';
import type { GraphTrack } from './graphTracks';
import { RULER_HEIGHT } from './timelineRows';
import type { TimelineView } from './TrackArea';

interface Props {
  comp: Composition;
  time: number;
  view: TimelineView;
  onViewChange: (view: TimelineView) => void;
}

const PAD_X = 10;
const PAD_Y = 16;
const KEY_HIT = 6;
const HANDLE_HIT = 7;

interface Range { min: number; max: number }

type Drag =
  | { kind: 'none' }
  | { kind: 'cti' }
  | {
      kind: 'keyframe'; track: GraphTrack; ref: KeyframeRef;
      entries: { ref: KeyframeRef; time: number; value: PropertyValue }[];
      originTime: number; originValue: number;
    }
  | {
      kind: 'handle'; track: GraphTrack; ref: KeyframeRef; side: 'in' | 'out';
      keyTime: number; keyValue: number; segmentDuration: number;
    }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number };

export function GraphEditor({ comp, time, view, onViewChange }: Props) {
  const project = useEditor((s) => s.project);
  const graph = useEditor((s) => s.graph);
  const selectedProperties = useEditor((s) => s.selectedProperties);
  const selectedLayerIds = useEditor((s) => s.selectedLayerIds);
  const selectedKeyframes = useEditor((s) => s.selectedKeyframes);
  const revealed = useEditor((s) => s.revealed);

  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 800, height: 260 });
  const [range, setRange] = useState<Range>({ min: 0, max: 100 });
  const [readout, setReadout] = useState<string | null>(null);
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

  const tracks = useMemo(
    () => buildGraphTracks(comp, selectedProperties, selectedLayerIds, revealed, graph.mode),
    [comp, selectedProperties, selectedLayerIds, revealed, graph.mode, project],
  );

  const span = view.end - view.start;
  const usableW = Math.max(1, size.width - PAD_X * 2);
  const plotTop = RULER_HEIGHT + PAD_Y;
  const usableH = Math.max(1, size.height - plotTop - PAD_Y);

  const timeToX = useCallback(
    (t: number) => PAD_X + ((t - view.start) / span) * usableW,
    [view.start, span, usableW],
  );
  const xToTime = useCallback(
    (x: number) => view.start + ((x - PAD_X) / usableW) * span,
    [view.start, span, usableW],
  );

  /** Per-track value range: its own when normalized, else the shared range. */
  const trackRanges = useMemo(() => {
    const map = new Map<string, Range>();
    for (const track of tracks) {
      map.set(track.key, measureTrack(track, view, graph.mode));
    }
    return map;
  }, [tracks, view, graph.mode, project]);

  const sharedRange = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const r of trackRanges.values()) {
      min = Math.min(min, r.min);
      max = Math.max(max, r.max);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 100 };
    return padRange({ min, max });
  }, [trackRanges]);

  useEffect(() => {
    if (graph.autoZoom) setRange(sharedRange);
  }, [graph.autoZoom, sharedRange]);

  const rangeFor = useCallback((track: GraphTrack): Range => {
    if (!graph.normalize) return range;
    return padRange(trackRanges.get(track.key) ?? { min: 0, max: 1 });
  }, [graph.normalize, range, trackRanges]);

  const valueToY = useCallback((track: GraphTrack, value: number): number => {
    const r = rangeFor(track);
    const t = (value - r.min) / Math.max(1e-9, r.max - r.min);
    return plotTop + (1 - t) * usableH;
  }, [rangeFor, plotTop, usableH]);

  const yToValue = useCallback((track: GraphTrack, y: number): number => {
    const r = rangeFor(track);
    const t = 1 - (y - plotTop) / usableH;
    return r.min + t * (r.max - r.min);
  }, [rangeFor, plotTop, usableH]);

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

    ctx.clearRect(0, 0, size.width, size.height);
    ctx.fillStyle = '#212121';
    ctx.fillRect(0, 0, size.width, size.height);

    drawGrid(ctx, { size, plotTop, usableH, range, normalize: graph.normalize, mode: graph.mode });
    drawTimeRuler(ctx, comp, view, size.width, timeToX, time);

    for (const track of tracks) {
      drawTrack(ctx, {
        track, view, size, timeToX,
        valueToY: (v) => valueToY(track, v),
        mode: graph.mode,
        selectedKeyframes,
        plotTop,
        usableH,
      });
    }

    if (tracks.length > 0 && tracks.every((t) => !t.editable)) {
      ctx.fillStyle = '#8a8a8a';
      ctx.font = '10px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(
        'Reference graph — a vector shares one easing curve. '
        + 'Switch to Speed, or separate its dimensions, to drag handles.',
        8, size.height - 6,
      );
    }

    if (tracks.length === 0) {
      ctx.fillStyle = '#7a7a7a';
      ctx.font = '12px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        'Select an animated property to graph it.',
        size.width / 2, size.height / 2,
      );
      ctx.textAlign = 'left';
    }

    if (marquee && marquee.kind === 'marquee') {
      const { x0, y0, x1, y1 } = marquee;
      ctx.strokeStyle = 'rgba(120,170,255,0.9)';
      ctx.fillStyle = 'rgba(120,170,255,0.12)';
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.strokeRect(
        Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5,
        Math.abs(x1 - x0), Math.abs(y1 - y0),
      );
    }

    // Legend.
    ctx.font = '10px "Segoe UI", system-ui, sans-serif';
    tracks.forEach((track, index) => {
      const y = plotTop + 12 + index * 14;
      ctx.fillStyle = track.color;
      ctx.fillRect(size.width - 190, y - 7, 8, 8);
      ctx.fillStyle = '#b5b5b5';
      ctx.fillText(track.name, size.width - 176, y);
    });
  }, [
    comp, tracks, view, size, time, graph, range, selectedKeyframes, marquee,
    timeToX, valueToY, plotTop, usableH, project,
  ]);

  // -- interaction --------------------------------------------------------
  const localPoint = (e: React.PointerEvent | React.MouseEvent) => {
    const rect = hostRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const hitHandle = (x: number, y: number) => {
    for (const track of tracks) {
      if (!track.editable) continue;
      const kfs = track.property.keyframes;
      for (let i = 0; i < kfs.length; i += 1) {
        for (const side of ['in', 'out'] as const) {
          const point = handlePoint(track, kfs, i, side, graph.mode);
          if (!point) continue;
          const hx = timeToX(point.time);
          const hy = valueToY(track, point.value);
          if (Math.hypot(hx - x, hy - y) <= HANDLE_HIT) {
            return { track, index: i, side, point };
          }
        }
      }
    }
    return null;
  };

  const hitKeyframe = (x: number, y: number) => {
    for (const track of tracks) {
      const kfs = track.property.keyframes;
      for (const kf of kfs) {
        const value = plottedValue(track, kf, graph.mode);
        const kx = timeToX(kf.time);
        const ky = valueToY(track, value);
        if (Math.hypot(kx - x, ky - y) <= KEY_HIT + 2) return { track, kf };
      }
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const store = useEditor.getState();
    const { x, y } = localPoint(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    if (y < RULER_HEIGHT) {
      drag.current = { kind: 'cti' };
      store.setTime(xToTime(x));
      return;
    }

    const handle = hitHandle(x, y);
    if (handle) {
      const kfs = handle.track.property.keyframes;
      const kf = kfs[handle.index];
      const neighbour = handle.side === 'out' ? kfs[handle.index + 1] : kfs[handle.index - 1];
      if (!neighbour) return;
      if (e.altKey) {
        store.setSelectedTangentMode('independent');
      }
      drag.current = {
        kind: 'handle',
        track: handle.track,
        ref: { layerId: handle.track.layerId, path: handle.track.path, kfId: kf.id },
        side: handle.side,
        keyTime: kf.time,
        keyValue: plottedValue(handle.track, kf, graph.mode),
        segmentDuration: Math.abs(neighbour.time - kf.time),
      };
      return;
    }

    const hit = hitKeyframe(x, y);
    if (hit) {
      const ref: KeyframeRef = {
        layerId: hit.track.layerId, path: hit.track.path, kfId: hit.kf.id,
      };
      const already = selectedKeyframes.some((k) => k.kfId === ref.kfId);
      if (!already) store.toggleKeyframeSelection(ref, e.shiftKey);
      const refs = already || e.shiftKey ? useEditor.getState().selectedKeyframes : [ref];
      drag.current = {
        kind: 'keyframe',
        track: hit.track,
        ref,
        entries: refs.map((r) => {
          const prop = findTrack(tracks, r)?.property;
          const kf = prop?.keyframes.find((k) => k.id === r.kfId);
          return { ref: r, time: kf?.time ?? 0, value: kf?.value ?? 0 };
        }),
        originTime: xToTime(x),
        originValue: yToValue(hit.track, y),
      };
      return;
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

      case 'keyframe': {
        const dt = xToTime(x) - mode.originTime;
        const dv = yToValue(mode.track, y) - mode.originValue;
        const constrainToValue = e.shiftKey;

        if (!constrainToValue) {
          store.moveKeyframesTo(
            mode.entries.map(({ ref, time: t }) => ({
              ref,
              time: Math.max(0, graph.snap ? snapToFrame(t + dt, comp.frameRate) : t + dt),
            })),
            'graph:move',
          );
        }
        // The value graph also edits the value; the speed graph never does.
        if (graph.mode === 'value' && mode.track.dimension === null) {
          for (const entry of mode.entries) {
            const current = entry.value;
            if (typeof current !== 'number') continue;
            store.setKeyframeValue(entry.ref, current + dv, 'graph:move');
          }
        }
        setReadout(
          `${formatTimecode(mode.entries[0]?.time + dt, comp.frameRate)}`
          + (graph.mode === 'value' && mode.track.dimension === null
            ? `   value ${(mode.originValue + dv).toFixed(2)}` : ''),
        );
        break;
      }

      case 'handle': {
        const dx = Math.abs(xToTime(x) - mode.keyTime);
        const influence = mode.segmentDuration <= 0
          ? 33
          : Math.min(100, Math.max(0.1, (dx / mode.segmentDuration) * 100));

        let speed: number;
        if (graph.mode === 'speed') {
          speed = yToValue(mode.track, y);
        } else {
          const dv = yToValue(mode.track, y) - mode.keyValue;
          const seconds = Math.max(1e-4, dx);
          speed = (mode.side === 'out' ? dv : -dv) / seconds;
        }

        store.setKeyframeEase(mode.ref, mode.side, { influence, speed });
        setReadout(`influence ${influence.toFixed(1)}%   speed ${speed.toFixed(2)}/s`);
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
      const refs: KeyframeRef[] = [];
      const left = Math.min(mode.x0, mode.x1);
      const right = Math.max(mode.x0, mode.x1);
      const top = Math.min(mode.y0, mode.y1);
      const bottom = Math.max(mode.y0, mode.y1);
      for (const track of tracks) {
        for (const kf of track.property.keyframes) {
          const kx = timeToX(kf.time);
          const ky = valueToY(track, plottedValue(track, kf, graph.mode));
          if (kx >= left && kx <= right && ky >= top && ky <= bottom) {
            refs.push({ layerId: track.layerId, path: track.path, kfId: kf.id });
          }
        }
      }
      useEditor.getState().setSelectedKeyframes(dedupe(refs));
      setMarquee(null);
    }
    drag.current = { kind: 'none' };
    setReadout(null);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) {
      const { x } = localPoint(e);
      const anchor = xToTime(x);
      const factor = e.deltaY < 0 ? 0.85 : 1 / 0.85;
      const nextSpan = Math.min(
        comp.duration, Math.max(2 / comp.frameRate, span * factor),
      );
      const ratio = (anchor - view.start) / span;
      let start = anchor - nextSpan * ratio;
      let end = start + nextSpan;
      if (start < 0) { start = 0; end = nextSpan; }
      if (end > comp.duration) { end = comp.duration; start = Math.max(0, end - nextSpan); }
      onViewChange({ start, end });
      return;
    }
    // Vertical wheel zooms the value axis around its centre.
    const centre = (range.min + range.max) / 2;
    const half = ((range.max - range.min) / 2) * (e.deltaY > 0 ? 1.1 : 1 / 1.1);
    useEditor.getState().setGraph({ autoZoom: false });
    setRange({ min: centre - half, max: centre + half });
  };

  const store = useEditor.getState();

  return (
    <div className="graph-wrap">
      <div className="graph-toolbar">
        <button
          className={graph.mode === 'value' ? 'active' : ''}
          onClick={() => store.setGraph({ mode: 'value' })}
          title="Value graph"
        >
          Value
        </button>
        <button
          className={graph.mode === 'speed' ? 'active' : ''}
          onClick={() => store.setGraph({ mode: 'speed' })}
          title="Speed graph — where a vector's shared easing handles live"
        >
          Speed
        </button>
        <div className="sep" />
        <button
          className={graph.normalize ? 'icon active' : 'icon'}
          onClick={() => store.setGraph({ normalize: !graph.normalize })}
          title="Fit each property to the view, so mixed units can be compared"
        >
          Normalize
        </button>
        <button
          className={graph.autoZoom ? 'icon active' : 'icon'}
          onClick={() => store.setGraph({ autoZoom: !graph.autoZoom })}
          title="Auto-zoom the value axis"
        >
          Auto-zoom
        </button>
        <button
          className="icon"
          onClick={() => { setRange(sharedRange); store.setGraph({ autoZoom: false }); }}
          title="Fit the curves to the view"
        >
          Fit
        </button>
        <button
          className={graph.snap ? 'icon active' : 'icon'}
          onClick={() => store.setGraph({ snap: !graph.snap })}
          title="Snap dragged keyframes to whole frames"
        >
          Snap
        </button>
        <div className="sep" />
        <button
          className={graph.showPresets ? 'icon active' : 'icon'}
          onClick={() => store.setGraph({ showPresets: !graph.showPresets })}
          title="Show the easing preset library"
        >
          Easing library
        </button>
        <span style={{ flex: 1 }} />
        {readout && <span className="graph-readout">{readout}</span>}
      </div>
      <div
        className="timeline-tracks"
        ref={hostRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      >
        <canvas ref={canvasRef} style={{ width: size.width, height: size.height, display: 'block' }} />
      </div>
    </div>
  );
}

// -- geometry --------------------------------------------------------------

function findTrack(tracks: GraphTrack[], ref: KeyframeRef): GraphTrack | undefined {
  return tracks.find((t) => t.layerId === ref.layerId && t.path === ref.path);
}

function dedupe(refs: KeyframeRef[]): KeyframeRef[] {
  const seen = new Set<string>();
  return refs.filter((r) => (seen.has(r.kfId) ? false : (seen.add(r.kfId), true)));
}

/** The number this track plots for a keyframe. */
function plottedValue(track: GraphTrack, kf: Keyframe, mode: 'value' | 'speed'): number {
  if (mode === 'speed') return velocityAtTime(track.property, kf.time);
  if (track.dimension !== null) return (kf.value as number[])[track.dimension];
  return typeof kf.value === 'number' ? kf.value : (kf.value as number[])[0];
}

/** Where a temporal handle sits, in (time, plotted value) space. */
function handlePoint(
  track: GraphTrack,
  kfs: Keyframe[],
  index: number,
  side: 'in' | 'out',
  mode: 'value' | 'speed',
): { time: number; value: number } | null {
  const kf = kfs[index];
  const neighbour = side === 'out' ? kfs[index + 1] : kfs[index - 1];
  if (!neighbour) return null;

  const type = side === 'out' ? kf.outType : kf.inType;
  if (type === 'hold') return null;

  const ease = side === 'out' ? kf.easeOut : kf.easeIn;
  const duration = Math.abs(neighbour.time - kf.time);
  const dt = (ease.influence / 100) * duration;
  const time = side === 'out' ? kf.time + dt : kf.time - dt;

  if (mode === 'speed') return { time, value: ease.speed };

  const base = plottedValue(track, kf, mode);
  const value = side === 'out' ? base + ease.speed * dt : base - ease.speed * dt;
  return { time, value };
}

function padRange(r: Range): Range {
  if (!Number.isFinite(r.min) || !Number.isFinite(r.max)) return { min: 0, max: 100 };
  if (Math.abs(r.max - r.min) < 1e-6) return { min: r.min - 1, max: r.max + 1 };
  const pad = (r.max - r.min) * 0.12;
  return { min: r.min - pad, max: r.max + pad };
}

/** Sample a track across the visible range to find its extent. */
function measureTrack(track: GraphTrack, view: TimelineView, mode: 'value' | 'speed'): Range {
  let min = Infinity;
  let max = -Infinity;
  const samples = 96;
  for (let i = 0; i <= samples; i += 1) {
    const t = view.start + ((view.end - view.start) * i) / samples;
    const v = sampleTrack(track, t, mode);
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  // Handles can reach past the curve, so include them in the extent.
  const kfs = track.property.keyframes;
  for (let i = 0; i < kfs.length; i += 1) {
    for (const side of ['in', 'out'] as const) {
      const point = handlePoint(track, kfs, i, side, mode);
      if (!point) continue;
      min = Math.min(min, point.value);
      max = Math.max(max, point.value);
    }
  }
  return { min, max };
}

function sampleTrack(track: GraphTrack, t: number, mode: 'value' | 'speed'): number {
  if (mode === 'speed') return velocityAtTime(track.property, t);
  const value = valueAtTime(track.property, t);
  if (track.dimension !== null) return (value as number[])[track.dimension];
  return typeof value === 'number' ? value : (value as number[])[0];
}

// -- painting --------------------------------------------------------------

function drawGrid(
  ctx: CanvasRenderingContext2D,
  args: {
    size: { width: number; height: number };
    plotTop: number; usableH: number; range: Range;
    normalize: boolean; mode: 'value' | 'speed';
  },
): void {
  const { size, plotTop, usableH, range, normalize, mode } = args;
  ctx.strokeStyle = '#2c2c2c';
  ctx.fillStyle = '#6f6f6f';
  ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';

  const lines = 5;
  for (let i = 0; i <= lines; i += 1) {
    const y = Math.round(plotTop + (usableH * i) / lines) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size.width, y);
    ctx.stroke();
    if (!normalize) {
      const value = range.max - ((range.max - range.min) * i) / lines;
      ctx.fillText(formatAxis(value), 4, y - 3);
    }
  }
  if (normalize) {
    ctx.fillText(
      mode === 'speed' ? 'speed (normalized per property)' : 'value (normalized per property)',
      4, plotTop - 4,
    );
  }
}

function drawTimeRuler(
  ctx: CanvasRenderingContext2D,
  comp: Composition,
  view: TimelineView,
  width: number,
  timeToX: (t: number) => number,
  time: number,
): void {
  ctx.fillStyle = '#2e2e2e';
  ctx.fillRect(0, 0, width, RULER_HEIGHT);

  const step = chooseStep(view.end - view.start, width);
  ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
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

  const ctiX = Math.round(timeToX(time)) + 0.5;
  ctx.strokeStyle = '#f0453a';
  ctx.beginPath();
  ctx.moveTo(ctiX, 0);
  ctx.lineTo(ctiX, ctx.canvas.height);
  ctx.stroke();
}

function drawTrack(
  ctx: CanvasRenderingContext2D,
  args: {
    track: GraphTrack;
    view: TimelineView;
    size: { width: number; height: number };
    timeToX: (t: number) => number;
    valueToY: (v: number) => number;
    mode: 'value' | 'speed';
    selectedKeyframes: KeyframeRef[];
    plotTop: number;
    usableH: number;
  },
): void {
  const { track, view, size, timeToX, valueToY, mode, selectedKeyframes } = args;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, RULER_HEIGHT, size.width, size.height - RULER_HEIGHT);
  ctx.clip();

  // Curve.
  ctx.strokeStyle = track.color;
  ctx.lineWidth = track.editable ? 1.6 : 1.1;
  if (!track.editable) ctx.setLineDash([4, 3]);
  ctx.beginPath();
  const steps = Math.max(32, Math.round(size.width));
  for (let i = 0; i <= steps; i += 1) {
    const t = view.start + ((view.end - view.start) * i) / steps;
    const x = timeToX(t);
    const y = valueToY(sampleTrack(track, t, mode));
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Handles and keyframes.
  const kfs = track.property.keyframes;
  for (let i = 0; i < kfs.length; i += 1) {
    const kf = kfs[i];
    const kx = timeToX(kf.time);
    const ky = valueToY(plottedValue(track, kf, mode));

    if (track.editable) {
      for (const side of ['in', 'out'] as const) {
        const point = handlePoint(track, kfs, i, side, mode);
        if (!point) continue;
        const hx = timeToX(point.time);
        const hy = valueToY(point.value);
        ctx.strokeStyle = 'rgba(220,220,220,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(kx, ky);
        ctx.lineTo(hx, hy);
        ctx.stroke();
        ctx.fillStyle = '#dcdcdc';
        ctx.beginPath();
        ctx.arc(hx, hy, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const selected = selectedKeyframes.some((k) => k.kfId === kf.id);
    ctx.fillStyle = selected ? '#ffd24a' : track.color;
    ctx.strokeStyle = '#15171b';
    ctx.lineWidth = 1;
    if (kf.roving) {
      // Roving keyframes are drawn as circles, as they are in After Effects.
      ctx.beginPath();
      ctx.arc(kx, ky, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(kx - 4, ky - 4, 8, 8);
      ctx.strokeRect(kx - 4.5, ky - 4.5, 9, 9);
    }
  }

  ctx.restore();
}

function chooseStep(span: number, width: number): number {
  const target = Math.max(2, Math.floor(width / 100));
  const raw = span / target;
  const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  return candidates.find((c) => c >= raw) ?? 600;
}

function formatAxis(value: number): string {
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}
