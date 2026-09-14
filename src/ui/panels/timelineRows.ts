import { layerOutline } from '@/core/layer';
import type { OutlineNode } from '@/core/layer';
import type { AnyProperty, Composition, Id, Layer } from '@/core/types';

export const ROW_HEIGHT = 26;
export const RULER_HEIGHT = 30;

export type TimelineRow =
  | { kind: 'layer'; layerId: Id; layer: Layer }
  | {
      kind: 'group'; layerId: Id; key: string; name: string; depth: number;
      target?: Extract<OutlineNode, { kind: 'group' }>['target'];
    }
  | {
      kind: 'prop'; layerId: Id; key: string; path: string;
      property: AnyProperty; name: string; depth: number;
    }
  | {
      kind: 'expression'; layerId: Id; key: string; path: string;
      property: AnyProperty; depth: number;
    };

/**
 * Flatten the composition into the timeline's visible row list. The outline
 * and the track canvas both walk this, which is what keeps them aligned.
 *
 * A property row appears when its path is revealed; a group row appears when
 * any property beneath it is.
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
    const visible = new Set(paths);

    for (const node of layerOutline(layer)) {
      if (node.kind === 'prop') {
        if (!visible.has(node.path)) continue;
        rows.push({
          kind: 'prop',
          layerId: layer.id,
          key: `${layer.id}:${node.path}`,
          path: node.path,
          property: node.property,
          name: node.name,
          depth: node.depth,
        });
        if (node.property.expression !== null && node.property.expression !== undefined) {
          rows.push({
            kind: 'expression',
            layerId: layer.id,
            key: `${layer.id}:${node.path}:expr`,
            path: node.path,
            property: node.property,
            depth: node.depth + 1,
          });
        }
      } else if (node.childPaths.some((path) => visible.has(path))) {
        rows.push({
          kind: 'group',
          layerId: layer.id,
          key: `${layer.id}:${node.key}`,
          name: node.name,
          depth: node.depth,
          target: node.target,
        });
      }
    }
  }
  return rows;
}
