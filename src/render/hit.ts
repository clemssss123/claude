import { isLayerActiveAt, renderableLayers, worldMatrix } from '@/core/layer';
import { applyToPoint, invert } from '@/core/matrix';
import type { Composition, Layer, Vec2 } from '@/core/types';

/** Padding around zero-area layers (nulls) so they stay clickable. */
const NULL_HALF_SIZE = 50;

/**
 * Topmost layer under a composition-space point, or undefined.
 * Hit areas are the layer's source rectangle transformed into comp space.
 */
export function hitTestLayers(
  comp: Composition,
  point: Vec2,
  time: number,
): Layer | undefined {
  const layers = renderableLayers(comp);
  for (const layer of layers) {
    if (!isLayerActiveAt(layer, time) || layer.locked) continue;
    if (pointInLayer(comp, layer, point, time)) return layer;
  }
  return undefined;
}

export function pointInLayer(
  comp: Composition,
  layer: Layer,
  point: Vec2,
  time: number,
): boolean {
  const local = applyToPoint(invert(worldMatrix(comp, layer, time)), point);
  if (layer.type === 'null') {
    return Math.abs(local[0]) <= NULL_HALF_SIZE && Math.abs(local[1]) <= NULL_HALF_SIZE;
  }
  if (layer.type === 'text') {
    // Text is anchored at its own origin; use a generous box around it.
    const half = layer.text.fontSize;
    return (
      local[0] >= -layer.width && local[0] <= layer.width
      && local[1] >= -half && local[1] <= half
    );
  }
  return (
    local[0] >= 0 && local[0] <= layer.width
    && local[1] >= 0 && local[1] <= layer.height
  );
}
