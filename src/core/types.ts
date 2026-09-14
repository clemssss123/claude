/**
 * Document model for Keyframe Studio.
 *
 * Everything in this file is plain, JSON-serializable data: no class instances,
 * no functions, no DOM handles. That is what makes undo (structural clone),
 * project save/load and worker-side evaluation straightforward.
 *
 * Time is stored in SECONDS throughout the document. Frames only exist at the
 * UI boundary, where the composition's frame rate converts between the two.
 */

export type Id = string;
export type Vec2 = [number, number];
/** Straight (non-premultiplied) RGBA, each channel 0..1. */
export type RGBA = [number, number, number, number];

export type PropertyValue = number | Vec2 | RGBA;

export type PropertyKind =
  | 'number'
  | 'percent'
  | 'angle'
  | 'vec2'
  | 'color'
  | 'checkbox';

/** Temporal interpolation of one side of a keyframe. */
export type InterpolationType = 'linear' | 'bezier' | 'hold';

/**
 * How a keyframe's two temporal handles relate to each other, mirroring
 * After Effects' Bezier / Continuous Bezier / Auto Bezier distinction.
 * The evaluated curve is a bezier in every case; only the editing rules and
 * whether the handles are recomputed automatically differ.
 */
export type TangentMode = 'independent' | 'continuous' | 'auto';

/** Interpolation of a positional property's motion path through space. */
export type SpatialType = 'linear' | 'bezier' | 'auto';

/**
 * One side of a keyframe's temporal bezier handle, in After Effects terms.
 * `influence` is 0..100 % of the segment duration the handle spans.
 * `speed` is in value-units per second (magnitude units/sec for vectors).
 */
export interface Ease {
  influence: number;
  speed: number;
}

export interface Keyframe<T extends PropertyValue = PropertyValue> {
  id: Id;
  /** Comp time in seconds. */
  time: number;
  value: T;
  inType: InterpolationType;
  outType: InterpolationType;
  easeIn: Ease;
  easeOut: Ease;
  tangentMode: TangentMode;
  /**
   * A roving keyframe keeps its value but gives up its time: it is
   * redistributed between its neighbours so speed stays constant.
   */
  roving?: boolean;
  /** Motion-path interpolation, positional (vec2) properties only. */
  spatialType?: SpatialType;
  /** Motion-path tangents, relative to the keyframe's own value, in px. */
  spatialIn?: Vec2;
  spatialOut?: Vec2;
}

export interface Property<T extends PropertyValue = PropertyValue> {
  id: Id;
  /** Display name, e.g. "Position". */
  name: string;
  /** Stable identifier that survives renaming/localization, e.g. "ADBE Position". */
  matchName: string;
  kind: PropertyKind;
  /** Static value; also the value used whenever there are no keyframes. */
  value: T;
  /** Always kept sorted ascending by time. */
  keyframes: Keyframe<T>[];
  /** Stopwatch state. Keyframes are ignored while this is false. */
  animated: boolean;
  min?: number;
  max?: number;
  /** Suffix shown in the UI, e.g. "%" or "°". */
  unit?: string;
  /** Per-dimension labels for vectors, e.g. ["X", "Y"]. */
  dimensionNames?: string[];
  /** Drag sensitivity for scrubbable fields, in value units per pixel. */
  speedPerPixel?: number;
  /** Expression source. Evaluated in a later phase; stored from the start. */
  expression?: string | null;
  /** True once the vector has been split into independent dimensions. */
  separated?: boolean;
  /** The split-out dimensions, present whenever `separated` is true. */
  dimensions?: Property<number>[];
  /** Marks a positional property, which gets a motion path and spatial handles. */
  spatial?: boolean;
}

export type AnyProperty = Property<number> | Property<Vec2> | Property<RGBA>;

export interface TransformGroup {
  anchorPoint: Property<Vec2>;
  position: Property<Vec2>;
  scale: Property<Vec2>;
  rotation: Property<number>;
  opacity: Property<number>;
}

export type LayerType =
  | 'solid'
  | 'null'
  | 'text'
  | 'shape'
  | 'media'
  | 'adjustment'
  | 'precomp';

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'
  | 'add';

export interface LayerBase {
  id: Id;
  name: string;
  type: LayerType;
  /** Layer whose transform this layer inherits, or null. */
  parentId: Id | null;
  /** The eyeball. */
  enabled: boolean;
  solo: boolean;
  shy: boolean;
  locked: boolean;
  /** Per-layer motion blur switch (comp switch gates it globally). */
  motionBlur: boolean;
  blendMode: BlendMode;
  /** Label colour index into LABEL_COLORS. */
  label: number;
  /** Comp time at which the layer's own time zero sits, in seconds. */
  startTime: number;
  /** Visible span in comp time, seconds. */
  inPoint: number;
  outPoint: number;
  /** Source dimensions in pixels. */
  width: number;
  height: number;
  transform: TransformGroup;
}

export interface SolidLayer extends LayerBase {
  type: 'solid';
  color: RGBA;
}

export interface NullLayer extends LayerBase {
  type: 'null';
}

export interface AdjustmentLayer extends LayerBase {
  type: 'adjustment';
}

export interface TextStyle {
  source: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fillColor: RGBA;
  tracking: number;
  leading: number;
  justification: 'left' | 'center' | 'right';
}

export interface TextLayer extends LayerBase {
  type: 'text';
  text: TextStyle;
}

export type Layer = SolidLayer | NullLayer | AdjustmentLayer | TextLayer;

export interface Marker {
  id: Id;
  time: number;
  comment: string;
  duration: number;
}

export interface MotionBlurSettings {
  enabled: boolean;
  /** Degrees, 0..720. 180° is a physically typical camera. */
  shutterAngle: number;
  /** Degrees, -360..360. */
  shutterPhase: number;
  samplesPerFrame: number;
  adaptiveSampleLimit: number;
}

export interface Composition {
  id: Id;
  name: string;
  width: number;
  height: number;
  /** Frames per second. */
  frameRate: number;
  /** Seconds. */
  duration: number;
  bgColor: RGBA;
  /** Index 0 is the topmost layer, matching the timeline's stacking order. */
  layers: Layer[];
  workAreaStart: number;
  workAreaEnd: number;
  markers: Marker[];
  motionBlur: MotionBlurSettings;
}

export interface Project {
  name: string;
  /** Schema version, so old files can be migrated. */
  version: number;
  compositions: Composition[];
  activeCompId: Id | null;
}

export const PROJECT_SCHEMA_VERSION = 1;

/** After Effects' label swatch colours, in timeline order. */
export const LABEL_COLORS = [
  '#9d9d9d', '#ec4b4b', '#e8e14b', '#a3e84b', '#4be8c8', '#4b9de8',
  '#8f4be8', '#e84bc8', '#e8a04b', '#4be86a', '#7a7ae8', '#c8e84b',
  '#e86a4b', '#4bc8e8', '#b0e84b', '#e84b8f',
];

export const BLEND_MODES: BlendMode[] = [
  'normal', 'add', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference',
  'exclusion', 'hue', 'saturation', 'color', 'luminosity',
];
