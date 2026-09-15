import { create } from 'zustand';
import {
  addLayer, clampTimeToComp, createComposition, findLayer, layerIndex, moveLayer,
  removeLayer, uniqueLayerName,
} from '@/core/composition';
import {
  allProperties, createAdjustmentLayer, createMask, createMediaLayer, createNullLayer,
  createPrecompLayer, createShapeLayer, createSolidLayer, createTextLayer,
  enableTimeRemap, getProperty, layerBounds, wouldCreateCycle,
} from '@/core/layer';
import {
  createEllipseShape, createFill, createOffsetPaths, createPathShape, createRectShape,
  createRepeater, createShapeGroup, createStarShape, createStroke, createTrimPaths,
} from '@/core/shapes';
import { createRangeSelector, createTextAnimator } from '@/core/text';
import { uid } from '@/core/uid';
import {
  probeFootageFile, registerFootage, releaseAllFootage, releaseFootage,
} from '@/render/assets';
import {
  deleteFootage, presentFootageIds, readFootage, writeFootage,
} from '@/state/persistence';
import { createEffectInstance } from '@/render/effects';
import { applyBezierToSegment, bakeIntoSegment, loadCustomPresets, saveCustomPresets } from '@/core/easings';
import type { EasingPreset } from '@/core/easings';
import { applyEasyEase, enforceTangentMode } from '@/core/interpolation';
import {
  addKeyframe, applyRoving, clampToRange, findKeyframeAt, hexToRgba, mergeDimensions,
  moveKeyframe, removeKeyframe, separateDimensions, setAnimated, setRoving,
  setValueAtTime, valueAtTime,
} from '@/core/property';
import { ellipsePath, isBezierPath, rectPath } from '@/core/path';
import type { BezierPath } from '@/core/path';
import { expressionErrors as collectExpressionErrors, setExpressionContext } from '@/core/expressions';
import { activeComposition, createStarterProject } from '@/core/project';
import { spatialInTangent, spatialOutTangent } from '@/core/spatial';
import { snapToFrame } from '@/core/time';
import type {
  BlendMode, Composition, Ease, FootageAsset, Id, InterpolationType, Keyframe, Layer,
  Mask, Project, Property, PropertyValue, RGBA, ShapeItem, SpatialType,
  TangentMode, TextAnimatorProperties, TrackMatteType, Vec2,
} from '@/core/types';

/** How long two edits may be apart and still collapse into one undo step. */
const COALESCE_WINDOW_MS = 700;
const HISTORY_LIMIT = 200;

export type Tool =
  | 'selection' | 'hand' | 'zoom' | 'rotation' | 'pen' | 'text'
  | 'rect' | 'ellipse' | 'anchor';

export interface KeyframeRef {
  layerId: Id;
  path: string;
  kfId: Id;
}

export interface PropertyRef {
  layerId: Id;
  path: string;
}

export interface GraphSettings {
  /** Value graph plots the property; speed graph plots its rate of change. */
  mode: 'value' | 'speed';
  /** Fit every curve to its own range so mixed units share the view. */
  normalize: boolean;
  /** Re-fit the vertical range whenever the curves change. */
  autoZoom: boolean;
  /** Snap dragged keyframes to whole frames. */
  snap: boolean;
  /** Show the easing preset bar. */
  showPresets: boolean;
}

/** A copied keyframe, stored relative to the earliest one in the copy. */
interface ClipboardEntry {
  /** Seconds after the earliest keyframe in the copy. */
  offset: number;
  keyframe: Keyframe;
}

interface HistoryEntry {
  label: string;
  project: Project;
}

interface ViewerState {
  zoom: number;
  /** Pan offset in screen pixels. */
  panX: number;
  panY: number;
  fitOnResize: boolean;
  showTransparencyGrid: boolean;
  showGuides: boolean;
  /** 1 = full, 2 = half, 4 = quarter. */
  resolution: number;
}

interface MutateOptions {
  /** Edits sharing a key inside the coalesce window collapse into one undo step. */
  coalesceKey?: string;
}

export interface EditorState {
  project: Project;
  past: HistoryEntry[];
  future: HistoryEntry[];
  lastCoalesceKey: string | null;
  lastMutateAt: number;

  time: number;
  playing: boolean;
  loopPlayback: boolean;

  selectedLayerIds: Id[];
  selectedKeyframes: KeyframeRef[];
  selectedProperties: PropertyRef[];
  /** Property paths revealed per layer in the timeline. */
  revealed: Record<Id, string[]>;
  expanded: Record<Id, boolean>;
  graph: GraphSettings;
  customPresets: EasingPreset[];
  clipboard: ClipboardEntry[];

  tool: Tool;
  viewer: ViewerState;
  timeDisplay: 'timecode' | 'frames';
  graphEditor: boolean;
  statusMessage: string | null;
  /** Expression errors from the last rendered frame, keyed by property id. */
  expressionErrors: Record<Id, string>;
  /** Name of the open modal dialog, if any. */
  dialog:
    | 'compSettings' | 'shortcuts' | 'about' | 'velocity' | 'interpolation'
    | 'effects' | 'export' | 'solidSettings' | null;

  // -- document mutation ---------------------------------------------------
  mutate: (label: string, recipe: (project: Project) => void, options?: MutateOptions) => void;
  mutateComp: (label: string, recipe: (comp: Composition) => void, options?: MutateOptions) => void;
  undo: () => void;
  redo: () => void;

  // -- transport -----------------------------------------------------------
  setTime: (time: number, snap?: boolean) => void;
  stepFrames: (frames: number) => void;
  goToStart: () => void;
  goToEnd: () => void;
  togglePlay: () => void;
  setPlaying: (playing: boolean) => void;

  // -- selection -----------------------------------------------------------
  selectLayer: (id: Id, additive?: boolean) => void;
  selectLayers: (ids: Id[]) => void;
  deselectAll: () => void;
  selectAllLayers: () => void;
  setSelectedKeyframes: (refs: KeyframeRef[]) => void;
  toggleKeyframeSelection: (ref: KeyframeRef, additive: boolean) => void;
  selectProperty: (ref: PropertyRef, additive: boolean) => void;
  selectAllKeyframesOf: (ref: PropertyRef) => void;

  // -- layers --------------------------------------------------------------
  addSolid: (color?: RGBA) => void;
  addNull: () => void;
  addText: (source?: string) => void;
  addAdjustment: () => void;
  duplicateSelected: () => void;
  deleteSelected: () => void;
  renameLayer: (id: Id, name: string) => void;
  reorderLayer: (id: Id, toIndex: number) => void;
  setParent: (id: Id, parentId: Id | null) => void;
  toggleSwitch: (id: Id, key: 'enabled' | 'solo' | 'shy' | 'locked' | 'motionBlur') => void;
  setBlendMode: (id: Id, mode: BlendMode) => void;
  setLayerInPoint: (id: Id, time: number) => void;
  setLayerOutPoint: (id: Id, time: number) => void;
  centerAnchorInContent: () => void;
  splitLayer: () => void;
  setTrackMatte: (id: Id, type: TrackMatteType) => void;

  // -- masks ---------------------------------------------------------------
  addMask: (layerId: Id, shape: 'rect' | 'ellipse', bounds?: { centre: Vec2; size: Vec2 }) => void;
  addMaskFromPath: (layerId: Id, path: BezierPath) => void;
  deleteMask: (layerId: Id, maskIndex: number) => void;
  updateMask: (layerId: Id, maskIndex: number, patch: Partial<Omit<Mask, 'id' | 'path'>>) => void;
  setMaskPath: (layerId: Id, maskIndex: number, path: BezierPath, coalesceKey?: string) => void;

  // -- shape layers --------------------------------------------------------
  addShapeLayer: (kind: 'rect' | 'ellipse' | 'star' | 'polygon' | 'empty') => void;
  addShapeLayerAt: (kind: 'rect' | 'ellipse', centre: Vec2, size: Vec2) => void;
  addShapeLayerFromPath: (path: BezierPath) => void;
  addShapeItem: (layerId: Id, kind: 'fill' | 'stroke' | 'trim' | 'repeater' | 'offset') => void;
  removeShapeItem: (layerId: Id, path: string) => void;

  // -- footage ---------------------------------------------------------------
  importFootage: (files: FileList | File[]) => Promise<void>;
  /** Open the system file picker, then import whatever was chosen. */
  promptImportFootage: () => Promise<void>;
  removeFootage: (assetId: Id) => Promise<void>;
  relinkFootage: (assetId: Id) => Promise<void>;
  addFootageToComp: (assetId: Id) => void;
  loadProjectFootage: () => Promise<void>;

