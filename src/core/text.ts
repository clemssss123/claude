import { createProperty, valueAtTime } from './property';
import { uid } from './uid';
import type {
  RGBA, SelectorShape, TextAnimator, TextAnimatorProperties, TextLayer,
  TextRangeSelector, TextStyle, Vec2,
} from './types';

/**
 * Text layout and per-character animators.
 *
 * Layout needs real glyph widths, which only a rendering context can supply,
 * so the app registers a measurer at start-up. Without one — in tests, or
 * before the first frame — an average-advance estimate keeps everything
 * working, just less precisely.
 */

export type TextMeasurer = (text: string, font: string) => number;

let measurer: TextMeasurer | null = null;

export function registerTextMeasurer(fn: TextMeasurer): void {
  measurer = fn;
}

/** Fallback advance width when no measurer is registered. */
const ESTIMATED_ADVANCE_RATIO = 0.55;

export function fontString(style: TextStyle): string {
  return `${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
}

export function measureAdvance(character: string, style: TextStyle): number {
  if (measurer) return measurer(character, fontString(style));
  return style.fontSize * ESTIMATED_ADVANCE_RATIO;
}

export interface Glyph {
  character: string;
  /** Index across the whole text, which is what range selectors address. */
  index: number;
  lineIndex: number;
  /** Baseline origin in layer space. */
  x: number;
  y: number;
  advance: number;
}

export interface TextLayout {
  glyphs: Glyph[];
  lineWidths: number[];
  width: number;
  height: number;
  /** Total character count, newlines excluded. */
  count: number;
}

/**
 * Lay out a text layer's glyphs. `extraTracking` adds per-character spacing
 * from animators, which shifts every later glyph on the line just as tracking
 * does in After Effects.
 */
export function layoutText(
  style: TextStyle,
  extraTracking?: (index: number) => number,
): TextLayout {
  const lines = style.source.split('\n');
  const lineHeight = style.fontSize * style.leading;
  const glyphs: Glyph[] = [];
  const lineWidths: number[] = [];

  let index = 0;
  lines.forEach((line, lineIndex) => {
    const characters = [...line];
    const advances = characters.map((ch) => measureAdvance(ch, style));
    const spacing = characters.map((_, i) => (
      style.tracking + (extraTracking ? extraTracking(index + i) : 0)
    ));
    const width = advances.reduce((sum, a) => sum + a, 0)
      + spacing.slice(0, Math.max(0, characters.length - 1)).reduce((sum, s) => sum + s, 0);
    lineWidths.push(width);

    const startX = style.justification === 'center' ? -width / 2
      : style.justification === 'right' ? -width : 0;

    let x = startX;
    characters.forEach((character, i) => {
      glyphs.push({
        character,
        index: index + i,
        lineIndex,
        x,
        y: lineIndex * lineHeight,
        advance: advances[i],
      });
      x += advances[i] + spacing[i];
    });
    index += characters.length;
  });

  return {
    glyphs,
    lineWidths,
    width: Math.max(0, ...lineWidths),
    height: lineHeight * lines.length,
    count: index,
  };
}

// -- animators -------------------------------------------------------------

export function createTextAnimator(name = 'Animator 1'): TextAnimator {
  return {
    id: uid('anim'),
    name,
    selectors: [createRangeSelector()],
    properties: createAnimatorProperties(),
  };
}

export function createRangeSelector(name = 'Range Selector 1'): TextRangeSelector {
  return {
    id: uid('sel'),
    name,
    start: createProperty<number>('Start', 'ADBE Text Selector Start', 'percent', 0, {
      unit: '%', speedPerPixel: 0.5,
    }),
    end: createProperty<number>('End', 'ADBE Text Selector End', 'percent', 100, {
      unit: '%', speedPerPixel: 0.5,
    }),
    offset: createProperty<number>('Offset', 'ADBE Text Selector Offset', 'percent', 0, {
      unit: '%', speedPerPixel: 0.5,
    }),
    units: 'percent',
    shape: 'square',
    mode: 'add',
    amount: createProperty<number>('Amount', 'ADBE Text Selector Amount', 'percent', 100, {
      min: 0, max: 100, unit: '%', speedPerPixel: 0.5,
    }),
    easeHigh: createProperty<number>('Ease High', 'ADBE Text Ease High', 'percent', 0, {
      min: -100, max: 100, unit: '%', speedPerPixel: 0.5,
    }),
    easeLow: createProperty<number>('Ease Low', 'ADBE Text Ease Low', 'percent', 0, {
      min: -100, max: 100, unit: '%', speedPerPixel: 0.5,
    }),
  };
}

export function createAnimatorProperties(): TextAnimatorProperties {
  return {
    position: createProperty<Vec2>('Position', 'ADBE Text Position', 'vec2', [0, 0], {
      dimensionNames: ['X', 'Y'],
    }),
    scale: createProperty<Vec2>('Scale', 'ADBE Text Scale', 'vec2', [100, 100], {
      unit: '%', dimensionNames: ['Width', 'Height'], speedPerPixel: 0.5,
    }),
    rotation: createProperty<number>('Rotation', 'ADBE Text Rotation', 'angle', 0, { unit: '°' }),
    opacity: createProperty<number>('Opacity', 'ADBE Text Opacity', 'percent', 100, {
      min: 0, max: 100, unit: '%', speedPerPixel: 0.5,
    }),
    tracking: createProperty<number>('Tracking', 'ADBE Text Tracking', 'number', 0),
    fillColor: createProperty<RGBA>('Fill Color', 'ADBE Text Fill Color', 'color', [1, 1, 1, 1]),
    enabled: {
      position: true,
      scale: false,
      rotation: false,
      opacity: true,
      tracking: false,
      fillColor: false,
    },
  };
}

/** Falloff across the selected range, before easing. */
function shapeValue(shape: SelectorShape, t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  switch (shape) {
    case 'ramp-up': return clamped;
    case 'ramp-down': return 1 - clamped;
    case 'triangle': return 1 - Math.abs(clamped * 2 - 1);
    case 'round': return Math.sin(clamped * Math.PI);
    case 'smooth': {
      const s = 1 - Math.abs(clamped * 2 - 1);
      return s * s * (3 - 2 * s);
    }
    case 'square':
    default:
      return 1;
  }
}

/**
 * Ease High and Ease Low bend the falloff towards the top or the bottom of its
 * range, the way After Effects' selector easing does.
 */
function applyEase(value: number, easeHigh: number, easeLow: number): number {
  let out = Math.min(1, Math.max(0, value));
  const high = easeHigh / 100;
  const low = easeLow / 100;
  if (high > 0) out = mix(out, smoothstep(out), high);
  else if (high < 0) out = mix(out, out ** 0.5, -high);
  if (low > 0) out = mix(out, out ** 2, low);
  else if (low < 0) out = mix(out, 1 - (1 - out) ** 2, -low);
  return Math.min(1, Math.max(0, out));
}

function mix(a: number, b: number, t: number): number { return a + (b - a) * t; }
function smoothstep(t: number): number { return t * t * (3 - 2 * t); }

/** How strongly one selector covers a character. */
export function selectorWeight(
  selector: TextRangeSelector,
  time: number,
  index: number,
  count: number,
): number {
  if (count === 0) return 0;
  const scale = selector.units === 'percent' ? count / 100 : 1;
  const offset = valueAtTime(selector.offset, time) * scale;
  let start = valueAtTime(selector.start, time) * scale + offset;
  let end = valueAtTime(selector.end, time) * scale + offset;
  if (end < start) [start, end] = [end, start];

  // Characters are sampled at their centre, so a range never half-covers one.
  const position = index + 0.5;
  const span = end - start;
  if (span <= 0) return 0;
  if (position < start || position > end) return 0;

  const t = (position - start) / span;
  const shaped = shapeValue(selector.shape, t);
  const eased = applyEase(
    shaped,
    valueAtTime(selector.easeHigh, time),
    valueAtTime(selector.easeLow, time),
  );
  return eased * (valueAtTime(selector.amount, time) / 100);
}

/**
 * Combined selector weight for a character: add selectors accumulate,
 * subtract selectors take away. With only subtract selectors the animator
 * starts fully applied and is carved back, as After Effects does.
 */
export function animatorWeight(
  animator: TextAnimator,
  time: number,
  index: number,
  count: number,
): number {
  const hasAdd = animator.selectors.some((s) => s.mode === 'add');
  let total = hasAdd ? 0 : 1;
  for (const selector of animator.selectors) {
    const weight = selectorWeight(selector, time, index, count);
    if (selector.mode === 'add') total += weight;
    else total -= weight;
  }
  return Math.min(1, Math.max(0, total));
}

export interface GlyphTransform {
  position: Vec2;
  scale: Vec2;
  rotation: number;
  opacity: number;
  fillColor: RGBA | null;
}

/** The accumulated animator transform for one character. */
export function glyphTransform(
  layer: TextLayer,
  time: number,
  index: number,
  count: number,
): GlyphTransform {
  const out: GlyphTransform = {
    position: [0, 0],
    scale: [100, 100],
    rotation: 0,
    opacity: 100,
    fillColor: null,
  };

  for (const animator of layer.animators) {
    const weight = animatorWeight(animator, time, index, count);
    if (weight === 0) continue;
    const { properties } = animator;

    if (properties.enabled.position) {
      const p = valueAtTime(properties.position, time);
      out.position[0] += p[0] * weight;
      out.position[1] += p[1] * weight;
    }
    if (properties.enabled.scale) {
      const s = valueAtTime(properties.scale, time);
      out.scale[0] *= 1 + ((s[0] / 100) - 1) * weight;
      out.scale[1] *= 1 + ((s[1] / 100) - 1) * weight;
    }
    if (properties.enabled.rotation) {
      out.rotation += valueAtTime(properties.rotation, time) * weight;
    }
    if (properties.enabled.opacity) {
      const o = valueAtTime(properties.opacity, time);
      out.opacity *= 1 + ((o / 100) - 1) * weight;
    }
    if (properties.enabled.fillColor) {
      const c = valueAtTime(properties.fillColor, time);
      const base = out.fillColor ?? layer.text.fillColor;
      out.fillColor = [
        base[0] + (c[0] - base[0]) * weight,
        base[1] + (c[1] - base[1]) * weight,
        base[2] + (c[2] - base[2]) * weight,
        base[3] + (c[3] - base[3]) * weight,
      ];
    }
  }
  return out;
}

/** Per-character tracking contributed by the animators, used during layout. */
export function animatorTracking(layer: TextLayer, time: number, count: number) {
  return (index: number): number => {
    let extra = 0;
    for (const animator of layer.animators) {
      if (!animator.properties.enabled.tracking) continue;
      const weight = animatorWeight(animator, time, index, count);
      extra += valueAtTime(animator.properties.tracking, time) * weight;
    }
    return extra;
  };
}

/** Lay out a text layer including any animator tracking. */
export function layoutTextLayer(layer: TextLayer, time: number): TextLayout {
  const base = layoutText(layer.text);
  if (layer.animators.length === 0) return base;
  return layoutText(layer.text, animatorTracking(layer, time, base.count));
}
