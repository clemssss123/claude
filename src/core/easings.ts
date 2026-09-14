import { cubicBezierEase } from './bezier';
import { easeFromCubicBezier, valueDelta } from './interpolation';
import { addKeyframe } from './property';
import type { Keyframe, Property, PropertyValue } from './types';

/**
 * Easing preset library.
 *
 * A preset is a curve, not a keyframe setting: applying one means solving for
 * the influence/speed handles that reproduce that curve on the selected
 * segment. Curves a single cubic bezier cannot express — elastic and bounce,
 * which oscillate — are marked `baked` and applied by sampling extra
 * keyframes across the segment instead of pretending a bezier can do it.
 */

export type PresetKind = 'bezier' | 'baked';

export interface EasingPreset {
  id: string;
  name: string;
  group: string;
  kind: PresetKind;
  /** Control points for a bezier preset: x1, y1, x2, y2. */
  points?: [number, number, number, number];
  /** Function name for a baked preset. */
  fn?: BakedName;
  builtin?: boolean;
}

export type BakedName =
  | 'elasticIn' | 'elasticOut' | 'elasticInOut'
  | 'bounceIn' | 'bounceOut' | 'bounceInOut';

const C4 = (2 * Math.PI) / 3;
const C5 = (2 * Math.PI) / 4.5;

function bounceOut(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) { const x = t - 1.5 / d1; return n1 * x * x + 0.75; }
  if (t < 2.5 / d1) { const x = t - 2.25 / d1; return n1 * x * x + 0.9375; }
  const x = t - 2.625 / d1;
  return n1 * x * x + 0.984375;
}

export const BAKED_FUNCTIONS: Record<BakedName, (t: number) => number> = {
  elasticIn: (t) => (
    t === 0 ? 0 : t === 1 ? 1 : -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * C4)
  ),
  elasticOut: (t) => (
    t === 0 ? 0 : t === 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * C4) + 1
  ),
  elasticInOut: (t) => {
    if (t === 0 || t === 1) return t;
    return t < 0.5
      ? -(2 ** (20 * t - 10) * Math.sin((20 * t - 11.125) * C5)) / 2
      : (2 ** (-20 * t + 10) * Math.sin((20 * t - 11.125) * C5)) / 2 + 1;
  },
  bounceIn: (t) => 1 - bounceOut(1 - t),
  bounceOut,
  bounceInOut: (t) => (
    t < 0.5 ? (1 - bounceOut(1 - 2 * t)) / 2 : (1 + bounceOut(2 * t - 1)) / 2
  ),
};

function bezier(
  id: string, name: string, group: string,
  points: [number, number, number, number],
): EasingPreset {
  return { id, name, group, kind: 'bezier', points, builtin: true };
}

function baked(id: string, name: string, group: string, fn: BakedName): EasingPreset {
  return { id, name, group, kind: 'baked', fn, builtin: true };
}

/** Control points follow the standard easing definitions used on easings.net. */
export const BUILTIN_PRESETS: EasingPreset[] = [
  bezier('linear', 'Linear', 'Basic', [1 / 3, 1 / 3, 2 / 3, 2 / 3]),
  bezier('easyEase', 'Easy Ease', 'Basic', [1 / 3, 0, 2 / 3, 1]),
  bezier('easyEaseIn', 'Easy Ease In', 'Basic', [1 / 3, 1 / 3, 2 / 3, 1]),
  bezier('easyEaseOut', 'Easy Ease Out', 'Basic', [1 / 3, 0, 2 / 3, 2 / 3]),

  bezier('sineIn', 'Sine In', 'Sine', [0.12, 0, 0.39, 0]),
  bezier('sineOut', 'Sine Out', 'Sine', [0.61, 1, 0.88, 1]),
  bezier('sineInOut', 'Sine In Out', 'Sine', [0.37, 0, 0.63, 1]),

  bezier('quadIn', 'Quad In', 'Quad', [0.11, 0, 0.5, 0]),
  bezier('quadOut', 'Quad Out', 'Quad', [0.5, 1, 0.89, 1]),
  bezier('quadInOut', 'Quad In Out', 'Quad', [0.45, 0, 0.55, 1]),

  bezier('cubicIn', 'Cubic In', 'Cubic', [0.32, 0, 0.67, 0]),
  bezier('cubicOut', 'Cubic Out', 'Cubic', [0.33, 1, 0.68, 1]),
  bezier('cubicInOut', 'Cubic In Out', 'Cubic', [0.65, 0, 0.35, 1]),

  bezier('quartIn', 'Quart In', 'Quart', [0.5, 0, 0.75, 0]),
  bezier('quartOut', 'Quart Out', 'Quart', [0.25, 1, 0.5, 1]),
  bezier('quartInOut', 'Quart In Out', 'Quart', [0.76, 0, 0.24, 1]),

  bezier('quintIn', 'Quint In', 'Quint', [0.64, 0, 0.78, 0]),
  bezier('quintOut', 'Quint Out', 'Quint', [0.22, 1, 0.36, 1]),
  bezier('quintInOut', 'Quint In Out', 'Quint', [0.83, 0, 0.17, 1]),

  bezier('expoIn', 'Expo In', 'Expo', [0.7, 0, 0.84, 0]),
  bezier('expoOut', 'Expo Out', 'Expo', [0.16, 1, 0.3, 1]),
  bezier('expoInOut', 'Expo In Out', 'Expo', [0.87, 0, 0.13, 1]),

  bezier('circIn', 'Circ In', 'Circ', [0.55, 0, 1, 0.45]),
  bezier('circOut', 'Circ Out', 'Circ', [0, 0.55, 0.45, 1]),
  bezier('circInOut', 'Circ In Out', 'Circ', [0.85, 0, 0.15, 1]),

  bezier('backIn', 'Back In', 'Back', [0.36, 0, 0.66, -0.56]),
  bezier('backOut', 'Back Out', 'Back', [0.34, 1.56, 0.64, 1]),
  bezier('backInOut', 'Back In Out', 'Back', [0.68, -0.6, 0.32, 1.6]),

  baked('elasticIn', 'Elastic In', 'Elastic', 'elasticIn'),
  baked('elasticOut', 'Elastic Out', 'Elastic', 'elasticOut'),
  baked('elasticInOut', 'Elastic In Out', 'Elastic', 'elasticInOut'),

  baked('bounceIn', 'Bounce In', 'Bounce', 'bounceIn'),
  baked('bounceOut', 'Bounce Out', 'Bounce', 'bounceOut'),
  baked('bounceInOut', 'Bounce In Out', 'Bounce', 'bounceInOut'),
];