  // -- precomps and time -----------------------------------------------------
  precompose: (name?: string) => void;
  toggleTimeRemap: (layerId: Id) => void;
  openPrecompSource: (layerId: Id) => void;
  trimCompToWorkArea: () => void;

  // -- expressions ---------------------------------------------------------
  setExpression: (layerId: Id, path: string, source: string | null) => void;
  toggleExpression: (layerId: Id, path: string) => void;

  // -- effects -------------------------------------------------------------
  addEffect: (layerId: Id, matchName: string) => void;
  removeEffect: (layerId: Id, index: number) => void;
  toggleEffect: (layerId: Id, index: number) => void;
  moveEffect: (layerId: Id, index: number, delta: number) => void;
  removeAllEffects: () => void;

  // -- text animators ------------------------------------------------------
  addTextAnimator: (layerId: Id) => void;
  addRangeSelector: (layerId: Id, animatorIndex: number) => void;
  toggleAnimatorProperty: (
    layerId: Id, animatorIndex: number, key: keyof TextAnimatorProperties['enabled'],
  ) => void;
  setSelectorOption: (
    layerId: Id, animatorIndex: number, selectorIndex: number,
    patch: { shape?: string; units?: string; mode?: string },
  ) => void;

  // -- properties and keyframes -------------------------------------------
  setPropertyValue: (layerId: Id, path: string, value: PropertyValue, coalesceKey?: string) => void;
  toggleStopwatch: (layerId: Id, path: string) => void;
  toggleKeyframeAt: (layerId: Id, path: string) => void;
  addKeyframeForRevealed: () => void;
  deleteSelectedKeyframes: () => void;
  nudgeSelectedKeyframes: (deltaTime: number, coalesceKey?: string) => void;
  setKeyframeTime: (ref: KeyframeRef, time: number, coalesceKey?: string) => void;
  moveKeyframesTo: (entries: { ref: KeyframeRef; time: number }[], coalesceKey?: string) => void;
  applyEasyEaseToSelection: (side?: 'in' | 'out' | 'both') => void;
  setSelectedInterpolation: (type: InterpolationType, side?: 'in' | 'out' | 'both') => void;
  setKeyframeEase: (ref: KeyframeRef, side: 'in' | 'out', ease: Ease) => void;
  setKeyframeValue: (ref: KeyframeRef, value: PropertyValue, coalesceKey?: string) => void;
  setSelectedTangentMode: (mode: TangentMode) => void;
  setSelectedRoving: (roving: boolean) => void;
  setSelectedSpatialType: (type: SpatialType) => void;
  setSpatialTangent: (ref: KeyframeRef, side: 'in' | 'out', tangent: Vec2, coalesceKey?: string) => void;
  toggleSeparateDimensions: (layerId: Id, path: string) => void;
  copyKeyframes: () => void;
  pasteKeyframes: () => void;
  applyEasingPreset: (preset: EasingPreset) => void;
  setGraph: (patch: Partial<GraphSettings>) => void;
  saveCustomPreset: (preset: EasingPreset) => void;
  removeCustomPreset: (id: string) => void;
  renameCustomPreset: (id: string, name: string) => void;
  moveCustomPreset: (id: string, delta: number) => void;
  goToNextKeyframe: () => void;
  goToPrevKeyframe: () => void;

  // -- timeline / panels ---------------------------------------------------
  revealProperties: (revealKey: string, additive: boolean) => void;
  revealAnimated: () => void;
  revealModified: () => void;
  revealExpressions: () => void;
  revealAll: (layerId: Id) => void;
  revealEffects: (layerId: Id) => void;
  toggleExpanded: (id: Id) => void;
  setTool: (tool: Tool) => void;
  setViewer: (patch: Partial<ViewerState>) => void;
  setTimeDisplay: (mode: 'timecode' | 'frames') => void;
  toggleGraphEditor: () => void;
  setStatus: (message: string | null) => void;
  openDialog: (dialog: EditorState['dialog']) => void;
  refreshExpressionErrors: () => void;

  // -- composition ---------------------------------------------------------
  newComposition: () => void;
  setActiveComp: (id: Id) => void;
  updateCompSettings: (patch: Partial<Composition>) => void;
  setWorkAreaStart: (time: number) => void;
  setWorkAreaEnd: (time: number) => void;
  loadProject: (project: Project) => void;
}

function currentComp(project: Project): Composition | undefined {
  return activeComposition(project);
}

/**
 * Expressions resolve other layers by name and index, so the engine needs to
 * be looking at the same document the editor is.
 */
function syncExpressions(project: Project): Project {
  const comp = activeComposition(project);
  if (comp) setExpressionContext(project, comp);
  return project;
}

