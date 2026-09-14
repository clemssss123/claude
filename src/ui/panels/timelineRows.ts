import { transformProperties } from '@/core/layer';
import type { AnyProperty, Composition, Id, Layer } from '@/core/types';

export const ROW_HEIGHT = 26;
export const RULER_HEIGHT = 30;

export type TimelineRow =
  | { kind: 'layer'; layerId: Id; layer: Layer }
  | { kind: 'group'; layerId: Id; name: string }
  | { kind: 'prop'; layerId: Id; path: string; property: AnyProperty; name: string };

/**
 * Flatten the composition into the timeline's visible row list. The outline
 * and the track canvas both walk this, which is what keeps them aligned.
 */
export function buildRows(
  comp: Composition,
  revealed: Record<Id, string[]>,
  shyHidden: boolean,
): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const layer of comp.layers) {
    if (shyHidden && layer.shy) continue;
    rows.push({ kind: 'layer', layerId: layer.id, layer });

    const paths = revealed[layer.id] ?? [];
    if (paths.length === 0) continue;

    const descriptors = transformProperties(layer).filter((d) => paths.includes(d.path));
    if (descriptors.length === 0) continue;

    rows.push({ kind: 'group', layerId: layer.id, name: 'Transform' });
    for (const d of descriptors) {
      rows.push({
        kind: 'prop',
        layerId: layer.id,
        path: d.path,
        property: d.property,
        name: d.property.name,
      });
    }
  }
  return rows;
}
