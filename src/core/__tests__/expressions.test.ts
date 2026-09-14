import { beforeEach, describe, expect, it } from 'vitest';
import { addLayer } from '../composition';
import { createNullLayer, createSolidLayer } from '../layer';
import {
  beginExpressionFrame, expressionErrorFor, setExpressionContext,
} from '../expressions';
import { createProject } from '../project';
import { addKeyframe, hexToRgba, setAnimated, valueAtTime } from '../property';
import type { Composition, Project, Vec2 } from '../types';

let project: Project;
let comp: Composition;

function setup() {
  project = createProject('Expressions');
  comp = project.compositions[0];
  comp.frameRate = 30;
  setExpressionContext(project, comp);
  beginExpressionFrame();
}

beforeEach(setup);

function solid(name: string) {
  return addLayer(comp, createSolidLayer(comp, name, hexToRgba('#ffffff')));
}

describe('expression evaluation', () => {
  it('evaluates an expression against the property value', () => {
    const layer = solid('A');
    layer.transform.opacity.value = 40;
    layer.transform.opacity.expression = 'value + 10';
    expect(valueAtTime(layer.transform.opacity, 0)).toBe(50);
  });

  it('exposes time', () => {
    const layer = solid('A');
    layer.transform.rotation.expression = 'time * 90';
    expect(valueAtTime(layer.transform.rotation, 2)).toBe(180);
  });

  it('spreads a scalar result across a vector property', () => {
    const layer = solid('A');
    layer.transform.position.expression = '100';
    expect(valueAtTime(layer.transform.position, 0)).toEqual([100, 100]);
  });

  it('accepts an array result for a vector property', () => {
    const layer = solid('A');
    layer.transform.position.expression = '[10, 20]';
    expect(valueAtTime(layer.transform.position, 0)).toEqual([10, 20]);
  });

  it('runs a multi-line script and returns its last expression', () => {
    const layer = solid('A');
    layer.transform.opacity.expression = 'var half = 50;\nvar bump = 25;\nhalf + bump';
    expect(valueAtTime(layer.transform.opacity, 0)).toBe(75);
  });

  it('honours an explicit return', () => {
    const layer = solid('A');
    layer.transform.opacity.expression = 'if (time > 1) { return 0; }\nreturn 100;';
    expect(valueAtTime(layer.transform.opacity, 0)).toBe(100);
    beginExpressionFrame();
    expect(valueAtTime(layer.transform.opacity, 2)).toBe(0);
  });
});

describe('expression scope', () => {
  it('reads another layer through thisComp', () => {
    const target = solid('Target');
    target.transform.position.value = [123, 456];
    const follower = solid('Follower');
    follower.transform.position.expression = 'thisComp.layer("Target").transform.position';
    expect(valueAtTime(follower.transform.position, 0)).toEqual([123, 456]);
  });

  it('reads a layer by index and exposes its own index', () => {
    solid('Bottom');
    const top = solid('Top');
    top.transform.opacity.expression = 'index * 10';
    // Layers are added to the top of the stack, so Top is layer 1.
    expect(valueAtTime(top.transform.opacity, 0)).toBe(10);
    expect(comp.layers[0].name).toBe('Top');
  });

  it('exposes composition properties', () => {
    const layer = solid('A');
    layer.transform.position.expression = '[thisComp.width / 2, thisComp.height / 2]';
    expect(valueAtTime(layer.transform.position, 0)).toEqual([comp.width / 2, comp.height / 2]);
  });

  it('interpolates with linear and ease', () => {
    const layer = solid('A');
    layer.transform.opacity.expression = 'linear(time, 0, 2, 0, 100)';
    expect(valueAtTime(layer.transform.opacity, 1)).toBeCloseTo(50, 6);

    beginExpressionFrame();
    layer.transform.rotation.expression = 'ease(time, 0, 2, 0, 100)';
    expect(valueAtTime(layer.transform.rotation, 1)).toBeCloseTo(50, 6);
    beginExpressionFrame();
    expect(valueAtTime(layer.transform.rotation, 0.5)).toBeLessThan(25);
  });

  it('clamps and measures length', () => {
    const layer = solid('A');
    layer.transform.opacity.expression = 'clamp(500, 0, 100)';
    expect(valueAtTime(layer.transform.opacity, 0)).toBe(100);

    beginExpressionFrame();
    layer.transform.rotation.expression = 'length([3, 4])';
    expect(valueAtTime(layer.transform.rotation, 0)).toBe(5);
  });

  it('samples its own property at another time', () => {
    const layer = solid('A');
    const opacity = layer.transform.opacity;
    setAnimated(opacity, 0, true);
    opacity.keyframes = [];
    addKeyframe(opacity, 0, 0);
    addKeyframe(opacity, 1, 100);
    opacity.expression = 'valueAtTime(time - 0.5)';
    expect(valueAtTime(opacity, 1)).toBeCloseTo(50, 6);
  });

  it('reads an effect parameter', () => {
    const layer = solid('A');
    layer.effects.push({
      id: 'fx1',
      matchName: 'ADBE Gaussian Blur 2',
      name: 'Gaussian Blur',
      enabled: true,
      params: {
        blurriness: {
          id: 'p1', name: 'Blurriness', matchName: 'b', kind: 'number',
          value: 12, keyframes: [], animated: false, expression: null,
        },
      },
    });
    layer.transform.rotation.expression = 'effect("Gaussian Blur")("Blurriness")';
    expect(valueAtTime(layer.transform.rotation, 0)).toBe(12);
  });

  it('converts between layer and composition space', () => {
    const layer = solid('A');
    layer.transform.anchorPoint.value = [0, 0];
    layer.transform.position.value = [100, 50];
    layer.transform.rotation.expression = 'toComp([0, 0])[0]';
    expect(valueAtTime(layer.transform.rotation, 0)).toBe(100);
  });
});