export const useEditor = create<EditorState>()((set, get) => ({
  project: syncExpressions(createStarterProject()),
  past: [],
  future: [],
  lastCoalesceKey: null,
  lastMutateAt: 0,

  time: 0,
  playing: false,
  loopPlayback: true,

  selectedLayerIds: [],
  selectedKeyframes: [],
  selectedProperties: [],
  revealed: {},
  expanded: {},
  graph: {
    mode: 'value',
    normalize: true,
    autoZoom: true,
    snap: true,
    showPresets: true,
  },
  customPresets: loadCustomPresets(),
  clipboard: [],

  tool: 'selection',
  viewer: {
    zoom: 1,
    panX: 0,
    panY: 0,
    fitOnResize: true,
    showTransparencyGrid: false,
    showGuides: true,
    resolution: 1,
  },
  timeDisplay: 'timecode',
  graphEditor: false,
  statusMessage: null,
  expressionErrors: {},
  dialog: null,

  mutate: (label, recipe, options = {}) => {
    const state = get();
    const now = Date.now();
    const coalesce =
      options.coalesceKey !== undefined &&
      options.coalesceKey === state.lastCoalesceKey &&
      now - state.lastMutateAt < COALESCE_WINDOW_MS;

    const next = structuredClone(state.project);
    recipe(next);

    const past = coalesce
      ? state.past
      : [...state.past, { label, project: state.project }].slice(-HISTORY_LIMIT);

    set({
      project: syncExpressions(next),
      past,
      future: [],
      lastCoalesceKey: options.coalesceKey ?? null,
      lastMutateAt: now,
    });
  },

  mutateComp: (label, recipe, options) => {
    get().mutate(label, (project) => {
      const comp = currentComp(project);
      if (comp) recipe(comp);
    }, options);
  },

  undo: () => {
    const { past, future, project } = get();
    const entry = past[past.length - 1];
    if (!entry) return;
    set({
      project: syncExpressions(entry.project),
      past: past.slice(0, -1),
      future: [...future, { label: entry.label, project }],
      lastCoalesceKey: null,
      statusMessage: `Undo: ${entry.label}`,
    });
  },

  redo: () => {
    const { past, future, project } = get();
    const entry = future[future.length - 1];
    if (!entry) return;
    set({
      project: syncExpressions(entry.project),
      future: future.slice(0, -1),
      past: [...past, { label: entry.label, project }],
      lastCoalesceKey: null,
      statusMessage: `Redo: ${entry.label}`,
    });
  },

  setTime: (time, snap = true) => {
    const comp = currentComp(get().project);
    if (!comp) return;
    const clamped = clampTimeToComp(comp, time);
    set({ time: snap ? snapToFrame(clamped, comp.frameRate) : clamped });
  },

  stepFrames: (frames) => {
    const comp = currentComp(get().project);
    if (!comp) return;
    get().setTime(get().time + frames / comp.frameRate);
  },

  goToStart: () => get().setTime(0),

  goToEnd: () => {
    const comp = currentComp(get().project);
    if (!comp) return;
    get().setTime(comp.duration - 1 / comp.frameRate);
  },

  togglePlay: () => set({ playing: !get().playing }),
  setPlaying: (playing) => set({ playing }),

  selectLayer: (id, additive = false) => {
    const { selectedLayerIds } = get();
    if (!additive) {
      set({ selectedLayerIds: [id], selectedKeyframes: [] });
      return;
    }
    set({
      selectedLayerIds: selectedLayerIds.includes(id)
        ? selectedLayerIds.filter((l) => l !== id)
        : [...selectedLayerIds, id],
    });
  },

  selectLayers: (ids) => set({ selectedLayerIds: ids, selectedKeyframes: [] }),
  deselectAll: () => set({ selectedLayerIds: [], selectedKeyframes: [] }),

  selectAllLayers: () => {
    const comp = currentComp(get().project);
    if (comp) set({ selectedLayerIds: comp.layers.map((l) => l.id) });
  },

  setSelectedKeyframes: (refs) => set({ selectedKeyframes: refs }),

  selectProperty: (ref, additive) => {
    const { selectedProperties } = get();
    const exists = selectedProperties.some(
      (p) => p.layerId === ref.layerId && p.path === ref.path,
    );
    set({
      selectedProperties: additive
        ? (exists
          ? selectedProperties.filter((p) => !(p.layerId === ref.layerId && p.path === ref.path))
          : [...selectedProperties, ref])
        : [ref],
      selectedLayerIds: get().selectedLayerIds.includes(ref.layerId)
        ? get().selectedLayerIds
        : [ref.layerId],
    });
  },

  selectAllKeyframesOf: (ref) => {
    const comp = currentComp(get().project);
    const prop = comp && propertyFor(comp, ref);
    if (!prop) return;
    set({
      selectedKeyframes: prop.keyframes.map((kf) => ({ ...ref, kfId: kf.id })),
      selectedProperties: [ref],
    });
  },

  toggleKeyframeSelection: (ref, additive) => {
    const { selectedKeyframes } = get();
    const exists = selectedKeyframes.some((k) => k.kfId === ref.kfId);
    if (!additive) {
      set({ selectedKeyframes: [ref], selectedLayerIds: [ref.layerId] });
      return;
    }
    set({
      selectedKeyframes: exists
        ? selectedKeyframes.filter((k) => k.kfId !== ref.kfId)
        : [...selectedKeyframes, ref],
    });
  },

  addSolid: (color) => {
    const comp = currentComp(get().project);
    if (!comp) return;
    const chosen = color ?? hexToRgba(randomSolidColor());
    let newId: Id | null = null;
    get().mutateComp('New Solid', (c) => {
      const layer = addLayer(c, createSolidLayer(c, 'Medium Solid 1', chosen));
      newId = layer.id;
    });
    if (newId) get().selectLayer(newId);
  },

  addNull: () => {
    let newId: Id | null = null;
    get().mutateComp('New Null Object', (c) => {
      newId = addLayer(c, createNullLayer(c)).id;
    });
    if (newId) get().selectLayer(newId);
  },

  addText: (source = 'Text') => {
    let newId: Id | null = null;
    get().mutateComp('New Text Layer', (c) => {
      newId = addLayer(c, createTextLayer(c, source)).id;
    });
    if (newId) get().selectLayer(newId);
  },

  addAdjustment: () => {
    let newId: Id | null = null;
    get().mutateComp('New Adjustment Layer', (c) => {
      newId = addLayer(c, createAdjustmentLayer(c)).id;
    });
    if (newId) get().selectLayer(newId);
  },

  duplicateSelected: () => {
    const ids = get().selectedLayerIds;
    if (ids.length === 0) return;
    const created: Id[] = [];
    get().mutateComp('Duplicate', (c) => {
      for (const id of ids) {
        const index = layerIndex(c, id);
        const source = c.layers[index];
        if (!source) continue;
        const copy = structuredClone(source);
        copy.id = `${source.id}_copy_${Math.random().toString(36).slice(2, 7)}`;
        reidentify(copy);
        copy.name = uniqueLayerName(c, source.name);
        c.layers.splice(index, 0, copy);
        created.push(copy.id);
      }
    });
    if (created.length) set({ selectedLayerIds: created, selectedKeyframes: [] });
  },

  deleteSelected: () => {
    const { selectedLayerIds } = get();
    if (selectedLayerIds.length === 0) return;
    get().mutateComp('Delete Layer', (c) => {
      for (const id of selectedLayerIds) removeLayer(c, id);
    });
    set({ selectedLayerIds: [], selectedKeyframes: [] });
  },

  renameLayer: (id, name) => {
    get().mutateComp('Rename Layer', (c) => {
      const layer = findLayer(c, id);
      if (layer) layer.name = name;
    });
  },

  reorderLayer: (id, toIndex) => {
    get().mutateComp('Reorder Layer', (c) => moveLayer(c, id, toIndex));
  },

  setParent: (id, parentId) => {
    const comp = currentComp(get().project);
    if (!comp || (parentId && wouldCreateCycle(comp, id, parentId))) {
      set({ statusMessage: 'That parent would create a loop.' });
      return;
    }
    get().mutateComp('Set Parent', (c) => {
      const layer = findLayer(c, id);
      if (layer) layer.parentId = parentId;
    });
  },

  toggleSwitch: (id, key) => {
    get().mutateComp('Toggle Switch', (c) => {
      const layer = findLayer(c, id);
      if (layer) layer[key] = !layer[key];
    });
  },

  setBlendMode: (id, mode) => {
    get().mutateComp('Set Blend Mode', (c) => {
      const layer = findLayer(c, id);
      if (layer) layer.blendMode = mode;
    });
  },

  setLayerInPoint: (id, time) => {
    get().mutateComp('Set In Point', (c) => {
      const layer = findLayer(c, id);
      if (layer) layer.inPoint = Math.min(time, layer.outPoint - 1 / c.frameRate);
    }, { coalesceKey: `in:${id}` });
  },

  setLayerOutPoint: (id, time) => {
    get().mutateComp('Set Out Point', (c) => {
      const layer = findLayer(c, id);
      if (layer) layer.outPoint = Math.max(time, layer.inPoint + 1 / c.frameRate);
    }, { coalesceKey: `out:${id}` });
  },

  centerAnchorInContent: () => {
    const { selectedLayerIds, time } = get();
    get().mutateComp('Center Anchor Point', (c) => {
      for (const id of selectedLayerIds) {
        const layer = findLayer(c, id);
        if (!layer) continue;
        const oldAnchor = valueAtTime(layer.transform.anchorPoint, time);
        const newAnchor: [number, number] = [layer.width / 2, layer.height / 2];
        const scale = valueAtTime(layer.transform.scale, time);
        const rot = (valueAtTime(layer.transform.rotation, time) * Math.PI) / 180;
        // Keep the layer visually put: shift position by the anchor delta,
        // transformed by the layer's own rotation and scale.
        const dx = (newAnchor[0] - oldAnchor[0]) * (scale[0] / 100);
        const dy = (newAnchor[1] - oldAnchor[1]) * (scale[1] / 100);
        const pos = valueAtTime(layer.transform.position, time);
        setValueAtTime(layer.transform.anchorPoint, time, newAnchor);
        setValueAtTime(layer.transform.position, time, [
          pos[0] + dx * Math.cos(rot) - dy * Math.sin(rot),
          pos[1] + dx * Math.sin(rot) + dy * Math.cos(rot),
        ]);
      }
    });
  },

  splitLayer: () => {
    const { selectedLayerIds, time } = get();
    if (selectedLayerIds.length === 0) return;
    get().mutateComp('Split Layer', (c) => {
      for (const id of selectedLayerIds) {
        const index = layerIndex(c, id);
        const layer = c.layers[index];
        if (!layer || time <= layer.inPoint || time >= layer.outPoint) continue;
        const copy = structuredClone(layer);
        copy.id = `${layer.id}_split_${Math.random().toString(36).slice(2, 7)}`;
        reidentify(copy);
        copy.name = uniqueLayerName(c, layer.name);
        // The copy takes the tail; the original keeps the head.
        copy.inPoint = time;
        layer.outPoint = time;
        c.layers.splice(index, 0, copy);
      }
    });
  },

  setTrackMatte: (id, type) => {
    get().mutateComp('Set Track Matte', (c) => {
      const layer = findLayer(c, id);
      if (layer) layer.trackMatte = type;
    });
  },

  addMask: (layerId, shape, bounds) => {
    get().mutateComp('New Mask', (c) => {
      const layer = findLayer(c, layerId);
      if (!layer) return;
      const box = layerBounds(layer);
      const centre: Vec2 = bounds?.centre ?? [box.x + box.width / 2, box.y + box.height / 2];
      const size: Vec2 = bounds?.size ?? [box.width, box.height];
      const path = shape === 'ellipse' ? ellipsePath(centre, size) : rectPath(centre, size);
      layer.masks.push(createMask(layer, path));
    });
    get().revealProperties('m', true);
  },

  addMaskFromPath: (layerId, path) => {
    get().mutateComp('New Mask', (c) => {
      const layer = findLayer(c, layerId);
      if (layer) layer.masks.push(createMask(layer, path));
    });
    get().revealProperties('m', true);
  },

  deleteMask: (layerId, maskIndex) => {
    get().mutateComp('Delete Mask', (c) => {
      const layer = findLayer(c, layerId);
      if (layer) layer.masks.splice(maskIndex, 1);
    });
    set({ selectedKeyframes: [], selectedProperties: [] });
  },

  updateMask: (layerId, maskIndex, patch) => {
    get().mutateComp('Mask Settings', (c) => {
      const mask = findLayer(c, layerId)?.masks[maskIndex];
      if (mask) Object.assign(mask, patch);
    });
  },

  setMaskPath: (layerId, maskIndex, path, coalesceKey) => {
    const time = get().time;
    get().mutateComp('Edit Mask Path', (c) => {
      const mask = findLayer(c, layerId)?.masks[maskIndex];
      if (mask) setValueAtTime(mask.path, time, path);
    }, coalesceKey ? { coalesceKey } : undefined);
  },

  addShapeLayer: (kind) => {
    const comp = currentComp(get().project);
    if (!comp) return;
    let newId: Id | null = null;
    get().mutateComp('New Shape Layer', (c) => {
      const layer = createShapeLayer(c);
      const fill = createFill(hexToRgba(randomSolidColor()));
      const size: Vec2 = [Math.min(400, c.width / 3), Math.min(400, c.height / 3)];
      if (kind === 'rect') {
        layer.contents = [createShapeGroup([createRectShape(size), fill], 'Rectangle 1')];
      } else if (kind === 'ellipse') {
        layer.contents = [createShapeGroup([createEllipseShape(size), fill], 'Ellipse 1')];
      } else if (kind === 'star' || kind === 'polygon') {
        layer.contents = [
          createShapeGroup([createStarShape(kind === 'star'), fill],
            kind === 'star' ? 'Star 1' : 'Polygon 1'),
        ];
      }
      // Shape contents sit around the layer origin, so the origin goes centre-frame.
      layer.transform.position.value = [c.width / 2, c.height / 2];
      addLayer(c, layer);
      newId = layer.id;
    });
    if (newId) {
      get().selectLayer(newId);
      get().toggleExpanded(newId);
    }
  },

  addShapeLayerAt: (kind, centre, size) => {
    let newId: Id | null = null;
    get().mutateComp('New Shape Layer', (c) => {
      const layer = createShapeLayer(c);
      const fill = createFill(hexToRgba(randomSolidColor()));
      const item = kind === 'ellipse'
        ? createEllipseShape(size)
        : createRectShape(size);
      layer.contents = [createShapeGroup(
        [item, fill], kind === 'ellipse' ? 'Ellipse 1' : 'Rectangle 1',
      )];
      // The drawn centre becomes the layer position, so the shape sits at the origin.
      layer.transform.position.value = centre;
      addLayer(c, layer);
      newId = layer.id;
    });
    if (newId) {
      get().selectLayer(newId);
      get().toggleExpanded(newId);
    }
  },

  addShapeLayerFromPath: (path) => {
    let newId: Id | null = null;
    get().mutateComp('New Shape Layer', (c) => {
      const layer = createShapeLayer(c);
      layer.contents = [createShapeGroup(
        [createPathShape(path), createFill(hexToRgba(randomSolidColor()))], 'Shape 1',
      )];
      addLayer(c, layer);
      newId = layer.id;
    });
    if (newId) {
      get().selectLayer(newId);
      get().toggleExpanded(newId);
    }
  },

  addShapeItem: (layerId, kind) => {
    get().mutateComp('Add Shape Item', (c) => {
      const layer = findLayer(c, layerId);
      if (!layer || layer.type !== 'shape') return;
      const item: ShapeItem = kind === 'fill' ? createFill([1, 1, 1, 1])
        : kind === 'stroke' ? createStroke([1, 1, 1, 1])
          : kind === 'trim' ? createTrimPaths()
            : kind === 'repeater' ? createRepeater() : createOffsetPaths();

      // Styles and modifiers join the first group, where the paths live.
      const group = layer.contents.find((content) => content.type === 'group');
      if (group && group.type === 'group') group.items.push(item);
      else layer.contents.push(item);
    });
    get().revealAll(layerId);
  },


  removeShapeItem: (layerId, path) => {
    get().mutateComp('Delete Shape Item', (c) => {
      const layer = findLayer(c, layerId);
      if (!layer || layer.type !== 'shape') return;
      const parts = path.split('.');
      const index = Number(parts[parts.length - 1]);
      const parentPath = parts.slice(0, -1).join('.');
      const parent = parentPath === 'contents'
        ? layer.contents
        : (getByPath(layer, parentPath) as ShapeItem[] | undefined);
      if (Array.isArray(parent)) parent.splice(index, 1);
    });
    set({ selectedProperties: [], selectedKeyframes: [] });
  },

  importFootage: async (files) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    let imported = 0;
    const failures: string[] = [];

    for (const file of list) {
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
        failures.push(`${file.name} is not an image or a video`);
        continue;
      }
      try {
        const probed = await probeFootageFile(file);
        const asset: FootageAsset = { ...probed, id: uid('asset') };
        // Store the bytes first: an asset the browser cannot keep is worse
        // than one that never appeared.
        await writeFootage(asset.id, file);
        await registerFootage(asset, file);
        get().mutate('Import Footage', (project) => { project.footage.push(asset); });
        imported += 1;
      } catch (error) {
        failures.push(error instanceof Error ? error.message : `${file.name} could not be read`);
      }
    }

    set({
      statusMessage: failures.length > 0
        ? `Imported ${imported}; ${failures[0]}${failures.length > 1 ? ` (+${failures.length - 1} more)` : ''}.`
        : `Imported ${imported} item${imported === 1 ? '' : 's'}.`,
    });
  },

  promptImportFootage: async () => {
    const files = await pickFiles('image/*,video/*');
    if (files.length > 0) await get().importFootage(files);
  },

  removeFootage: async (assetId) => {
    const comp = currentComp(get().project);
    const used = comp?.layers.some((l) => l.type === 'media' && l.assetId === assetId);
    get().mutate('Remove Footage', (project) => {
      project.footage = project.footage.filter((asset) => asset.id !== assetId);
      // Layers pointing at footage that is gone would render nothing, so
      // they go with it.
      for (const composition of project.compositions) {
        composition.layers = composition.layers.filter(
          (layer) => !(layer.type === 'media' && layer.assetId === assetId),
        );
      }
    });
    releaseFootage(assetId);
    await deleteFootage(assetId);
    set({
      selectedLayerIds: [],
      statusMessage: used ? 'Removed the footage and the layers using it.' : 'Removed the footage.',
    });
  },

  relinkFootage: async (assetId) => {
    const asset = get().project.footage.find((item) => item.id === assetId);
    if (!asset) return;

    const file = await pickFile(asset.kind === 'video' ? 'video/*' : 'image/*');
    if (!file) return;
    try {
      const probed = await probeFootageFile(file);
      await writeFootage(assetId, file);
      await registerFootage({ ...asset, ...probed, id: assetId }, file);
      get().mutate('Relink Footage', (project) => {
        const target = project.footage.find((item) => item.id === assetId);
        if (!target) return;
        // Keep the id and the layers that reference it; take the new file's
        // measurements, since a relink is often to a different render.
        Object.assign(target, probed, { id: assetId, missing: false });
      });
      set({ statusMessage: `Relinked ${asset.name} to ${file.name}.` });
    } catch (error) {
      set({ statusMessage: error instanceof Error ? error.message : 'Could not relink that file.' });
    }
  },

  addFootageToComp: (assetId) => {
    const asset = get().project.footage.find((item) => item.id === assetId);
    if (!asset) return;
    if (asset.missing) {
      set({ statusMessage: `${asset.name} is missing — relink it first.` });
      return;
    }
    let newId: Id | null = null;
    get().mutateComp('New Footage Layer', (c) => {
      newId = addLayer(c, createMediaLayer(c, asset)).id;
    });
    if (newId) get().selectLayer(newId);
  },

  loadProjectFootage: async () => {
    const assets = get().project.footage;
    releaseAllFootage();
    if (assets.length === 0) return;

    const present = await presentFootageIds(assets.map((asset) => asset.id));
    for (const asset of assets) {
      if (!present.has(asset.id)) continue;
      const blob = await readFootage(asset.id);
      if (!blob) continue;
      try {
        await registerFootage(asset, blob);
      } catch {
        present.delete(asset.id);
      }
    }

    // Anything the browser no longer holds is shown as missing rather than
    // quietly rendering nothing.
    const missing = assets.filter((asset) => !present.has(asset.id));
    if (missing.length > 0 || assets.some((asset) => asset.missing)) {
      get().mutate('Check Footage', (project) => {
        for (const asset of project.footage) asset.missing = !present.has(asset.id);
      });
    }
    if (missing.length > 0) {
      set({
        statusMessage: `${missing.length} footage item${missing.length === 1 ? ' is' : 's are'} missing — relink from the Project panel.`,
      });
    }
  },

  precompose: (name) => {
    const state = get();
    const comp = currentComp(state.project);
    if (!comp || state.selectedLayerIds.length === 0) {
      set({ statusMessage: 'Select layers to pre-compose.' });
      return;
    }

    let newLayerId: Id | null = null;
    get().mutate('Pre-compose', (project) => {
      const source = activeComposition(project);
      if (!source) return;

      const moving = source.layers.filter((l) => state.selectedLayerIds.includes(l.id));
      if (moving.length === 0) return;
      const topIndex = Math.min(...moving.map((l) => source.layers.indexOf(l)));

      const nested = createComposition({
        name: name ?? `${source.name} Comp ${project.compositions.length}`,
        width: source.width,
        height: source.height,
        frameRate: source.frameRate,
        duration: source.duration,
        bgColor: source.bgColor,
      });
      nested.layers = moving.map((l) => structuredClone(l));
      // Parenting to a layer left behind cannot survive the move.
      const movedIds = new Set(nested.layers.map((l) => l.id));
      for (const l of nested.layers) {
        if (l.parentId && !movedIds.has(l.parentId)) l.parentId = null;
      }
      project.compositions.push(nested);

      source.layers = source.layers.filter((l) => !state.selectedLayerIds.includes(l.id));
      for (const l of source.layers) {
        if (l.parentId && state.selectedLayerIds.includes(l.parentId)) l.parentId = null;
      }

      const layer = createPrecompLayer(source, nested);
      layer.name = nested.name;
      source.layers.splice(Math.min(topIndex, source.layers.length), 0, layer);
      newLayerId = layer.id;
    });

    if (newLayerId) get().selectLayer(newLayerId);
  },

  toggleTimeRemap: (layerId) => {
    const state = get();
    const comp = currentComp(state.project);
    const layer = comp && findLayer(comp, layerId);
    if (!layer) return;
    if (layer.type !== 'precomp' && layer.type !== 'media') {
      set({ statusMessage: 'Time Remapping applies to footage and pre-composition layers.' });
      return;
    }
    // A pre-comp's source is a composition; footage's source is the asset.
    const sourceDuration = layer.type === 'precomp'
      ? state.project.compositions.find((c) => c.id === layer.compId)?.duration
      : state.project.footage.find((a) => a.id === layer.assetId)?.duration;
    get().mutateComp(layer.timeRemap ? 'Disable Time Remapping' : 'Enable Time Remapping', (c) => {
      const target = findLayer(c, layerId);
      if (!target) return;
      if (target.timeRemap) target.timeRemap = null;
      else enableTimeRemap(target, sourceDuration ?? c.duration);
    });
    get().revealAll(layerId);
  },

  openPrecompSource: (layerId) => {
    const state = get();
    const comp = currentComp(state.project);
    const layer = comp && findLayer(comp, layerId);
    if (layer?.type !== 'precomp') return;
    get().setActiveComp(layer.compId);
  },

  trimCompToWorkArea: () => {
    get().mutateComp('Trim Composition to Work Area', (c) => {
      const start = c.workAreaStart;
      const end = c.workAreaEnd;
      c.duration = Math.max(1 / c.frameRate, end - start);
      for (const layer of c.layers) {
        layer.inPoint -= start;
        layer.outPoint -= start;
        layer.startTime -= start;
      }
      c.workAreaStart = 0;
      c.workAreaEnd = c.duration;
      for (const marker of c.markers) marker.time -= start;
    });
    set({ time: 0 });
  },

  setExpression: (layerId, path, source) => {
    get().mutateComp('Set Expression', (c) => {
      const layer = findLayer(c, layerId);
      const prop = layer && getProperty(layer, path);
      if (prop) prop.expression = source && source.trim() !== '' ? source : null;
    }, { coalesceKey: `expr:${layerId}:${path}` });
  },

  toggleExpression: (layerId, path) => {
    const comp = currentComp(get().project);
    const layer = comp && findLayer(comp, layerId);
    const prop = layer && getProperty(layer, path);
    if (!prop) return;
    // Alt-clicking the stopwatch starts an expression seeded with the
    // property's own value, which is what After Effects writes in.
    get().setExpression(layerId, path, prop.expression ? null : 'value');
    get().revealAll(layerId);
  },

  addEffect: (layerId, matchName) => {
    const instance = createEffectInstance(matchName);
    if (!instance) {
      set({ statusMessage: `No effect named ${matchName}.` });
      return;
    }
    get().mutateComp(`Apply ${instance.name}`, (c) => {
      const layer = findLayer(c, layerId);
      if (!layer) return;
      // A second copy of the same effect gets a numbered name, as in AE.
      const existing = layer.effects.filter((e) => e.matchName === matchName).length;
      const copy = structuredClone(instance);
      if (existing > 0) copy.name = `${instance.name} ${existing + 1}`;
      layer.effects.push(copy);
    });
    // Reveal the Effects group only. Opening the layer's whole property tree
    // would push the layers under it out of view, which reads as if they had
    // gone; AE shows the effect you just applied and leaves the rest alone.
    get().revealEffects(layerId);
    set({ statusMessage: `Applied ${instance.name}.` });
  },

  removeEffect: (layerId, index) => {
    get().mutateComp('Remove Effect', (c) => {
      const layer = findLayer(c, layerId);
      if (layer) layer.effects.splice(index, 1);
    });
    set({ selectedProperties: [], selectedKeyframes: [] });
  },

  toggleEffect: (layerId, index) => {
    get().mutateComp('Toggle Effect', (c) => {
      const effect = findLayer(c, layerId)?.effects[index];
      if (effect) effect.enabled = !effect.enabled;
    });
  },

  moveEffect: (layerId, index, delta) => {
    get().mutateComp('Reorder Effect', (c) => {
      const layer = findLayer(c, layerId);
      if (!layer) return;
      const target = index + delta;
      if (target < 0 || target >= layer.effects.length) return;
      const [effect] = layer.effects.splice(index, 1);
      layer.effects.splice(target, 0, effect);
    });
  },

  removeAllEffects: () => {
    const ids = get().selectedLayerIds;
    if (ids.length === 0) return;
    get().mutateComp('Remove All Effects', (c) => {
      for (const id of ids) {
        const layer = findLayer(c, id);
        if (layer) layer.effects = [];
      }
    });
    set({ selectedProperties: [], selectedKeyframes: [] });
  },

  addTextAnimator: (layerId) => {
    get().mutateComp('Add Text Animator', (c) => {
      const layer = findLayer(c, layerId);
      if (layer?.type === 'text') {
        layer.animators.push(createTextAnimator(`Animator ${layer.animators.length + 1}`));
      }
    });
    // A fresh animator has no keyframes yet, so reveal the whole tree rather
    // than only the animated rows.
    get().revealAll(layerId);
  },

  addRangeSelector: (layerId, animatorIndex) => {
    get().mutateComp('Add Range Selector', (c) => {
      const layer = findLayer(c, layerId);
      const animator = layer?.type === 'text' ? layer.animators[animatorIndex] : undefined;
      if (animator) {
        animator.selectors.push(
          createRangeSelector(`Range Selector ${animator.selectors.length + 1}`),
        );
      }
    });
    get().revealAll(layerId);
  },

  toggleAnimatorProperty: (layerId, animatorIndex, key) => {
    get().mutateComp('Animator Property', (c) => {
      const layer = findLayer(c, layerId);
      const animator = layer?.type === 'text' ? layer.animators[animatorIndex] : undefined;
      if (animator) animator.properties.enabled[key] = !animator.properties.enabled[key];
    });
    get().revealAll(layerId);
  },

  setSelectorOption: (layerId, animatorIndex, selectorIndex, patch) => {
    get().mutateComp('Selector Settings', (c) => {
      const layer = findLayer(c, layerId);
      const animator = layer?.type === 'text' ? layer.animators[animatorIndex] : undefined;
      const selector = animator?.selectors[selectorIndex];
      if (selector) Object.assign(selector, patch);
    });
  },

  setPropertyValue: (layerId, path, value, coalesceKey) => {
    const time = get().time;
    get().mutateComp('Set Value', (c) => {
      const layer = findLayer(c, layerId);
      if (!layer) return;
      const prop = getProperty(layer, path);
      if (prop) setValueAtTime(prop, time, value as never);
    }, coalesceKey ? { coalesceKey } : undefined);
  },

  toggleStopwatch: (layerId, path) => {
    const time = get().time;
    get().mutateComp('Toggle Animation', (c) => {
      const layer = findLayer(c, layerId);
      if (!layer) return;
      const prop = getProperty(layer, path);
      if (prop) setAnimated(prop, time, !prop.animated);
    });
  },

  toggleKeyframeAt: (layerId, path) => {
    const time = get().time;
    get().mutateComp('Toggle Keyframe', (c) => {
      const layer = findLayer(c, layerId);
      if (!layer) return;
      const prop = getProperty(layer, path);
      if (!prop) return;
      if (!prop.animated) {
        setAnimated(prop, time, true);
        return;
      }
      const existing = findKeyframeAt(prop, time);
      if (existing) removeKeyframe(prop, existing.id);
      else addKeyframe(prop, time);
    });
  },

  addKeyframeForRevealed: () => {
    const { selectedLayerIds, revealed, time } = get();
    get().mutateComp('Add Keyframe', (c) => {
      for (const id of selectedLayerIds) {
        const layer = findLayer(c, id);
        if (!layer) continue;
        for (const path of revealed[id] ?? []) {
          const prop = getProperty(layer, path);
          if (!prop) continue;
          if (!prop.animated) setAnimated(prop, time, true);
          else addKeyframe(prop, time);
        }
      }
    });
  },

  deleteSelectedKeyframes: () => {
    const refs = get().selectedKeyframes;
    if (refs.length === 0) return;
    get().mutateComp('Delete Keyframes', (c) => {
      for (const ref of refs) {
        const layer = findLayer(c, ref.layerId);
        const prop = layer && getProperty(layer, ref.path);
        if (prop) removeKeyframe(prop, ref.kfId);
      }
    });
    set({ selectedKeyframes: [] });
  },

  nudgeSelectedKeyframes: (deltaTime, coalesceKey) => {
    const refs = get().selectedKeyframes;
    if (refs.length === 0) return;
    get().mutateComp('Move Keyframes', (c) => {
      for (const ref of refs) {
        const layer = findLayer(c, ref.layerId);
        const prop = layer && getProperty(layer, ref.path);
        const kf = prop?.keyframes.find((k) => k.id === ref.kfId);
        if (prop && kf) moveKeyframe(prop, kf.id, kf.time + deltaTime);
      }
    }, coalesceKey ? { coalesceKey } : undefined);
  },

  setKeyframeTime: (ref, time, coalesceKey) => {
    get().mutateComp('Move Keyframe', (c) => {
      const layer = findLayer(c, ref.layerId);
      const prop = layer && getProperty(layer, ref.path);
      if (prop) moveKeyframe(prop, ref.kfId, time);
    }, coalesceKey ? { coalesceKey } : undefined);
  },

  moveKeyframesTo: (entries, coalesceKey) => {
    if (entries.length === 0) return;
    get().mutateComp('Move Keyframes', (c) => {
      for (const { ref, time } of entries) {
        const layer = findLayer(c, ref.layerId);
        const prop = layer && getProperty(layer, ref.path);
        if (prop) moveKeyframe(prop, ref.kfId, time);
      }
    }, coalesceKey ? { coalesceKey } : undefined);
  },

  applyEasyEaseToSelection: (side = 'both') => {
    const refs = get().selectedKeyframes;
    if (refs.length === 0) {
      set({ statusMessage: 'Select keyframes first.' });
      return;
    }
    get().mutateComp('Easy Ease', (c) => {
      for (const ref of refs) {
        const layer = findLayer(c, ref.layerId);
        const prop = layer && getProperty(layer, ref.path);
        const kf = prop?.keyframes.find((k) => k.id === ref.kfId);
        if (kf) applyEasyEase(kf, side);
      }
    });
  },

  setSelectedInterpolation: (type, side = 'both') => {
    const refs = get().selectedKeyframes;
    if (refs.length === 0) return;
    get().mutateComp('Keyframe Interpolation', (c) => {
      for (const ref of refs) {
        const prop = propertyFor(c, ref);
        const index = prop?.keyframes.findIndex((k) => k.id === ref.kfId) ?? -1;
        if (!prop || index < 0) continue;
        const kf = prop.keyframes[index];
        if (side === 'in' || side === 'both') kf.inType = type;
        if (side === 'out' || side === 'both') kf.outType = type;
        enforceTangentMode(prop.keyframes, index, side);
      }
    });
  },

  setKeyframeEase: (ref, side, ease) => {
    get().mutateComp('Keyframe Velocity', (c) => {
      const prop = propertyFor(c, ref);
      const index = prop?.keyframes.findIndex((k) => k.id === ref.kfId) ?? -1;
      if (!prop || index < 0) return;
      const kf = prop.keyframes[index];
      if (side === 'in') {
        kf.easeIn = ease;
        if (kf.inType !== 'hold') kf.inType = 'bezier';
      } else {
        kf.easeOut = ease;
        if (kf.outType !== 'hold') kf.outType = 'bezier';
      }
      enforceTangentMode(prop.keyframes, index, side);
    }, { coalesceKey: `ease:${ref.kfId}:${side}` });
  },

  setKeyframeValue: (ref, value, coalesceKey) => {
    get().mutateComp('Set Keyframe Value', (c) => {
      const prop = propertyFor(c, ref);
      const kf = prop?.keyframes.find((k) => k.id === ref.kfId);
      if (!prop || !kf) return;
      kf.value = clampToRange(prop, value);
      if (prop.keyframes.some((k) => k.roving)) applyRoving(prop);
    }, coalesceKey ? { coalesceKey } : undefined);
  },

  setSelectedTangentMode: (mode) => {
    const refs = get().selectedKeyframes;
    if (refs.length === 0) return;
    get().mutateComp('Keyframe Tangents', (c) => {
      for (const ref of refs) {
        const prop = propertyFor(c, ref);
        const index = prop?.keyframes.findIndex((k) => k.id === ref.kfId) ?? -1;
        if (!prop || index < 0) continue;
        prop.keyframes[index].tangentMode = mode;
        enforceTangentMode(prop.keyframes, index, 'both');
      }
    });
  },

  setSelectedRoving: (roving) => {
    const refs = get().selectedKeyframes;
    if (refs.length === 0) return;
    get().mutateComp('Rove Across Time', (c) => {
      for (const ref of refs) {
        const prop = propertyFor(c, ref);
        if (prop) setRoving(prop, ref.kfId, roving);
      }
    });
  },

  setSelectedSpatialType: (type) => {
    const refs = get().selectedKeyframes;
    if (refs.length === 0) return;
    get().mutateComp('Spatial Interpolation', (c) => {
      for (const ref of refs) {
        const prop = propertyFor(c, ref);
        const index = prop?.keyframes.findIndex((k) => k.id === ref.kfId) ?? -1;
        if (!prop?.spatial || index < 0) continue;
        const kf = prop.keyframes[index] as Keyframe<Vec2>;
        if (type === 'bezier' && kf.spatialType !== 'bezier') {
          // Seed the manual handles from whatever the path is doing now.
          kf.spatialOut = spatialOutTangent(prop.keyframes as Keyframe<Vec2>[], index);
          kf.spatialIn = spatialInTangent(prop.keyframes as Keyframe<Vec2>[], index);
        }
        kf.spatialType = type;
      }
    });
  },

  setSpatialTangent: (ref, side, tangent, coalesceKey) => {
    get().mutateComp('Edit Motion Path', (c) => {
      const prop = propertyFor(c, ref);
      const index = prop?.keyframes.findIndex((k) => k.id === ref.kfId) ?? -1;
      if (!prop || index < 0) return;
      const kfs = prop.keyframes as Keyframe<Vec2>[];
      const kf = kfs[index];
      const wasAuto = kf.spatialType !== 'bezier';
      if (wasAuto) {
        kf.spatialOut = spatialOutTangent(kfs, index);
        kf.spatialIn = spatialInTangent(kfs, index);
        kf.spatialType = 'bezier';
      }
      const opposite = side === 'out' ? 'spatialIn' : 'spatialOut';
      const current = kf[opposite] ?? [0, 0];
      const length = Math.hypot(current[0], current[1]);
      const dragged = Math.hypot(tangent[0], tangent[1]);

      if (side === 'out') kf.spatialOut = tangent;
      else kf.spatialIn = tangent;

      // Handles stay collinear, so the far side follows the direction of the
      // one being dragged while keeping its own length.
      if (dragged > 1e-6) {
        const scale = length / dragged;
        kf[opposite] = [-tangent[0] * scale, -tangent[1] * scale];
      }
    }, coalesceKey ? { coalesceKey } : undefined);
  },

  toggleSeparateDimensions: (layerId, path) => {
    const comp = currentComp(get().project);
    const layer = comp && findLayer(comp, layerId);
    const prop = layer && getProperty(layer, path);
    if (!prop) return;
    const separating = !prop.separated;
    get().mutateComp(separating ? 'Separate Dimensions' : 'Merge Dimensions', (c) => {
      const target = propertyFor(c, { layerId, path });
      if (!target) return;
      if (separating) separateDimensions(target);
      else mergeDimensions(target);
    });
    // Paths change shape either way, so old references would dangle.
    set({ selectedKeyframes: [], selectedProperties: [] });
    get().revealProperties('p', true);
  },

  copyKeyframes: () => {
    const { selectedKeyframes, project } = get();
    const comp = currentComp(project);
    if (!comp || selectedKeyframes.length === 0) return;

    const entries: ClipboardEntry[] = [];
    for (const ref of selectedKeyframes) {
      const prop = propertyFor(comp, ref);
      const kf = prop?.keyframes.find((k) => k.id === ref.kfId);
      if (kf) entries.push({ offset: kf.time, keyframe: structuredClone(kf) });
    }
    if (entries.length === 0) return;

    const earliest = Math.min(...entries.map((e) => e.offset));
    set({
      clipboard: entries.map((e) => ({ ...e, offset: e.offset - earliest })),
      statusMessage: `Copied ${entries.length} keyframe${entries.length === 1 ? '' : 's'}.`,
    });
  },

  pasteKeyframes: () => {
    const { clipboard, selectedProperties, selectedLayerIds, time } = get();
    if (clipboard.length === 0) return;

    const explicit = selectedProperties.length > 0;
    const targets: PropertyRef[] = explicit
      ? selectedProperties
      : selectedLayerIds.flatMap((layerId) => {
        const comp = currentComp(get().project);
        const layer = comp && findLayer(comp, layerId);
        return layer
          ? allProperties(layer)
            .filter((d) => d.property.animated)
            .map((d) => ({ layerId, path: d.path }))
          : [];
      });

    if (targets.length === 0) {
      set({ statusMessage: 'Select a property to paste into.' });
      return;
    }

    let pasted = 0;
    let skipped = 0;
    get().mutateComp('Paste Keyframes', (c) => {
      for (const target of targets) {
        const prop = propertyFor(c, target);
        if (!prop) continue;
        for (const entry of clipboard) {
          // Without an explicitly chosen property, keyframes simply route to
          // the properties whose value shape they fit.
          if (!sameShape(prop.value, entry.keyframe.value)) {
            if (explicit) skipped += 1;
            continue;
          }
          if (!prop.animated) setAnimated(prop, time, true);
          const kf = addKeyframe(prop, time + entry.offset, entry.keyframe.value);
          kf.inType = entry.keyframe.inType;
          kf.outType = entry.keyframe.outType;
          kf.easeIn = { ...entry.keyframe.easeIn };
          kf.easeOut = { ...entry.keyframe.easeOut };
          kf.tangentMode = entry.keyframe.tangentMode;
          pasted += 1;
        }
      }
    });
    set({
      statusMessage: skipped > 0
        ? `Pasted ${pasted}; skipped ${skipped} of a different value type.`
        : `Pasted ${pasted} keyframe${pasted === 1 ? '' : 's'}.`,
    });
  },

  applyEasingPreset: (preset) => {
    const { selectedKeyframes, project } = get();
    const comp = currentComp(project);
    if (!comp) return;
    if (selectedKeyframes.length === 0) {
      set({ statusMessage: 'Select keyframes to apply an easing preset.' });
      return;
    }

    let segments = 0;
    get().mutateComp(`Apply ${preset.name}`, (c) => {
      for (const [, refs] of groupByProperty(selectedKeyframes)) {
        const prop = propertyFor(c, refs[0]);
        if (!prop) continue;
        const ids = new Set(refs.map((r) => r.kfId));

        const pairs: [number, number][] = [];
        for (let i = 0; i < prop.keyframes.length - 1; i += 1) {
          if (ids.has(prop.keyframes[i].id) && ids.has(prop.keyframes[i + 1].id)) {
            pairs.push([i, i + 1]);
          }
        }
        // A single selected keyframe eases the segment it starts, or the one
        // it ends when it is the last keyframe.
        if (pairs.length === 0 && refs.length === 1) {
          const index = prop.keyframes.findIndex((k) => k.id === refs[0].kfId);
          if (index >= 0 && index < prop.keyframes.length - 1) pairs.push([index, index + 1]);
          else if (index > 0) pairs.push([index - 1, index]);
        }

        // Bake from the end backwards: baking rewrites the keyframe array.
        for (const [i, j] of preset.kind === 'baked' ? [...pairs].reverse() : pairs) {
          const a = prop.keyframes[i];
          const b = prop.keyframes[j];
          if (!a || !b) continue;
          if (preset.kind === 'baked' && preset.fn) {
            bakeIntoSegment(prop, a, b, preset.fn, c.frameRate);
          } else if (preset.points) {
            applyBezierToSegment(a, b, preset.points);
          }
          segments += 1;
        }
      }
    });

    set({
      statusMessage: segments === 0
        ? 'Select two adjacent keyframes to ease between them.'
        : `${preset.name} applied to ${segments} segment${segments === 1 ? '' : 's'}.`,
    });
  },

  setGraph: (patch) => set({ graph: { ...get().graph, ...patch } }),

  saveCustomPreset: (preset) => {
    const existing = get().customPresets;
    const next = existing.some((p) => p.id === preset.id)
      ? existing.map((p) => (p.id === preset.id ? preset : p))
      : [...existing, preset];
    saveCustomPresets(next);
    set({ customPresets: next, statusMessage: `Saved preset "${preset.name}".` });
  },

  removeCustomPreset: (id) => {
    const next = get().customPresets.filter((p) => p.id !== id);
    saveCustomPresets(next);
    set({ customPresets: next });
  },

  renameCustomPreset: (id, name) => {
    const next = get().customPresets.map((p) => (p.id === id ? { ...p, name } : p));
    saveCustomPresets(next);
    set({ customPresets: next });
  },

  moveCustomPreset: (id, delta) => {
    const presets = [...get().customPresets];
    const index = presets.findIndex((p) => p.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= presets.length) return;
    [presets[index], presets[target]] = [presets[target], presets[index]];
    saveCustomPresets(presets);
    set({ customPresets: presets });
  },

  goToNextKeyframe: () => {
    const times = visibleKeyframeTimes(get());
    const next = times.find((t) => t > get().time + 1e-6);
    if (next !== undefined) get().setTime(next);
  },

  goToPrevKeyframe: () => {
    const times = visibleKeyframeTimes(get());
    const prev = [...times].reverse().find((t) => t < get().time - 1e-6);
    if (prev !== undefined) get().setTime(prev);
  },

  revealProperties: (revealKey, additive) => {
    const state = get();
    const comp = currentComp(state.project);
    if (!comp) return;
    const revealed = { ...state.revealed };
    const expanded = { ...state.expanded };
    for (const id of state.selectedLayerIds) {
      const layer = findLayer(comp, id);
      if (!layer) continue;
      // MM reveals every mask property; every other key matches a property's
      // own reveal shortcut.
      const matches = revealKey === 'mm'
        ? allProperties(layer).filter((d) => d.path.startsWith('masks.')).map((d) => d.path)
        : allProperties(layer).filter((d) => d.revealKey === revealKey).map((d) => d.path);
      if (matches.length === 0) continue;
      const existing = additive ? revealed[id] ?? [] : [];
      const merged = Array.from(new Set([...existing, ...matches]));
      // Pressing the same single key again collapses the row, as AE does.
      revealed[id] = !additive && sameSet(revealed[id] ?? [], matches) ? [] : merged;
      expanded[id] = (revealed[id]?.length ?? 0) > 0;
    }
    set({ revealed, expanded });
  },

  revealAnimated: () => {
    const state = get();
    const comp = currentComp(state.project);
    if (!comp) return;
    const revealed = { ...state.revealed };
    const expanded = { ...state.expanded };
    for (const id of state.selectedLayerIds) {
      const layer = findLayer(comp, id);
      if (!layer) continue;
      const animated = allProperties(layer)
        .filter((d) => d.property.animated)
        .map((d) => d.path);
      revealed[id] = sameSet(revealed[id] ?? [], animated) ? [] : animated;
      expanded[id] = revealed[id].length > 0;
    }
    set({ revealed, expanded });
  },

  revealModified: () => {
    const state = get();
    const comp = currentComp(state.project);
    if (!comp) return;
    const revealed = { ...state.revealed };
    const expanded = { ...state.expanded };
    for (const id of state.selectedLayerIds) {
      const layer = findLayer(comp, id);
      if (!layer) continue;
      // "Modified" is anything animated plus anything moved off its default,
      // which for effects and masks means everything they add to the layer.
      const paths = allProperties(layer)
        .filter((d) => d.property.animated || !d.path.startsWith('transform.'))
        .map((d) => d.path);
      revealed[id] = sameSet(revealed[id] ?? [], paths) ? [] : paths;
      expanded[id] = revealed[id].length > 0;
    }
    set({ revealed, expanded });
  },

  revealExpressions: () => {
    const state = get();
    const comp = currentComp(state.project);
    if (!comp) return;
    const revealed = { ...state.revealed };
    const expanded = { ...state.expanded };
    for (const id of state.selectedLayerIds) {
      const layer = findLayer(comp, id);
      if (!layer) continue;
      const paths = allProperties(layer)
        .filter((d) => d.property.expression)
        .map((d) => d.path);
      revealed[id] = sameSet(revealed[id] ?? [], paths) ? [] : paths;
      expanded[id] = revealed[id].length > 0;
    }
    set({ revealed, expanded });
  },

  revealEffects: (layerId) => {
    const state = get();
    const comp = currentComp(state.project);
    const layer = comp && findLayer(comp, layerId);
    if (!layer) return;
    const already = state.revealed[layerId] ?? [];
    const effectPaths = allProperties(layer)
      .map((d) => d.path)
      .filter((path) => path.startsWith('effects.'));
    set({
      revealed: { ...state.revealed, [layerId]: [...new Set([...already, ...effectPaths])] },
      expanded: { ...state.expanded, [layerId]: true },
    });
  },

  revealAll: (layerId) => {
    const state = get();
    const comp = currentComp(state.project);
    const layer = comp && findLayer(comp, layerId);
    if (!layer) return;
    set({
      revealed: { ...state.revealed, [layerId]: allProperties(layer).map((d) => d.path) },
      expanded: { ...state.expanded, [layerId]: true },
    });
  },

  toggleExpanded: (id) => {
    const state = get();
    const open = !state.expanded[id];
    const comp = currentComp(state.project);
    const layer = comp && findLayer(comp, id);
    // Twirling a layer open shows its whole property tree — masks, contents
    // and animators included — which is what makes those groups reachable.
    set({
      expanded: { ...state.expanded, [id]: open },
      revealed: {
        ...state.revealed,
        [id]: open && layer ? allProperties(layer).map((d) => d.path) : [],
      },
    });
  },

  setTool: (tool) => set({ tool }),
  setViewer: (patch) => set({ viewer: { ...get().viewer, ...patch } }),
  setTimeDisplay: (timeDisplay) => set({ timeDisplay }),
  toggleGraphEditor: () => set({ graphEditor: !get().graphEditor }),
  setStatus: (statusMessage) => set({ statusMessage }),
  openDialog: (dialog) => set({ dialog }),

  refreshExpressionErrors: () => {
    const next: Record<Id, string> = {};
    for (const error of collectExpressionErrors()) next[error.propertyId] = error.message;
    const current = get().expressionErrors;
    const sameKeys = Object.keys(next).length === Object.keys(current).length
      && Object.keys(next).every((key) => current[key] === next[key]);
    if (!sameKeys) set({ expressionErrors: next });
  },

  newComposition: () => {
    let id: Id | null = null;
    get().mutate('New Composition', (project) => {
      const comp = createComposition({
        name: `Comp ${project.compositions.length + 1}`,
      });
      project.compositions.push(comp);
      project.activeCompId = comp.id;
      id = comp.id;
    });
    if (id) set({ time: 0, selectedLayerIds: [], selectedKeyframes: [] });
  },

  setActiveComp: (id) => {
    get().mutate('Open Composition', (project) => {
      project.activeCompId = id;
    });
    set({ time: 0, selectedLayerIds: [], selectedKeyframes: [] });
  },

  updateCompSettings: (patch) => {
    get().mutateComp('Composition Settings', (c) => Object.assign(c, patch));
  },

  setWorkAreaStart: (time) => {
    get().mutateComp('Set Work Area', (c) => {
      c.workAreaStart = Math.max(0, Math.min(time, c.workAreaEnd - 1 / c.frameRate));
    }, { coalesceKey: 'workAreaStart' });
  },

  setWorkAreaEnd: (time) => {
    get().mutateComp('Set Work Area', (c) => {
      c.workAreaEnd = Math.min(c.duration, Math.max(time, c.workAreaStart + 1 / c.frameRate));
    }, { coalesceKey: 'workAreaEnd' });
  },

  loadProject: (project) => {
    set({
      project: syncExpressions(project),
      past: [],
      future: [],
      time: 0,
      selectedLayerIds: [],
      selectedKeyframes: [],
      revealed: {},
      expanded: {},
    });
    // The document names its footage; the bytes come back from storage, and
    // anything this browser does not hold is marked missing.
    void get().loadProjectFootage();
  },
}));

