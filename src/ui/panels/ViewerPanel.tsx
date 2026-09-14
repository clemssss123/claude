import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { findLayer } from '@/core/composition';
import { layerCorners, parentMatrix, worldMatrix } from '@/core/layer';
import { applyToPoint, invert } from '@/core/matrix';
import type { Matrix } from '@/core/matrix';
import { activeComposition } from '@/core/project';
import { valueAtTime } from '@/core/property';
import { formatTimecode } from '@/core/time';
import { motionPathPoints, spatialInTangent, spatialOutTangent } from '@/core/spatial';
import { hitTestLayers } from '@/render/hit';
import { renderComposition } from '@/render/renderer';
import { useEditor } from '@/state/store';
import type { Composition, Keyframe, Layer, Vec2 } from '@/core/types';
import type { KeyframeRef } from '@/state/store';

type DragMode =
  | { kind: 'none' }
  | { kind: 'pan'; startPanX: number; startPanY: number; x: number; y: number }
  | { kind: 'move'; layerId: string; start: Vec2; origin: Vec2 }
  | { kind: 'rotate'; layerId: string; startAngle: number; pointerAngle: number; pivot: Vec2 }
  | { kind: 'anchor'; layerId: string; startAnchor: Vec2; startPos: Vec2; origin: Vec2 }
  | {
      kind: 'scale'; layerId: string; handle: number; startScale: Vec2;
      startLocal: Vec2; anchor: Vec2;
    }
  | {
      kind: 'spatial'; ref: KeyframeRef; side: 'in' | 'out';
      keyValue: Vec2; inverseParent: Matrix;
    };

const HANDLE_SIZE = 7;