describe('wiggle and randomness', () => {
  it('moves around the property value without running away', () => {
    const layer = solid('A');
    layer.transform.position.value = [500, 500] as Vec2;
    layer.transform.position.expression = 'wiggle(4, 40)';

    const samples: Vec2[] = [];
    for (let i = 0; i < 40; i += 1) {
      beginExpressionFrame();
      samples.push(valueAtTime(layer.transform.position, i / 10) as Vec2);
    }
    for (const [x, y] of samples) {
      expect(Math.abs(x - 500)).toBeLessThanOrEqual(90);
      expect(Math.abs(y - 500)).toBeLessThanOrEqual(90);
    }
    // It has to actually move, and not identically on both axes.
    const xs = new Set(samples.map((s) => Math.round(s[0])));
    expect(xs.size).toBeGreaterThan(5);
    expect(samples.some(([x, y]) => Math.round(x) !== Math.round(y))).toBe(true);
  });

  it('is stable for the same property and time', () => {
    const layer = solid('A');
    layer.transform.opacity.expression = 'wiggle(3, 20)';
    const first = valueAtTime(layer.transform.opacity, 1.25);
    beginExpressionFrame();
    const second = valueAtTime(layer.transform.opacity, 1.25);
    expect(second).toBe(first);
  });

  it('gives different layers different wiggles', () => {
    const a = solid('A');
    const b = solid('B');
    a.transform.opacity.expression = 'wiggle(3, 20)';
    b.transform.opacity.expression = 'wiggle(3, 20)';
    expect(valueAtTime(a.transform.opacity, 0.7)).not.toBe(valueAtTime(b.transform.opacity, 0.7));
  });

  it('keeps random inside its range', () => {
    const layer = solid('A');
    layer.transform.opacity.expression = 'random(10, 20)';
    for (let i = 0; i < 20; i += 1) {
      beginExpressionFrame();
      const value = valueAtTime(layer.transform.opacity, i / 30) as number;
      expect(value).toBeGreaterThanOrEqual(10);
      expect(value).toBeLessThanOrEqual(20);
    }
  });
});

describe('looping', () => {
  function ramp() {
    const layer = solid('A');
    const opacity = layer.transform.opacity;
    setAnimated(opacity, 0, true);
    opacity.keyframes = [];
    addKeyframe(opacity, 0, 0);
    addKeyframe(opacity, 1, 100);
    return opacity;
  }

  it('cycles past the last keyframe', () => {
    const opacity = ramp();
    opacity.expression = 'loopOut("cycle")';
    expect(valueAtTime(opacity, 1.5)).toBeCloseTo(50, 4);
    beginExpressionFrame();
    expect(valueAtTime(opacity, 2.25)).toBeCloseTo(25, 4);
  });

  it('ping-pongs', () => {
    const opacity = ramp();
    opacity.expression = 'loopOut("pingpong")';
    expect(valueAtTime(opacity, 1.25)).toBeCloseTo(75, 4);
  });

  it('leaves the keyframed range alone', () => {
    const opacity = ramp();
    opacity.expression = 'loopOut("cycle")';
    expect(valueAtTime(opacity, 0.5)).toBeCloseTo(50, 4);
  });
});

describe('failure handling', () => {
  it('falls back and reports a syntax error', () => {
    const layer = solid('A');
    layer.transform.opacity.value = 33;
    layer.transform.opacity.expression = 'value +++';
    expect(valueAtTime(layer.transform.opacity, 0)).toBe(33);
    expect(expressionErrorFor(layer.transform.opacity.id)).toBeDefined();
  });

  it('falls back when the expression throws', () => {
    const layer = solid('A');
    layer.transform.opacity.value = 70;
    layer.transform.opacity.expression = 'thisComp.layer("Nope").transform.opacity';
    expect(valueAtTime(layer.transform.opacity, 0)).toBe(70);
    expect(expressionErrorFor(layer.transform.opacity.id)).toBeDefined();
  });

  it('survives a property that refers to itself', () => {
    const layer = solid('A');
    layer.transform.opacity.value = 25;
    layer.transform.opacity.expression = 'thisComp.layer("A").transform.opacity + 1';
    // The cycle is caught, so the inner read falls back to the stored value.
    expect(valueAtTime(layer.transform.opacity, 0)).toBe(26);
  });

  it('clears the error once the expression is fixed', () => {
    const layer = solid('A');
    layer.transform.opacity.expression = 'value +++';
    valueAtTime(layer.transform.opacity, 0);
    expect(expressionErrorFor(layer.transform.opacity.id)).toBeDefined();

    layer.transform.opacity.expression = 'value';
    beginExpressionFrame();
    valueAtTime(layer.transform.opacity, 0);
    expect(expressionErrorFor(layer.transform.opacity.id)).toBeUndefined();
  });

  it('does not let a null layer expression break the chain', () => {
    const control = addLayer(comp, createNullLayer(comp, 'Control'));
    control.transform.position.value = [10, 20];
    const layer = solid('A');
    layer.transform.position.expression = 'thisComp.layer("Control").transform.position';
    expect(valueAtTime(layer.transform.position, 0)).toEqual([10, 20]);
  });
});
