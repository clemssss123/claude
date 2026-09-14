import { describe, expect, it } from 'vitest';
import { addLayer, createComposition } from '../composition';
import {
  createNullLayer, createSolidLayer, isLayerActiveAt, layerCorners, localMatrix,
  worldMatrix, wouldCreateCycle,
} from '../layer';
import { applyToPoint, invert, multiply, IDENTITY } from '../matrix';
import { hexToRgba } from '../property';

function comp() {
  return createComposition({ width: 1000, height: 1000, duration: 5 });
}

describe('matrix', () => {
  it('round-trips through its inverse', () => {
    const c = comp();
    const layer = addLayer(c, createSolidLayer(c, 'S', hexToRgba('#fff')));
    layer.transform.position.value = [123, 456];
    layer.transform.rotation.value = 37;
    layer.transform.scale.value = [140, 60];

    const m = worldMatrix(c, layer, 0);
    const round = applyToPoint(invert(m), applyToPoint(m, [10, 20]));
    expect(round[0]).toBeCloseTo(10, 6);
    expect(round[1]).toBeCloseTo(20, 6);
  });

  it('multiplies to the identity', () => {
    const m = multiply(IDENTITY, IDENTITY);
    expect(m).toEqual(IDENTITY);
  });
});

describe('layer transform', () => {
  it('places the anchor point at the position', () => {
    const c = comp();
    const layer = addLayer(c, createSolidLayer(c, 'S', hexToRgba('#fff')));
    layer.width = 200;
    layer.height = 100;
    layer.transform.anchorPoint.value = [100, 50];
    layer.transform.position.value = [400, 300];

    const m = localMatrix(layer, 0);
    const anchorInComp = applyToPoint(m, [100, 50]);
    expect(anchorInComp[0]).toBeCloseTo(400, 6);
    expect(anchorInComp[1]).toBeCloseTo(300, 6);
  });

  it('scales about the anchor point', () => {
    const c = comp();
    const layer = addLayer(c, createSolidLayer(c, 'S', hexToRgba('#fff')));
    layer.width = 100;
    layer.height = 100;
    layer.transform.anchorPoint.value = [50, 50];
    layer.transform.position.value = [500, 500];
    layer.transform.scale.value = [200, 200];

    const corners = layerCorners(c, layer, 0);
    expect(corners[0][0]).toBeCloseTo(400, 6);
    expect(corners[0][1]).toBeCloseTo(400, 6);
    expect(corners[2][0]).toBeCloseTo(600, 6);
    expect(corners[2][1]).toBeCloseTo(600, 6);
  });

  it('rotates clockwise for positive degrees, matching screen space', () => {
    const c = comp();
    const layer = addLayer(c, createSolidLayer(c, 'S', hexToRgba('#fff')));
    layer.transform.anchorPoint.value = [0, 0];
    layer.transform.position.value = [0, 0];
    layer.transform.rotation.value = 90;

    const p = applyToPoint(localMatrix(layer, 0), [10, 0]);
    expect(p[0]).toBeCloseTo(0, 6);
    expect(p[1]).toBeCloseTo(10, 6);
  });

  it('inherits the parent transform', () => {
    const c = comp();
    const parent = addLayer(c, createNullLayer(c, 'Null'));
    const child = addLayer(c, createSolidLayer(c, 'Child', hexToRgba('#fff')));
    parent.transform.anchorPoint.value = [0, 0];
    parent.transform.position.value = [100, 0];
    parent.transform.scale.value = [200, 200];
    child.transform.anchorPoint.value = [0, 0];
    child.transform.position.value = [50, 0];
    child.parentId = parent.id;

    const p = applyToPoint(worldMatrix(c, child, 0), [0, 0]);
    expect(p[0]).toBeCloseTo(200, 6); // 100 + 50 * 2
    expect(p[1]).toBeCloseTo(0, 6);
  });

  it('refuses parenting that would form a cycle', () => {
    const c = comp();
    const a = addLayer(c, createNullLayer(c, 'A'));
    const b = addLayer(c, createNullLayer(c, 'B'));
    b.parentId = a.id;
    expect(wouldCreateCycle(c, a.id, b.id)).toBe(true);
    expect(wouldCreateCycle(c, b.id, a.id)).toBe(false);
    expect(wouldCreateCycle(c, a.id, a.id)).toBe(true);
  });

  it('respects in and out points', () => {
    const c = comp();
    const layer = addLayer(c, createSolidLayer(c, 'S', hexToRgba('#fff')));
    layer.inPoint = 1;
    layer.outPoint = 3;
    expect(isLayerActiveAt(layer, 0.5)).toBe(false);
    expect(isLayerActiveAt(layer, 1)).toBe(true);
    expect(isLayerActiveAt(layer, 2.99)).toBe(true);
    expect(isLayerActiveAt(layer, 3)).toBe(false);
    layer.enabled = false;
    expect(isLayerActiveAt(layer, 2)).toBe(false);
  });
});
