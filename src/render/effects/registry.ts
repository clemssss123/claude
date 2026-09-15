import { createProperty } from '@/core/property';
import { uid } from '@/core/uid';
import type { AnyProperty, EffectInstance, PropertyValue } from '@/core/types';
import type { Buffer, BufferPool } from '../buffers';

/**
 * The effect registry.
 *
 * An effect is a definition — a name, a parameter schema and a render
 * function — and adding one means adding a file, not touching the engine.
 * Parameters become ordinary animatable properties on the layer, so they
 * keyframe, graph, undo and save with everything else.
 */

export type EffectParamKind =
  | 'number' | 'percent' | 'angle' | 'vec2' | 'color' | 'checkbox' | 'select';

export interface EffectParamDef {
  key: string;
  name: string;
  kind: EffectParamKind;
  default: PropertyValue;
  min?: number;
  max?: number;
  unit?: string;
  dimensionNames?: string[];
  speedPerPixel?: number;
  /** Labels for a `select` parameter; the stored value is the index. */
  options?: string[];
}

export interface EffectContext {
  source: Buffer;
  dest: Buffer;
  /** Working area in pixels, already scaled by the render resolution. */
  width: number;
  height: number;
  /** Render resolution scale: 1 at full, 0.5 at half. */
  scale: number;
  time: number;
  /** Frames per second of the composition being rendered. */
  frameRate: number;
  pool: BufferPool;
  /** Parameter value at the current time. */
  get: <T extends PropertyValue>(key: string) => T;
  /**
   * The layer's own pixels at another time, in this same working area, or
   * null when that is not available — an adjustment layer has no source of
   * its own to re-render. Time effects such as Echo are built on this.
   */
  sampleAtTime?: (time: number) => Buffer | null;
}

export interface EffectDefinition {
  matchName: string;
  name: string;
  category: string;
  params: EffectParamDef[];
  /**
   * Pixels of headroom the effect needs outside the layer's own bounds, in
   * layer space. Blurs and glows paint past the edge; most effects do not.
   */
  margin?: (get: <T extends PropertyValue>(key: string) => T) => number;
  /** Write the result into `dest`, reading from `source`. */
  apply: (ctx: EffectContext) => void;
}

const registry = new Map<string, EffectDefinition>();

export function registerEffect(definition: EffectDefinition): void {
  registry.set(definition.matchName, definition);
}

export function getEffectDefinition(matchName: string): EffectDefinition | undefined {
  return registry.get(matchName);
}

export function allEffectDefinitions(): EffectDefinition[] {
  return [...registry.values()];
}

export function effectCategories(): string[] {
  return [...new Set(allEffectDefinitions().map((d) => d.category))];
}

/** Build a layer-ready instance, with one property per declared parameter. */
export function createEffectInstance(matchName: string): EffectInstance | undefined {
  const definition = registry.get(matchName);
  if (!definition) return undefined;

  const params: Record<string, AnyProperty> = {};
  for (const param of definition.params) {
    params[param.key] = createProperty(
      param.name,
      `${matchName}-${param.key}`,
      param.kind === 'select' || param.kind === 'checkbox' ? 'number' : param.kind,
      param.default,
      {
        min: param.min,
        max: param.max,
        unit: param.unit,
        dimensionNames: param.dimensionNames,
        speedPerPixel: param.speedPerPixel,
      },
    ) as AnyProperty;
  }

  return {
    id: uid('fx'),
    matchName,
    name: definition.name,
    enabled: true,
    params,
  };
}
