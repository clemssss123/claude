import { create } from 'zustand';
import {
  addLayer, clampTimeToComp, createComposition, findLayer, layerIndex, moveLayer,
  removeLayer, uniqueLayerName,
} from '@/core/composition';
import {
  allProperties, createAdjustmentLayer, createNullLayer, createSolidLayer,
  createTextLayer, getProperty, transformProperties, wouldCreateCycle,
} from '@/core/layer';
import { applyEasyEase } from '@/core/interpolation';
import {
  addKeyframe, findKeyframeAt, hexToRgba, moveKeyframe, removeKeyframe,
  setAnimated, setValueAtTime, valueAtTime,
} from '@/core/property';
import { activeComposition, createStarterProject } from '@/core/project';
import { snapToFrame } from '@/core/time';
import type {
  BlendMode, Composition, Id, InterpolationType, Layer, Project, PropertyValue, RGBA,
} from '@/core/types';

/** How long two edits may be apart and still collapse into one undo step. */
const COALESCE_WINDOW_MS = 700;
const HISTORY_LIMIT = 200;

export type Tool =
  | 'selection' | 'hand' | 'zoom' | 'rotation' | 'pen' | 'text' | 'shape' | 'anchor';

export interface KeyframeRef {
  layerId: Id;
  path: string;
  kfId: Id;
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
  /** Property paths revealed per layer in the timeline. */
  revealed: Record<Id, string[]>;
  expanded: Record<Id, boolean>;

  tool: Tool;
  viewer: ViewerState;
  timeDisplay: 'timecode' | 'frames';
  graphEditor: boolean;
  statusMessage: string | null;
  /** Name of the open modal dialog, if any. */
  dialog: 'compSettings' | 'shortcuts' | 'about' | null;

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
  setSelectedInterpolation: (type: InterpolationType) => void;
  goToNextKeyframe: () => void;
  goToPrevKeyframe: () => void;

  // -- timeline / panels ---------------------------------------------------
  revealProperties: (revealKey: string, additive: boolean) => void;
  revealAnimated: () => void;
  toggleExpanded: (id: Id) => void;
  setTool: (tool: Tool) => void;
  setViewer: (patch: Partial<ViewerState>) => void;
  setTimeDisplay: (mode: 'timecode' | 'frames') => void;
  toggleGraphEditor: () => void;
  setStatus: (message: string | null) => void;
  openDialog: (dialog: EditorState['dialog']) => void;

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

export const useEditor = create<EditorState>()((set, get) => ({
  project: createStarterProject(),
  past: [],
  future: [],
  lastCoalesceKey: null,
  lastMutateAt: 0,

  time: 0,
  playing: false,
  loopPlayback: true,

  selectedLayerIds: [],
  selectedKeyframes: [],
  revealed: {},
  expanded: {},

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
      project: next,
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
      project: entry.project,
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
      project: entry.project,
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

  setSelectedInterpolation: (type) => {
    const refs = get().selectedKeyframes;
    if (refs.length === 0) return;
    get().mutateComp('Keyframe Interpolation', (c) => {
      for (const ref of refs) {
        const layer = findLayer(c, ref.layerId);
        const prop = layer && getProperty(layer, ref.path);
        const kf = prop?.keyframes.find((k) => k.id === ref.kfId);
        if (kf) {
          kf.inType = type;
          kf.outType = type;
        }
      }
    });
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
      const matches = transformProperties(layer)
        .filter((d) => d.revealKey === revealKey)
        .map((d) => d.path);
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

  toggleExpanded: (id) => {
    const state = get();
    const open = !state.expanded[id];
    const comp = currentComp(state.project);
    const layer = comp && findLayer(comp, id);
    set({
      expanded: { ...state.expanded, [id]: open },
      revealed: {
        ...state.revealed,
        [id]: open && layer ? transformProperties(layer).map((d) => d.path) : [],
      },
    });
  },

  setTool: (tool) => set({ tool }),
  setViewer: (patch) => set({ viewer: { ...get().viewer, ...patch } }),
  setTimeDisplay: (timeDisplay) => set({ timeDisplay }),
  toggleGraphEditor: () => set({ graphEditor: !get().graphEditor }),
  setStatus: (statusMessage) => set({ statusMessage }),
  openDialog: (dialog) => set({ dialog }),

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

  loadProject: (project) => set({
    project,
    past: [],
    future: [],
    time: 0,
    selectedLayerIds: [],
    selectedKeyframes: [],
    revealed: {},
    expanded: {},
  }),
}));

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

const SOLID_COLORS = ['#e05a5a', '#5a8fe0', '#5ae09a', '#e0c25a', '#a45ae0', '#e08a5a'];
function randomSolidColor(): string {
  return SOLID_COLORS[Math.floor(Math.random() * SOLID_COLORS.length)];
}
