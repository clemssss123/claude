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

import type { BezierPath } from './path';

export type Id = string;
export type Vec2 = [number, number];
/** Straight (non-premultiplied) RGBA, each channel 0..1. */
export type RGBA = [number, number, number, number];

export type PropertyValue = number | Vec2 | RGBA | BezierPath;

export type PropertyKind =
  | 'number'
  | 'percent'
  | 'angle'
  | 'vec2'
  | 'color'
  | 'checkbox'
  | 'path';

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

export type AnyProperty =
  | Property<number> | Property<Vec2> | Property<RGBA> | Property<BezierPath>;

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

/** How a mask combines with the masks above it in the stack. */
export type MaskMode =
  | 'none' | 'add' | 'subtract' | 'intersect' | 'lighten' | 'darken' | 'difference';

export interface Mask {
  id: Id;
  name: string;
  mode: MaskMode;
  inverted: boolean;
  locked: boolean;
  /** Outline colour in the viewer. */
  color: string;
  path: Property<BezierPath>;
  /** Horizontal and vertical feather radius in pixels. */
  feather: Property<Vec2>;
  opacity: Property<number>;
  /** Grows (positive) or shrinks (negative) the mask, in pixels. */
  expansion: Property<number>;
}

/**
 * Track matte: the layer directly above supplies this layer's transparency.
 * The matte layer is not drawn itself, exactly as in After Effects.
 */
export type TrackMatteType =
  | 'none' | 'alpha' | 'alpha-inverted' | 'luma' | 'luma-inverted';

/**
 * One effect applied to a layer. The parameters are ordinary animatable
 * properties, so effects keyframe, graph and undo like everything else.
 * `matchName` ties the instance back to its definition in the effect registry.
 */
export interface EffectInstance {
  id: Id;
  matchName: string;
  name: string;
  enabled: boolean;
  params: Record<string, AnyProperty>;
}

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
  masks: Mask[];
  effects: EffectInstance[];
  trackMatte: TrackMatteType;
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

/** Shape of a range selector's falloff across the characters it covers. */
export type SelectorShape =
  | 'square' | 'ramp-up' | 'ramp-down' | 'triangle' | 'round' | 'smooth';

export interface TextRangeSelector {
  id: Id;
  name: string;
  /** Percentages of the text, or character indices, depending on `units`. */
  start: Property<number>;
  end: Property<number>;
  offset: Property<number>;
  units: 'percent' | 'index';
  shape: SelectorShape;
  mode: 'add' | 'subtract';
  /** Scales the selector's whole influence. */
  amount: Property<number>;
  easeHigh: Property<number>;
  easeLow: Property<number>;
}

/** The transform an animator applies, weighted per character by its selectors. */
export interface TextAnimatorProperties {
  position: Property<Vec2>;
  scale: Property<Vec2>;
  rotation: Property<number>;
  opacity: Property<number>;
  tracking: Property<number>;
  fillColor: Property<RGBA>;
  /** Which of the above this animator actually drives. */
  enabled: Record<'position' | 'scale' | 'rotation' | 'opacity' | 'tracking' | 'fillColor', boolean>;
}

export interface TextAnimator {
  id: Id;
  name: string;
  selectors: TextRangeSelector[];
  properties: TextAnimatorProperties;
}

export interface TextLayer extends LayerBase {
  type: 'text';
  text: TextStyle;
  animators: TextAnimator[];
}

// -- shape layers ----------------------------------------------------------

export interface ShapeTransform {
  anchorPoint: Property<Vec2>;
  position: Property<Vec2>;
  scale: Property<Vec2>;
  rotation: Property<number>;
  opacity: Property<number>;
  skew: Property<number>;
  skewAxis: Property<number>;
}

export interface ShapeItemBase {
  id: Id;
  name: string;
  enabled: boolean;
}

export interface RectShape extends ShapeItemBase {
  type: 'rect';
  size: Property<Vec2>;
  position: Property<Vec2>;
  roundness: Property<number>;
}

export interface EllipseShape extends ShapeItemBase {
  type: 'ellipse';
  size: Property<Vec2>;
  position: Property<Vec2>;
}

export interface StarShape extends ShapeItemBase {
  type: 'star';
  /** Star alternates two radii; polygon uses the outer one only. */
  star: boolean;
  points: Property<number>;
  position: Property<Vec2>;
  rotation: Property<number>;
  outerRadius: Property<number>;
  innerRadius: Property<number>;
}

export interface PathShape extends ShapeItemBase {
  type: 'path';
  path: Property<BezierPath>;
}

export type FillRule = 'nonzero' | 'evenodd';

export interface FillStyle extends ShapeItemBase {
  type: 'fill';
  color: Property<RGBA>;
  opacity: Property<number>;
  rule: FillRule;
}

export interface StrokeStyle extends ShapeItemBase {
  type: 'stroke';
  color: Property<RGBA>;
  opacity: Property<number>;
  width: Property<number>;
  cap: 'butt' | 'round' | 'square';
  join: 'miter' | 'round' | 'bevel';
  dashes: Property<Vec2>;
}

export interface TrimPathsModifier extends ShapeItemBase {
  type: 'trim';
  start: Property<number>;
  end: Property<number>;
  offset: Property<number>;
  /** Trim every path as one outline, or each path separately. */
  multipleShapes: boolean;
}

export interface RepeaterModifier extends ShapeItemBase {
  type: 'repeater';
  copies: Property<number>;
  offset: Property<number>;
  transform: ShapeTransform;
  /** Opacity of the first and last copy, blended across the repeats. */
  startOpacity: Property<number>;
  endOpacity: Property<number>;
}

export interface OffsetPathsModifier extends ShapeItemBase {
  type: 'offset';
  amount: Property<number>;
}

export interface ShapeGroup extends ShapeItemBase {
  type: 'group';
  items: ShapeItem[];
  transform: ShapeTransform;
}

export type ShapeItem =
  | ShapeGroup | RectShape | EllipseShape | StarShape | PathShape
  | FillStyle | StrokeStyle | TrimPathsModifier | RepeaterModifier | OffsetPathsModifier;

export interface ShapeLayer extends LayerBase {
  type: 'shape';
  contents: ShapeItem[];
}

export type Layer =
  | SolidLayer | NullLayer | AdjustmentLayer | TextLayer | ShapeLayer;

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

export const MASK_MODES: MaskMode[] = [
  'none', 'add', 'subtract', 'intersect', 'lighten', 'darken', 'difference',
];

export const TRACK_MATTE_TYPES: TrackMatteType[] = [
  'none', 'alpha', 'alpha-inverted', 'luma', 'luma-inverted',
];

/** Outline colours cycled through as masks are added to a layer. */
export const MASK_COLORS = [
  '#ffd24a', '#5ae08a', '#6fa8ff', '#e2685d', '#c58ae6', '#7bd1e6',
];

export const BLEND_MODES: BlendMode[] = [
  'normal', 'add', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference',
  'exclusion', 'hue', 'saturation', 'color', 'luminosity',
];