export function ViewerPanel() {
  const project = useEditor((s) => s.project);
  const time = useEditor((s) => s.time);
  const viewer = useEditor((s) => s.viewer);
  const tool = useEditor((s) => s.tool);
  const selectedLayerIds = useEditor((s) => s.selectedLayerIds);

  const comp = activeComposition(project);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ width: 800, height: 450 });
  const drag = useRef<DragMode>({ kind: 'none' });
  const spaceHeld = useRef(false);

  // Track the stage size so "fit" stays correct while panels are resized.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setStage({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Space') spaceHeld.current = true; };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') spaceHeld.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const fitZoom = useMemo(() => {
    if (!comp) return 1;
    return Math.min(
      (stage.width - 32) / comp.width,
      (stage.height - 32) / comp.height,
    );
  }, [comp, stage.width, stage.height]);

  const zoom = viewer.fitOnResize ? Math.max(0.02, fitZoom) : viewer.zoom;

  const origin = useMemo((): Vec2 => {
    if (!comp) return [0, 0];
    return [
      (stage.width - comp.width * zoom) / 2 + viewer.panX,
      (stage.height - comp.height * zoom) / 2 + viewer.panY,
    ];
  }, [comp, stage, zoom, viewer.panX, viewer.panY]);

  const toComp = useCallback((clientX: number, clientY: number): Vec2 => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return [0, 0];
    return [
      (clientX - rect.left - origin[0]) / zoom,
      (clientY - rect.top - origin[1]) / zoom,
    ];
  }, [origin, zoom]);

  const toScreen = useCallback((p: Vec2): Vec2 => (
    [p[0] * zoom + origin[0], p[1] * zoom + origin[1]]
  ), [origin, zoom]);

  // -- composition render -------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !comp) return;
    const width = Math.max(1, Math.round(comp.width / viewer.resolution));
    const height = Math.max(1, Math.round(comp.height / viewer.resolution));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderComposition(ctx, comp, time, {
      resolution: viewer.resolution,
      showTransparencyGrid: viewer.showTransparencyGrid,
    });
  }, [comp, project, time, viewer.resolution, viewer.showTransparencyGrid]);

  // -- overlay (selection, handles, motion path) --------------------------
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || !comp) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(stage.width * dpr));
    canvas.height = Math.max(1, Math.round(stage.height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, stage.width, stage.height);

    if (viewer.showGuides) drawCompFrame(ctx, comp, toScreen);

    for (const id of selectedLayerIds) {
      const layer = findLayer(comp, id);
      if (layer) drawSelection(ctx, comp, layer, time, toScreen);
    }
  }, [comp, project, time, stage, selectedLayerIds, toScreen, viewer.showGuides]);

  // -- interaction --------------------------------------------------------
  const onPointerDown = (e: React.PointerEvent) => {
    if (!comp) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const state = useEditor.getState();
    const point = toComp(e.clientX, e.clientY);

    const panning = tool === 'hand' || spaceHeld.current || e.button === 1;
    if (panning) {
      drag.current = {
        kind: 'pan', startPanX: viewer.panX, startPanY: viewer.panY,
        x: e.clientX, y: e.clientY,
      };
      return;
    }

    if (tool === 'zoom') {
      const factor = e.altKey ? 1 / 1.4 : 1.4;
      state.setViewer({ zoom: Math.min(16, Math.max(0.02, zoom * factor)), fitOnResize: false });
      return;
    }

    // Motion-path handles sit on top of everything else on a selected layer.
    const spatialHit = findSpatialHandle(comp, selectedLayerIds, point, time, zoom);
    if (spatialHit && tool === 'selection') {
      drag.current = {
        kind: 'spatial',
        ref: spatialHit.ref,
        side: spatialHit.side,
        keyValue: spatialHit.keyValue,
        inverseParent: invert(spatialHit.parent),
      };
      return;
    }

    // A scale handle on an already-selected layer wins over a fresh hit test.
    const handleHit = findHandle(comp, selectedLayerIds, point, time, zoom);
    if (handleHit && tool === 'selection') {
      const layer = findLayer(comp, handleHit.layerId)!;
      const inverse = invert(worldMatrix(comp, layer, time));
      drag.current = {
        kind: 'scale',
        layerId: layer.id,
        handle: handleHit.index,
        startScale: valueAtTime(layer.transform.scale, time),
        startLocal: applyToPoint(inverse, point),
        anchor: valueAtTime(layer.transform.anchorPoint, time),
      };
      return;
    }

    const hit = hitTestLayers(comp, point, time);
    if (!hit) {
      state.deselectAll();
      return;
    }
    state.selectLayer(hit.id, e.shiftKey);

    if (tool === 'rotation') {
      const pivot = applyToPoint(
        worldMatrix(comp, hit, time),
        valueAtTime(hit.transform.anchorPoint, time),
      );
      drag.current = {
        kind: 'rotate',
        layerId: hit.id,
        startAngle: valueAtTime(hit.transform.rotation, time),
        pointerAngle: Math.atan2(point[1] - pivot[1], point[0] - pivot[0]),
        pivot,
      };
      return;
    }

    if (tool === 'anchor') {
      drag.current = {
        kind: 'anchor',
        layerId: hit.id,
        startAnchor: valueAtTime(hit.transform.anchorPoint, time),
        startPos: valueAtTime(hit.transform.position, time),
        origin: point,
      };
      return;
    }

    drag.current = {
      kind: 'move',
      layerId: hit.id,
      start: valueAtTime(hit.transform.position, time),
      origin: point,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const mode = drag.current;
    if (mode.kind === 'none' || !comp) return;
    const state = useEditor.getState();
    const point = toComp(e.clientX, e.clientY);

    switch (mode.kind) {
      case 'pan':
        state.setViewer({
          panX: mode.startPanX + (e.clientX - mode.x),
          panY: mode.startPanY + (e.clientY - mode.y),
        });
        break;

      case 'move': {
        let dx = point[0] - mode.origin[0];
        let dy = point[1] - mode.origin[1];
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0;
        }
        state.setPropertyValue(
          mode.layerId, 'transform.position',
          [mode.start[0] + dx, mode.start[1] + dy],
          `viewer:move:${mode.layerId}`,
        );
        break;
      }

      case 'rotate': {
        const angle = Math.atan2(point[1] - mode.pivot[1], point[0] - mode.pivot[0]);
        let degrees = mode.startAngle + ((angle - mode.pointerAngle) * 180) / Math.PI;
        if (e.shiftKey) degrees = Math.round(degrees / 15) * 15;
        state.setPropertyValue(
          mode.layerId, 'transform.rotation', degrees, `viewer:rotate:${mode.layerId}`,
        );
        break;
      }

      case 'anchor': {
        const layer = findLayer(comp, mode.layerId);
        if (!layer) break;
        // Pan Behind moves the anchor in layer space and compensates the
        // position so the pixels stay where they are.
        const m = worldMatrix(comp, layer, time);
        const inverse = invert(m);
        const localNow = applyToPoint(inverse, point);
        const localStart = applyToPoint(inverse, mode.origin);
        const dLocal: Vec2 = [localNow[0] - localStart[0], localNow[1] - localStart[1]];
        const newAnchor: Vec2 = [
          mode.startAnchor[0] + dLocal[0],
          mode.startAnchor[1] + dLocal[1],
        ];
        const worldDelta: Vec2 = [
          m.a * dLocal[0] + m.c * dLocal[1],
          m.b * dLocal[0] + m.d * dLocal[1],
        ];
        state.setPropertyValue(
          mode.layerId, 'transform.anchorPoint', newAnchor, `viewer:anchor:${mode.layerId}`,
        );
        state.setPropertyValue(
          mode.layerId, 'transform.position',
          [mode.startPos[0] + worldDelta[0], mode.startPos[1] + worldDelta[1]],
          `viewer:anchor:${mode.layerId}`,
        );
        break;
      }

      case 'spatial': {
        const local = applyToPoint(mode.inverseParent, point);
        state.setSpatialTangent(
          mode.ref, mode.side,
          [local[0] - mode.keyValue[0], local[1] - mode.keyValue[1]],
          `viewer:spatial:${mode.ref.kfId}:${mode.side}`,
        );
        break;
      }

      case 'scale': {
        const layer = findLayer(comp, mode.layerId);
        if (!layer) break;
        const inverse = invert(worldMatrix(comp, layer, time));
        const local = applyToPoint(inverse, point);
        const dxStart = mode.startLocal[0] - mode.anchor[0];
        const dyStart = mode.startLocal[1] - mode.anchor[1];
        const dxNow = local[0] - mode.anchor[0];
        const dyNow = local[1] - mode.anchor[1];
        let sx = Math.abs(dxStart) < 1e-6 ? 1 : dxNow / dxStart;
        let sy = Math.abs(dyStart) < 1e-6 ? 1 : dyNow / dyStart;
        // Edge handles only drive one axis.
        if (mode.handle === 4 || mode.handle === 6) sx = 1;
        if (mode.handle === 5 || mode.handle === 7) sy = 1;
        if (e.shiftKey) {
          const uniform = Math.abs(sx) > Math.abs(sy) ? sx : sy;
          sx = uniform;
          sy = uniform;
        }
        state.setPropertyValue(
          mode.layerId, 'transform.scale',
          [mode.startScale[0] * sx, mode.startScale[1] * sy],
          `viewer:scale:${mode.layerId}`,
        );
        break;
      }

      default:
        break;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    drag.current = { kind: 'none' };
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!comp) return;
    const state = useEditor.getState();
    if (e.ctrlKey || e.metaKey) {
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      state.setViewer({
        zoom: Math.min(16, Math.max(0.02, zoom * factor)),
        fitOnResize: false,
      });
    } else {
      state.setViewer({
        panX: viewer.panX - e.deltaX,
        panY: viewer.panY - e.deltaY,
      });
    }
  };

  if (!comp) return <div className="panel"><div className="empty-note">No composition.</div></div>;

  return (
    <div className="panel">
      <header>
        <span>Composition: {comp.name}</span>
        <span className="spacer" />
        <select
          value={viewer.resolution}
          onChange={(e) => useEditor.getState().setViewer({ resolution: Number(e.target.value) })}
          title="Resolution"
        >
          <option value={1}>Full</option>
          <option value={2}>Half</option>
          <option value={4}>Quarter</option>
        </select>
      </header>

      <div
        className="viewer-stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        style={{ cursor: tool === 'hand' ? 'grab' : tool === 'zoom' ? 'zoom-in' : 'default' }}
      >
        <div
          className="viewer-canvas-wrap"
          style={{
            left: origin[0],
            top: origin[1],
            width: comp.width * zoom,
            height: comp.height * zoom,
          }}
        >
          <canvas
            ref={canvasRef}
            style={{ width: comp.width * zoom, height: comp.height * zoom }}
          />
        </div>
        <canvas
          className="viewer-overlay"
          ref={overlayRef}
          style={{ width: stage.width, height: stage.height }}
        />
      </div>

      <div className="viewer-footer">
        <span className="timecode">{formatTimecode(time, comp.frameRate)}</span>
        <span>{Math.round(zoom * 100)}%</span>
        <span className="spacer" style={{ flex: 1 }} />
        <button
          className={`icon ${viewer.showTransparencyGrid ? 'active' : ''}`}
          onClick={() => useEditor.getState().setViewer({
            showTransparencyGrid: !viewer.showTransparencyGrid,
          })}
          title="Toggle Transparency Grid"
        >
          ▦
        </button>
        <button
          className={`icon ${viewer.fitOnResize ? 'active' : ''}`}
          onClick={() => useEditor.getState().setViewer({
            fitOnResize: !viewer.fitOnResize, panX: 0, panY: 0,
          })}
          title="Fit to window (Shift+/)"
        >
          Fit
        </button>
      </div>
    </div>
  );
}

