import { allProperties, transformProperties } from '@/core/layer';
import { findLayer } from '@/core/composition';
import type { AnyProperty, Composition, Id } from '@/core/types';
import type { PropertyRef } from '@/state/store';

/** One plotted line in the graph editor. */
export interface GraphTrack {
  key: string;
  layerId: Id;
  path: string;
  property: AnyProperty;
  /** Index into a vector value, or null for a scalar property. */
  dimension: number | null;
  name: string;
  color: string;
  /**
   * Whether temporal handles can be dragged on this line. A vector's value
   * graph is a reference graph — its dimensions share one easing curve, so
   * the handles live on the speed graph until the dimensions are separated.
   */
  editable: boolean;
}

const DIMENSION_COLORS = ['#e2685d', '#6ede8a', '#5aa9e6'];
const TRACK_COLORS = [
  '#e6c95a', '#7bd1e6', '#c58ae6', '#7be6b4', '#e68a5a', '#8a9ee6',
];

/**
 * Which curves the graph editor shows: the explicitly selected properties, or
 * failing that the animated properties revealed on the selected layers.
 */
export function buildGraphTracks(
  comp: Composition,
  selectedProperties: PropertyRef[],
  selectedLayerIds: Id[],
  revealed: Record<Id, string[]>,
  mode: 'value' | 'speed',
): GraphTrack[] {
  const refs: PropertyRef[] = selectedProperties.length > 0
    ? selectedProperties
    : selectedLayerIds.flatMap((layerId) => {
      const layer = findLayer(comp, layerId);
      if (!layer) return [];
      const paths = revealed[layerId] ?? [];
      const descriptors = paths.length > 0
        ? transformProperties(layer).filter((d) => paths.includes(d.path))
        : allProperties(layer);
      return descriptors
        .filter((d) => d.property.animated && d.property.keyframes.length > 0)
        .map((d) => ({ layerId, path: d.path }));
    });

  const tracks: GraphTrack[] = [];
  refs.forEach((ref, index) => {
    const layer = findLayer(comp, ref.layerId);
    if (!layer) return;
    const descriptor = allProperties(layer).find((d) => d.path === ref.path);
    if (!descriptor) return;
    const property = descriptor.property;
    if (!property.animated || property.keyframes.length === 0) return;

    const components = Array.isArray(property.value) ? property.value.length : 1;
    if (components === 1 || mode === 'speed') {
      tracks.push({
        key: `${ref.layerId}|${ref.path}`,
        layerId: ref.layerId,
        path: ref.path,
        property,
        dimension: null,
        name: `${layer.name} · ${property.name}`,
        color: TRACK_COLORS[index % TRACK_COLORS.length],
        editable: true,
      });
      return;
    }

    for (let dim = 0; dim < components; dim += 1) {
      tracks.push({
        key: `${ref.layerId}|${ref.path}|${dim}`,
        layerId: ref.layerId,
        path: ref.path,
        property,
        dimension: dim,
        name: `${layer.name} · ${property.name} ${property.dimensionNames?.[dim] ?? dim}`,
        color: DIMENSION_COLORS[dim % DIMENSION_COLORS.length],
        editable: false,
      });
    }
  });

  return tracks;
}
