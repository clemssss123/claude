import { describe, expect, it } from 'vitest';
import { addLayer, createComposition } from '../composition';
import { createMediaLayer, enableTimeRemap, sourceTimeAt } from '../layer';
import { createProject, deserializeProject, serializeProject } from '../project';
import type { FootageAsset } from '../types';

function asset(overrides: Partial<FootageAsset> = {}): FootageAsset {
  return {
    id: 'asset_1',
    name: 'clip.webm',
    kind: 'video',
    width: 640,
    height: 360,
    duration: 4,
    frameRate: 30,
    size: 12_345,
    mimeType: 'video/webm',
    ...overrides,
  };
}

describe('footage assets', () => {
  it('starts a project with an empty footage list', () => {
    expect(createProject().footage).toEqual([]);
  });

  it('gives projects saved before footage existed an empty list', () => {
    const project = createProject();
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>;
    delete raw.footage;
    expect(deserializeProject(JSON.stringify(raw)).footage).toEqual([]);
  });

  it('round-trips footage through a saved project file', () => {
    const project = createProject();
    project.footage.push(asset());
    const reopened = deserializeProject(serializeProject(project));
    expect(reopened.footage).toHaveLength(1);
    expect(reopened.footage[0].name).toBe('clip.webm');
    expect(reopened.footage[0].duration).toBe(4);
  });
});

describe('media layers', () => {
  it('takes its size and name from the asset', () => {
    const comp = createComposition({ name: 'Comp', duration: 10, frameRate: 30 });
    const layer = addLayer(comp, createMediaLayer(comp, asset()));
    expect(layer.type).toBe('media');
    expect(layer.width).toBe(640);
    expect(layer.height).toBe(360);
    expect(layer.name).toBe('clip.webm');
    if (layer.type === 'media') expect(layer.assetId).toBe('asset_1');
  });

  it('ends a video layer where the clip ends', () => {
    const comp = createComposition({ name: 'Comp', duration: 10, frameRate: 30 });
    const layer = createMediaLayer(comp, asset({ duration: 4 }));
    expect(layer.outPoint).toBeCloseTo(4);
  });

  it('runs a still for the whole composition', () => {
    const comp = createComposition({ name: 'Comp', duration: 10, frameRate: 30 });
    const layer = createMediaLayer(comp, asset({ kind: 'image', duration: 0 }));
    expect(layer.outPoint).toBeCloseTo(comp.duration);
  });

  it('offsets source time by the layer start, and follows Time Remapping', () => {
    const comp = createComposition({ name: 'Comp', duration: 10, frameRate: 30 });
    const layer = addLayer(comp, createMediaLayer(comp, asset()));
    layer.startTime = 1;
    expect(sourceTimeAt(layer, 2.5)).toBeCloseTo(1.5);

    enableTimeRemap(layer, 4);
    // The default remap maps the layer's own span onto the source's, so it
    // still reads as a plain offset until a keyframe is moved.
    expect(sourceTimeAt(layer, layer.inPoint)).toBeCloseTo(0);
    expect(sourceTimeAt(layer, layer.outPoint)).toBeCloseTo(3);
  });
});
