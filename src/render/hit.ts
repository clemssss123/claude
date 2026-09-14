import { isLayerActiveAt, layerBounds, renderableLayers, worldMatrix } from '@/core/layer';
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
  const b = layerBounds(layer);
  return (
    local[0] >= b.x && local[0] <= b.x + b.width
    && local[1] >= b.y && local[1] <= b.y + b.height
  );
}
