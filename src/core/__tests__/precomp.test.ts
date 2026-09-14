import { describe, expect, it } from 'vitest';
import { addLayer, createComposition } from '../composition';
import {
  createPrecompLayer, createSolidLayer, enableTimeRemap, layerOutline, sourceTimeAt,
} from '../layer';
import { addKeyframe, hexToRgba, valueAtTime } from '../property';

function comps() {
  const outer = createComposition({ name: 'Outer', duration: 10, frameRate: 30 });
  const inner = createComposition({ name: 'Inner', duration: 4, frameRate: 30 });
  return { outer, inner };
}

describe('precomposition layers', () => {
  it('takes its size and name from the source composition', () => {
    const { outer, inner } = comps();
    inner.width = 640;
    inner.height = 360;
    const layer = addLayer(outer, createPrecompLayer(outer, inner));
    expect(layer.type).toBe('precomp');
    expect(layer.width).toBe(640);
    expect(layer.height).toBe(360);
    if (layer.type === 'precomp') expect(layer.compId).toBe(inner.id);
  });

  it('maps composition time to source time through the layer start', () => {
    const { outer, inner } = comps();
    const layer = addLayer(outer, createPrecompLayer(outer, inner));
    expect(sourceTimeAt(layer, 0)).toBe(0);

    layer.startTime = 2;
    expect(sourceTimeAt(layer, 2)).toBe(0);
    expect(sourceTimeAt(layer, 3.5)).toBeCloseTo(1.5, 9);
  });
});

describe('time remapping', () => {
  it('starts as a no-op mapping of the layer span onto the source', () => {
    const { outer, inner } = comps();
    const layer = addLayer(outer, createPrecompLayer(outer, inner));
    layer.outPoint = 4;
    enableTimeRemap(layer, inner.duration);

    expect(layer.timeRemap).not.toBeNull();
    expect(layer.timeRemap!.keyframes).toHaveLength(2);
    expect(sourceTimeAt(layer, 0)).toBeCloseTo(0, 9);
    expect(sourceTimeAt(layer, 4)).toBeCloseTo(4, 9);
    expect(sourceTimeAt(layer, 2)).toBeCloseTo(2, 9);
  });

  it('plays the source backwards when the keyframes are reversed', () => {
    const { outer, inner } = comps();
    const layer = addLayer(outer, createPrecompLayer(outer, inner));
    layer.outPoint = 4;
    enableTimeRemap(layer, inner.duration);

    const remap = layer.timeRemap!;
    remap.keyframes[0].value = 4;
    remap.keyframes[1].value = 0;
    expect(sourceTimeAt(layer, 0)).toBeCloseTo(4, 9);
    expect(sourceTimeAt(layer, 4)).toBeCloseTo(0, 9);
    expect(sourceTimeAt(layer, 1)).toBeCloseTo(3, 9);
  });

  it('holds the source still between equal keyframes', () => {
    const { outer, inner } = comps();
    const layer = addLayer(outer, createPrecompLayer(outer, inner));
    enableTimeRemap(layer, inner.duration);
    const remap = layer.timeRemap!;
    addKeyframe(remap, 5, 1);
    addKeyframe(remap, 8, 1);
    expect(valueAtTime(remap, 6.5)).toBeCloseTo(1, 9);
  });

  it('shows Time Remap in the outline above Transform', () => {
    const { outer, inner } = comps();
    const layer = addLayer(outer, createPrecompLayer(outer, inner));
    enableTimeRemap(layer, inner.duration);

    const nodes = layerOutline(layer);
    const paths = nodes
      .filter((n) => n.kind === 'prop')
      .map((n) => (n.kind === 'prop' ? n.path : ''));
    expect(paths).toContain('timeRemap');
    expect(paths.indexOf('timeRemap')).toBeLessThan(paths.indexOf('transform.position'));
  });

  it('leaves layers without a source alone', () => {
    const { outer } = comps();
    const solid = addLayer(outer, createSolidLayer(outer, 'S', hexToRgba('#fff')));
    expect(solid.timeRemap).toBeNull();
    expect(sourceTimeAt(solid, 3)).toBe(3);
  });
});
