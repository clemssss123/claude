import { describe, expect, it } from 'vitest';
import { addLayer, createComposition } from '../composition';
import { createSolidLayer, layerOutline } from '../layer';
import { hexToRgba, valueAtTime } from '../property';
import { isBezierPath } from '../path';
import {
  allEffectDefinitions, createEffectInstance, getEffectDefinition,
} from '../../render/effects';

function comp() {
  return createComposition({ width: 640, height: 360, duration: 5 });
}

describe('effect registry', () => {
  it('registers a broad first set across categories', () => {
    const definitions = allEffectDefinitions();
    expect(definitions.length).toBeGreaterThanOrEqual(25);
    const categories = new Set(definitions.map((d) => d.category));
    for (const category of [
      'Blur & Sharpen', 'Color Correction', 'Stylize', 'Distort', 'Generate', 'Keying',
    ]) {
      expect(categories.has(category)).toBe(true);
    }
  });

  it('gives every effect a unique match name and at least one parameter', () => {
    const definitions = allEffectDefinitions();
    const names = definitions.map((d) => d.matchName);
    expect(new Set(names).size).toBe(names.length);
    for (const definition of definitions) {
      expect(definition.params.length).toBeGreaterThan(0);
      expect(definition.name.length).toBeGreaterThan(0);
    }
  });

  it('declares a default that matches each parameter kind', () => {
    for (const definition of allEffectDefinitions()) {
      for (const param of definition.params) {
        if (param.kind === 'vec2') {
          expect(Array.isArray(param.default) && param.default.length === 2).toBe(true);
        } else if (param.kind === 'color') {
          expect(Array.isArray(param.default) && param.default.length === 4).toBe(true);
        } else {
          expect(typeof param.default).toBe('number');
        }
        if (param.kind === 'select') {
          expect((param.options ?? []).length).toBeGreaterThan(1);
        }
      }
    }
  });

  it('never asks for negative headroom', () => {
    for (const definition of allEffectDefinitions()) {
      if (!definition.margin) continue;
      const get = (<T,>(key: string): T => {
        const param = definition.params.find((p) => p.key === key);
        return (param?.default ?? 0) as T;
      }) as <T>(key: string) => T;
      expect(definition.margin(get as never)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('effect instances', () => {
  it('builds one animatable property per declared parameter', () => {
    const instance = createEffectInstance('ADBE Gaussian Blur 2');
    expect(instance).toBeDefined();
    const definition = getEffectDefinition('ADBE Gaussian Blur 2')!;
    expect(Object.keys(instance!.params)).toHaveLength(definition.params.length);

    const blurriness = instance!.params.blurriness;
    expect(blurriness.animated).toBe(false);
    expect(valueAtTime(blurriness, 0)).toBe(20);
    expect(blurriness.min).toBe(0);
  });

  it('carries colour and vector defaults through unchanged', () => {
    const instance = createEffectInstance('ADBE Tint')!;
    expect(valueAtTime(instance.params.black, 0)).toEqual([0, 0, 0, 1]);
    expect(valueAtTime(instance.params.white, 0)).toEqual([1, 1, 1, 1]);

    const ramp = createEffectInstance('ADBE Ramp')!;
    expect(valueAtTime(ramp.params.start, 0)).toEqual([0, -200]);
  });

  it('returns nothing for an unknown effect', () => {
    expect(createEffectInstance('NOT A REAL EFFECT')).toBeUndefined();
  });

  it('never produces a path-valued effect parameter', () => {
    for (const definition of allEffectDefinitions()) {
      const instance = createEffectInstance(definition.matchName)!;
      for (const property of Object.values(instance.params)) {
        expect(isBezierPath(valueAtTime(property, 0))).toBe(false);
      }
    }
  });
});

describe('effects on layers', () => {
  it('starts every layer with an empty effect list', () => {
    const c = comp();
    const layer = addLayer(c, createSolidLayer(c, 'S', hexToRgba('#fff')));
    expect(layer.effects).toEqual([]);
  });

  it('lists effect parameters in the layer outline under Effects', () => {
    const c = comp();
    const layer = addLayer(c, createSolidLayer(c, 'S', hexToRgba('#fff')));
    layer.effects.push(createEffectInstance('ADBE Gaussian Blur 2')!);

    const nodes = layerOutline(layer);
    const groups = nodes.filter((n) => n.kind === 'group').map((n) => n.name);
    expect(groups).toContain('Effects');
    expect(groups).toContain('Gaussian Blur');

    const paths = nodes
      .filter((n) => n.kind === 'prop')
      .map((n) => (n.kind === 'prop' ? n.path : ''));
    expect(paths).toContain('effects.0.params.blurriness');
  });

  it('puts Effects above Transform, as After Effects does', () => {
    const c = comp();
    const layer = addLayer(c, createSolidLayer(c, 'S', hexToRgba('#fff')));
    layer.effects.push(createEffectInstance('ADBE Invert')!);

    const groups = layerOutline(layer).filter((n) => n.kind === 'group').map((n) => n.name);
    expect(groups.indexOf('Effects')).toBeLessThan(groups.indexOf('Transform'));
  });

  it('keeps each effect instance independent', () => {
    const a = createEffectInstance('ADBE Gaussian Blur 2')!;
    const b = createEffectInstance('ADBE Gaussian Blur 2')!;
    a.params.blurriness.value = 99;
    expect(valueAtTime(b.params.blurriness, 0)).toBe(20);
    expect(a.id).not.toBe(b.id);
  });
});
