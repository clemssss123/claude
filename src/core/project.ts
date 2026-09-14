import { addLayer, createComposition } from './composition';
import { createSolidLayer, createTextLayer } from './layer';
import { addKeyframe, hexToRgba, setAnimated } from './property';
import { applyEasyEase } from './interpolation';
import { PROJECT_SCHEMA_VERSION } from './types';
import type { Composition, Id, Project } from './types';

export function createProject(name = 'Untitled Project'): Project {
  const comp = createComposition({ name: 'Comp 1', width: 1920, height: 1080, duration: 10 });
  return {
    name,
    version: PROJECT_SCHEMA_VERSION,
    compositions: [comp],
    activeCompId: comp.id,
  };
}

export function activeComposition(project: Project): Composition | undefined {
  return project.compositions.find((c) => c.id === project.activeCompId);
}

export function findComposition(project: Project, id: Id): Composition | undefined {
  return project.compositions.find((c) => c.id === id);
}

/**
 * A small scene so the app opens with something moving instead of a black
 * frame: a background, a card that flies in with eased keyframes, and a title.
 */
export function createStarterProject(): Project {
  const project = createProject('Keyframe Studio Demo');
  const comp = project.compositions[0];

  const bg = createSolidLayer(comp, 'Background', hexToRgba('#12141a'));
  const card = createSolidLayer(comp, 'Card', hexToRgba('#3d7dff'));
  card.width = 720;
  card.height = 405;
  card.transform.anchorPoint.value = [360, 202.5];
  card.transform.position.value = [960, 540];

  const title = createTextLayer(comp, 'KEYFRAME');
  title.transform.position.value = [960, 560];

  addLayer(comp, bg);
  addLayer(comp, card);
  addLayer(comp, title);

  // Card: slide up and settle.
  setAnimated(card.transform.position, 0, true);
  const p0 = addKeyframe(card.transform.position, 0, [960, 1500]);
  const p1 = addKeyframe(card.transform.position, 1.2, [960, 540]);
  applyEasyEase(p0, 'out');
  applyEasyEase(p1, 'in');

  setAnimated(card.transform.rotation, 0, true);
  addKeyframe(card.transform.rotation, 0, -8);
  const r1 = addKeyframe(card.transform.rotation, 1.6, 0);
  applyEasyEase(r1, 'in');

  // Title: fade and scale in slightly behind the card. The stopwatch is
  // enabled at the first keyframe time so no keyframe is captured at zero.
  setAnimated(title.transform.opacity, 0.6, true);
  addKeyframe(title.transform.opacity, 0.6, 0);
  addKeyframe(title.transform.opacity, 1.4, 100);

  setAnimated(title.transform.scale, 0.6, true);
  const s0 = addKeyframe(title.transform.scale, 0.6, [80, 80]);
  const s1 = addKeyframe(title.transform.scale, 1.6, [100, 100]);
  applyEasyEase(s0, 'out');
  applyEasyEase(s1, 'in');

  return project;
}

/** Serialize for save. The document is already plain data. */
export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export function deserializeProject(json: string): Project {
  const parsed = JSON.parse(json) as Project;
  if (typeof parsed !== 'object' || !Array.isArray(parsed.compositions)) {
    throw new Error('Not a Keyframe Studio project file.');
  }
  if (parsed.version > PROJECT_SCHEMA_VERSION) {
    throw new Error(
      `Project was saved by a newer version (schema ${parsed.version}).`,
    );
  }
  return parsed;
}
