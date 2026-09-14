import { uid } from './uid';
import type { Composition, Id, Layer, Marker, RGBA } from './types';

export interface CompositionOptions {
  name?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  duration?: number;
  bgColor?: RGBA;
}

export function createComposition(options: CompositionOptions = {}): Composition {
  const duration = options.duration ?? 10;
  return {
    id: uid('comp'),
    name: options.name ?? 'Comp 1',
    width: options.width ?? 1920,
    height: options.height ?? 1080,
    frameRate: options.frameRate ?? 30,
    duration,
    bgColor: options.bgColor ?? [0, 0, 0, 1],
    layers: [],
    workAreaStart: 0,
    workAreaEnd: duration,
    markers: [],
    motionBlur: {
      enabled: false,
      shutterAngle: 180,
      shutterPhase: -90,
      samplesPerFrame: 16,
      adaptiveSampleLimit: 128,
    },
  };
}

export function findLayer(comp: Composition, id: Id): Layer | undefined {
  return comp.layers.find((l) => l.id === id);
}

export function layerIndex(comp: Composition, id: Id): number {
  return comp.layers.findIndex((l) => l.id === id);
}

/** New layers go to the top of the stack, as in After Effects. */
export function addLayer(comp: Composition, layer: Layer, atIndex = 0): Layer {
  layer.name = uniqueLayerName(comp, layer.name);
  comp.layers.splice(atIndex, 0, layer);
  return layer;
}

export function removeLayer(comp: Composition, id: Id): void {
  const index = layerIndex(comp, id);
  if (index < 0) return;
  comp.layers.splice(index, 1);
  // Orphan any children rather than leaving dangling parent references.
  for (const l of comp.layers) if (l.parentId === id) l.parentId = null;
}

export function moveLayer(comp: Composition, id: Id, toIndex: number): void {
  const from = layerIndex(comp, id);
  if (from < 0) return;
  const clamped = Math.min(comp.layers.length - 1, Math.max(0, toIndex));
  const [layer] = comp.layers.splice(from, 1);
  comp.layers.splice(clamped, 0, layer);
}

/** "Solid 1" -> "Solid 2" when the name is taken. */
export function uniqueLayerName(comp: Composition, name: string): string {
  const taken = new Set(comp.layers.map((l) => l.name));
  if (!taken.has(name)) return name;
  const match = /^(.*?)(\d+)$/.exec(name);
  const stem = match ? match[1] : `${name} `;
  let n = match ? Number(match[2]) + 1 : 2;
  while (taken.has(`${stem}${n}`)) n += 1;
  return `${stem}${n}`;
}

export function addMarker(comp: Composition, time: number, comment = ''): Marker {
  const marker: Marker = { id: uid('marker'), time, comment, duration: 0 };
  comp.markers.push(marker);
  comp.markers.sort((a, b) => a.time - b.time);
  return marker;
}

export function clampTimeToComp(comp: Composition, time: number): number {
  return Math.min(comp.duration, Math.max(0, time));
}
