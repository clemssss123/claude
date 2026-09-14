import { describe, expect, it } from 'vitest';
import { addLayer, createComposition } from '../composition';
import { createMask, createShapeLayer, createTextLayer, layerOutline } from '../layer';
import { pathBounds, pathLength, rectPath } from '../path';
import { addKeyframe, hexToRgba, setAnimated, valueAtTime } from '../property';
import {
  buildShapes, createEllipseShape, createFill, createOffsetPaths, createRectShape,
  createRepeater, createShapeGroup, createStroke, createTrimPaths,
} from '../shapes';
import {
  animatorWeight, createTextAnimator, glyphTransform, layoutText, layoutTextLayer,
  selectorWeight,
} from '../text';
import type { Vec2 } from '../types';

function comp() {
  return createComposition({ width: 1000, height: 1000, duration: 5 });
}

describe('shape layers', () => {
  it('builds a filled rectangle', () => {
    const group = createShapeGroup([createRectShape([200, 100]), createFill([1, 0, 0, 1])]);
    const shapes = buildShapes([group], 0);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].fill?.color).toEqual([1, 0, 0, 1]);
    expect(pathBounds(shapes[0].paths[0]).width).toBeCloseTo(200, 6);
  });

  it('carries strokes alongside the fill', () => {
    const group = createShapeGroup([
      createEllipseShape([100, 100]), createFill([1, 1, 1, 1]), createStroke([0, 0, 0, 1], 8),
    ]);
    const [shape] = buildShapes([group], 0);
    expect(shape.strokes).toHaveLength(1);
    expect(shape.strokes[0].width).toBe(8);
  });

  it('skips disabled items', () => {
    const rect = createRectShape([200, 100]);
    rect.enabled = false;
    expect(buildShapes([createShapeGroup([rect, createFill([1, 1, 1, 1])])], 0)).toHaveLength(0);
  });

  it('trims a path down to the requested fraction', () => {
    const trim = createTrimPaths();
    trim.end.value = 50;
    const group = createShapeGroup([createRectShape([100, 100]), trim, createFill([1, 1, 1, 1])]);
    const [shape] = buildShapes([group], 0);
    expect(pathLength(shape.paths[0])).toBeCloseTo(200, 0);
  });

  it('animates a trim over time', () => {
    const trim = createTrimPaths();
    setAnimated(trim.end, 0, true);
    trim.end.keyframes = [];
    addKeyframe(trim.end, 0, 0);
    addKeyframe(trim.end, 1, 100);
    const group = createShapeGroup([createRectShape([100, 100]), trim, createFill([1, 1, 1, 1])]);

    expect(pathLength(buildShapes([group], 0)[0].paths[0])).toBeCloseTo(0, 3);
    expect(pathLength(buildShapes([group], 0.5)[0].paths[0])).toBeCloseTo(200, 0);
    expect(pathLength(buildShapes([group], 1)[0].paths[0])).toBeCloseTo(400, 0);
  });

  it('repeats a shape with a stepped transform', () => {
    const repeater = createRepeater();
    repeater.copies.value = 3;
    const group = createShapeGroup([
      createRectShape([50, 50]), createFill([1, 1, 1, 1]), repeater,
    ]);
    const shapes = buildShapes([group], 0);
    expect(shapes).toHaveLength(3);
    // Copies are emitted furthest-first so the original paints on top.
    const offsets = shapes.map((s) => s.matrix.e);
    expect(offsets[0]).toBeCloseTo(240, 6);
    expect(offsets[1]).toBeCloseTo(120, 6);
    expect(offsets[2]).toBeCloseTo(0, 6);
  });

  it('fades repeater copies between start and end opacity', () => {
    const repeater = createRepeater();
    repeater.copies.value = 3;
    repeater.endOpacity.value = 0;
    const group = createShapeGroup([createRectShape([50, 50]), createFill([1, 1, 1, 1]), repeater]);
    const shapes = buildShapes([group], 0);
    // The last copy is drawn first and carries the end opacity.
    expect(shapes[0].opacity).toBeCloseTo(0, 6);
    expect(shapes[2].opacity).toBeCloseTo(1, 6);
  });

  it('offsets a path outward', () => {
    const offset = createOffsetPaths();
    offset.amount.value = 10;
    const group = createShapeGroup([createRectShape([100, 100]), offset, createFill([1, 1, 1, 1])]);
    const [shape] = buildShapes([group], 0);
    expect(pathBounds(shape.paths[0]).width).toBeGreaterThan(100);
  });

  it('applies a group transform to its own shapes only', () => {
    const inner = createShapeGroup([createRectShape([50, 50]), createFill([1, 1, 1, 1])], 'Inner');
    inner.transform.position.value = [200, 0];
    const outer = createShapeGroup([inner], 'Outer');
    const [shape] = buildShapes([outer], 0);
    expect(shape.matrix.e).toBeCloseTo(200, 6);
  });
});