/** Walk a dotted path on a layer, returning whatever sits there. */
function getByPath(root: unknown, path: string): unknown {
  let node: unknown = root;
  for (const key of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** Resolve the property a reference points at, within a composition. */
function propertyFor(comp: Composition, ref: { layerId: Id; path: string }): Property | undefined {
  const layer = findLayer(comp, ref.layerId);
  return layer ? getProperty(layer, ref.path) : undefined;
}

function groupByProperty(refs: KeyframeRef[]): Map<string, KeyframeRef[]> {
  const groups = new Map<string, KeyframeRef[]>();
  for (const ref of refs) {
    const key = `${ref.layerId}|${ref.path}`;
    const list = groups.get(key) ?? [];
    list.push(ref);
    groups.set(key, list);
  }
  return groups;
}

function sameShape(a: PropertyValue, b: PropertyValue): boolean {
  if (typeof a === 'number') return typeof b === 'number';
  if (isBezierPath(a)) return isBezierPath(b);
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length;
}

/** All keyframe times on the selected layers' revealed properties, sorted. */
function visibleKeyframeTimes(state: EditorState): number[] {
  const comp = currentComp(state.project);
  if (!comp) return [];
  const layers: Layer[] = state.selectedLayerIds.length
    ? (state.selectedLayerIds.map((id) => findLayer(comp, id)).filter(Boolean) as Layer[])
    : comp.layers;

  const times = new Set<number>();
  for (const layer of layers) {
    const paths = state.revealed[layer.id];
    const descriptors = allProperties(layer).filter(
      (d) => !paths || paths.length === 0 || paths.includes(d.path),
    );
    for (const d of descriptors) {
      if (!d.property.animated) continue;
      for (const kf of d.property.keyframes) times.add(kf.time);
    }
  }
  return [...times].sort((a, b) => a - b);
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v) => b.includes(v));
}

/** Give a duplicated layer fresh property and keyframe ids. */
function reidentify(layer: Layer): void {
  for (const descriptor of allProperties(layer)) {
    const prop = descriptor.property;
    prop.id = `${prop.id}_${Math.random().toString(36).slice(2, 7)}`;
    for (const kf of prop.keyframes) {
      kf.id = `${kf.id}_${Math.random().toString(36).slice(2, 7)}`;
    }
  }
}

/** Open a file picker and resolve with the chosen file, or null. */
function pickFiles(accept: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

const SOLID_COLORS = ['#e05a5a', '#5a8fe0', '#5ae09a', '#e0c25a', '#a45ae0', '#e08a5a'];
function randomSolidColor(): string {
  return SOLID_COLORS[Math.floor(Math.random() * SOLID_COLORS.length)];
}