// -- overlay drawing -------------------------------------------------------

function drawCompFrame(
  ctx: CanvasRenderingContext2D,
  comp: Composition,
  toScreen: (p: Vec2) => Vec2,
): void {
  const tl = toScreen([0, 0]);
  const br = toScreen([comp.width, comp.height]);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(tl[0] + 0.5, tl[1] + 0.5, br[0] - tl[0], br[1] - tl[1]);
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  comp: Composition,
  layer: Layer,
  time: number,
  toScreen: (p: Vec2) => Vec2,
): void {
  const corners = layerCorners(comp, layer, time).map(toScreen);

  ctx.save();
  ctx.strokeStyle = '#4a86ff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  corners.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x + 0.5, y + 0.5);
    else ctx.lineTo(x + 0.5, y + 0.5);
  });
  ctx.closePath();
  ctx.stroke();

  // Motion path: the spatial curve, drawn in the layer's parent space.
  const position = layer.transform.position;
  if (position.animated && position.keyframes.length > 1 && !position.separated) {
    const parent = parentMatrix(comp, layer, time);
    const toPath = (p: Vec2) => toScreen(applyToPoint(parent, p));
    const kfs = position.keyframes as Keyframe<Vec2>[];

    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.setLineDash([]);
    ctx.beginPath();
    motionPathPoints(position as typeof position & { keyframes: Keyframe<Vec2>[] })
      .forEach((point, i) => {
        const [x, y] = toPath(point);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
    ctx.stroke();

    kfs.forEach((kf, index) => {
      const [x, y] = toPath(kf.value);
      for (const side of ['in', 'out'] as const) {
        const tangent = side === 'out'
          ? spatialOutTangent(kfs, index)
          : spatialInTangent(kfs, index);
        if (Math.abs(tangent[0]) < 1e-6 && Math.abs(tangent[1]) < 1e-6) continue;
        const [hx, hy] = toPath([kf.value[0] + tangent[0], kf.value[1] + tangent[1]]);
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(hx, hy);
        ctx.stroke();
        ctx.fillStyle = '#9fd0ff';
        ctx.beginPath();
        ctx.arc(hx, hy, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
    });
  }

  // Scale handles.
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#2a2a2a';
  for (const [x, y] of handlePoints(corners)) {
    ctx.fillRect(x - HANDLE_SIZE / 2, y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.strokeRect(x - HANDLE_SIZE / 2 + 0.5, y - HANDLE_SIZE / 2 + 0.5, HANDLE_SIZE, HANDLE_SIZE);
  }

  // Anchor point marker.
  const anchorWorld = applyToPoint(
    worldMatrix(comp, layer, time),
    valueAtTime(layer.transform.anchorPoint, time),
  );
  const [ax, ay] = toScreen(anchorWorld);
  ctx.strokeStyle = '#ffd24a';
  ctx.beginPath();
  ctx.arc(ax, ay, 5, 0, Math.PI * 2);
  ctx.moveTo(ax - 8, ay);
  ctx.lineTo(ax + 8, ay);
  ctx.moveTo(ax, ay - 8);
  ctx.lineTo(ax, ay + 8);
  ctx.stroke();
  ctx.restore();
}

/** Four corners followed by four edge midpoints (indices 4..7). */
function handlePoints(corners: Vec2[]): Vec2[] {
  const mid = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return [
    corners[0], corners[1], corners[2], corners[3],
    mid(corners[0], corners[1]),
    mid(corners[1], corners[2]),
    mid(corners[2], corners[3]),
    mid(corners[3], corners[0]),
  ];
}

/** Motion-path tangent handle under a point, if any. */
function findSpatialHandle(
  comp: Composition,
  selectedLayerIds: string[],
  point: Vec2,
  time: number,
  zoom: number,
): {
  ref: KeyframeRef; side: 'in' | 'out'; keyValue: Vec2; parent: Matrix;
} | undefined {
  const tolerance = 7 / zoom;
  for (const id of selectedLayerIds) {
    const layer = findLayer(comp, id);
    const position = layer?.transform.position;
    if (!layer || !position?.animated || position.separated) continue;

    const parent = parentMatrix(comp, layer, time);
    const kfs = position.keyframes as Keyframe<Vec2>[];
    for (let index = 0; index < kfs.length; index += 1) {
      const kf = kfs[index];
      for (const side of ['in', 'out'] as const) {
        const tangent = side === 'out'
          ? spatialOutTangent(kfs, index)
          : spatialInTangent(kfs, index);
        if (Math.abs(tangent[0]) < 1e-6 && Math.abs(tangent[1]) < 1e-6) continue;
        const world = applyToPoint(parent, [
          kf.value[0] + tangent[0], kf.value[1] + tangent[1],
        ]);
        if (Math.hypot(world[0] - point[0], world[1] - point[1]) <= tolerance) {
          return {
            ref: { layerId: layer.id, path: 'transform.position', kfId: kf.id },
            side,
            keyValue: kf.value,
            parent,
          };
        }
      }
    }
  }
  return undefined;
}

function findHandle(
  comp: Composition,
  selectedLayerIds: string[],
  point: Vec2,
  time: number,
  zoom: number,
): { layerId: string; index: number } | undefined {
  const tolerance = (HANDLE_SIZE + 3) / zoom / 2;
  for (const id of selectedLayerIds) {
    const layer = findLayer(comp, id);
    if (!layer) continue;
    const points = handlePoints(layerCorners(comp, layer, time));
    for (let i = 0; i < points.length; i += 1) {
      const [hx, hy] = points[i];
      if (Math.abs(point[0] - hx) <= tolerance && Math.abs(point[1] - hy) <= tolerance) {
        return { layerId: id, index: i };
      }
    }
  }
  return undefined;
}
