import type { BlendMode } from '@/core/types';

/**
 * Canvas composite operation for each blend mode. The separable and
 * non-separable modes map one-to-one onto the canvas spec; "normal" and "add"
 * are the two that need renaming.
 */
const CANVAS_BLEND: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  add: 'lighter',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color-dodge': 'color-dodge',
  'color-burn': 'color-burn',
  'hard-light': 'hard-light',
  'soft-light': 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
};

export function canvasBlendMode(mode: BlendMode): GlobalCompositeOperation {
  return CANVAS_BLEND[mode] ?? 'source-over';
}

export function blendModeLabel(mode: BlendMode): string {
  return mode
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