/** Curve value at 0..1, for thumbnails and the curve editor. */
export function samplePreset(preset: EasingPreset, t: number): number {
  if (preset.kind === 'baked' && preset.fn) return BAKED_FUNCTIONS[preset.fn](t);
  const [x1, y1, x2, y2] = preset.points ?? [1 / 3, 1 / 3, 2 / 3, 2 / 3];
  return cubicBezierEase(t, x1, y1, x2, y2);
}

/**
 * Apply a bezier preset to the segment between two adjacent keyframes by
 * solving for the handles that reproduce the curve.
 */
export function applyBezierToSegment(
  a: Keyframe,
  b: Keyframe,
  points: [number, number, number, number],
): void {
  const [x1, y1, x2, y2] = points;
  const { easeOut, easeIn } = easeFromCubicBezier(
    x1, y1, x2, y2, b.time - a.time, valueDelta(a.value, b.value),
  );
  a.outType = 'bezier';
  a.easeOut = easeOut;
  b.inType = 'bezier';
  b.easeIn = easeIn;
  // The preset owns both handles, so linked tangents would fight it.
  if (a.tangentMode === 'auto') a.tangentMode = 'independent';
  if (b.tangentMode === 'auto') b.tangentMode = 'independent';
}

/** Upper bound on the keyframes a baked preset will write into one segment. */
export const MAX_BAKE_SAMPLES = 120;

/**
 * Bake an oscillating easing into keyframes across a segment. The end
 * keyframes keep their values; everything between them is replaced.
 */
export function bakeIntoSegment(
  prop: Property,
  a: Keyframe,
  b: Keyframe,
  fn: BakedName,
  frameRate: number,
): void {
  const duration = b.time - a.time;
  if (duration <= 0) return;

  const samples = Math.min(MAX_BAKE_SAMPLES, Math.max(4, Math.round(duration * frameRate)));
  const ease = BAKED_FUNCTIONS[fn];

  // Clear anything already sitting inside the segment.
  prop.keyframes = prop.keyframes.filter(
    (kf) => kf.time <= a.time + 1e-9 || kf.time >= b.time - 1e-9,
  );

  const from = a.value;
  const to = b.value;
  for (let i = 1; i < samples; i += 1) {
    const t = i / samples;
    const eased = ease(t);
    const value = blend(from, to, eased);
    const kf = addKeyframe(prop, a.time + duration * t, value);
    kf.inType = 'linear';
    kf.outType = 'linear';
    kf.tangentMode = 'independent';
  }

  a.outType = 'linear';
  b.inType = 'linear';
}

function blend(from: PropertyValue, to: PropertyValue, t: number): PropertyValue {
  if (typeof from === 'number' && typeof to === 'number') return from + (to - from) * t;
  const a = from as number[];
  const b = to as number[];
  return a.map((v, i) => v + (b[i] - v) * t) as PropertyValue;
}

// -- custom presets --------------------------------------------------------

const STORAGE_KEY = 'keyframe-studio.easing-presets';

export function loadCustomPresets(): EasingPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as EasingPreset[];
    return Array.isArray(parsed) ? parsed.filter((p) => p && p.id && p.name) : [];
  } catch {
    return []; // Private browsing or corrupt data: presets are a convenience.
  }
}

export function saveCustomPresets(presets: EasingPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Nothing to do — the session keeps working with in-memory presets.
  }
}