describe('masks', () => {
  it('starts with no masks and adds one with a path', () => {
    const c = comp();
    const layer = addLayer(c, createShapeLayer(c));
    expect(layer.masks).toHaveLength(0);
    layer.masks.push(createMask(layer, rectPath([0, 0], [100, 100])));
    expect(layer.masks[0].mode).toBe('add');
    expect(valueAtTime(layer.masks[0].path, 0).vertices).toHaveLength(4);
  });

  it('animates a mask path between keyframes', () => {
    const c = comp();
    const layer = addLayer(c, createShapeLayer(c));
    const mask = createMask(layer, rectPath([0, 0], [100, 100]));
    layer.masks.push(mask);
    setAnimated(mask.path, 0, true);
    mask.path.keyframes = [];
    addKeyframe(mask.path, 0, rectPath([0, 0], [100, 100]));
    addKeyframe(mask.path, 1, rectPath([0, 0], [300, 300]));
    expect(pathBounds(valueAtTime(mask.path, 0.5)).width).toBeCloseTo(200, 4);
  });

  it('lists mask properties in the layer outline', () => {
    const c = comp();
    const layer = addLayer(c, createShapeLayer(c));
    layer.masks.push(createMask(layer, rectPath([0, 0], [10, 10])));
    const paths = layerOutline(layer)
      .filter((n) => n.kind === 'prop')
      .map((n) => (n.kind === 'prop' ? n.path : ''));
    expect(paths).toContain('masks.0.path');
    expect(paths).toContain('masks.0.feather');
    expect(paths).toContain('masks.0.opacity');
    expect(paths).toContain('masks.0.expansion');
  });
});

describe('text layout and animators', () => {
  it('lays out one glyph per character, line by line', () => {
    const c = comp();
    const layer = createTextLayer(c, 'AB\nC');
    const layout = layoutText(layer.text);
    expect(layout.count).toBe(3);
    expect(layout.glyphs.map((g) => g.character)).toEqual(['A', 'B', 'C']);
    expect(layout.glyphs[2].lineIndex).toBe(1);
    expect(layout.glyphs[2].y).toBeCloseTo(layer.text.fontSize * layer.text.leading, 6);
  });

  it('advances each glyph past the one before it', () => {
    const c = comp();
    const layer = createTextLayer(c, 'ABC');
    const layout = layoutText(layer.text);
    expect(layout.glyphs[1].x).toBeGreaterThan(layout.glyphs[0].x);
    expect(layout.glyphs[2].x).toBeGreaterThan(layout.glyphs[1].x);
  });

  it('selects the characters a range selector covers', () => {
    const animator = createTextAnimator();
    const [selector] = animator.selectors;
    selector.start.value = 0;
    selector.end.value = 50;
    // Half of ten characters: the first five are in, the rest are out.
    expect(selectorWeight(selector, 0, 0, 10)).toBeCloseTo(1, 6);
    expect(selectorWeight(selector, 0, 4, 10)).toBeCloseTo(1, 6);
    expect(selectorWeight(selector, 0, 5, 10)).toBe(0);
  });

  it('ramps the weight across the range for a ramp shape', () => {
    const animator = createTextAnimator();
    const [selector] = animator.selectors;
    selector.shape = 'ramp-up';
    const first = selectorWeight(selector, 0, 0, 10);
    const last = selectorWeight(selector, 0, 9, 10);
    expect(last).toBeGreaterThan(first);
  });

  it('subtracts a selector from the full range', () => {
    const animator = createTextAnimator();
    animator.selectors[0].mode = 'subtract';
    animator.selectors[0].start.value = 0;
    animator.selectors[0].end.value = 50;
    expect(animatorWeight(animator, 0, 0, 10)).toBe(0);
    expect(animatorWeight(animator, 0, 9, 10)).toBe(1);
  });

  it('applies an animator transform only to the selected characters', () => {
    const c = comp();
    const layer = createTextLayer(c, 'ABCDEFGHIJ');
    const animator = createTextAnimator();
    animator.selectors[0].end.value = 50;
    animator.properties.position.value = [0, -100] as Vec2;
    animator.properties.opacity.value = 0;
    layer.animators.push(animator);

    const inRange = glyphTransform(layer, 0, 0, 10);
    const outOfRange = glyphTransform(layer, 0, 9, 10);
    expect(inRange.position[1]).toBeCloseTo(-100, 6);
    expect(inRange.opacity).toBeCloseTo(0, 6);
    expect(outOfRange.position[1]).toBeCloseTo(0, 6);
    expect(outOfRange.opacity).toBeCloseTo(100, 6);
  });

  it('shifts later glyphs when an animator adds tracking', () => {
    const c = comp();
    const layer = createTextLayer(c, 'ABCD');
    const before = layoutTextLayer(layer, 0);

    const animator = createTextAnimator();
    animator.properties.enabled.tracking = true;
    animator.properties.tracking.value = 40;
    layer.animators.push(animator);

    const after = layoutTextLayer(layer, 0);
    expect(after.width).toBeGreaterThan(before.width);
  });

  it('puts text animators in the outline once they exist', () => {
    const c = comp();
    const layer = addLayer(c, createTextLayer(c, 'HI'));
    if (layer.type !== 'text') throw new Error('expected a text layer');
    layer.animators.push(createTextAnimator());
    const paths = layerOutline(layer)
      .filter((n) => n.kind === 'prop')
      .map((n) => (n.kind === 'prop' ? n.path : ''));
    expect(paths).toContain('animators.0.selectors.0.start');
    expect(paths).toContain('animators.0.properties.position');
    // Disabled properties stay out of the outline until they are switched on.
    expect(paths).not.toContain('animators.0.properties.rotation');
  });
});

describe('solid and shape layer defaults', () => {
  it('gives every layer an empty mask list and no track matte', () => {
    const c = comp();
    const layer = addLayer(c, createShapeLayer(c));
    expect(layer.masks).toEqual([]);
    expect(layer.trackMatte).toBe('none');
    expect(hexToRgba('#ffffff')).toEqual([1, 1, 1, 1]);
  });
});
