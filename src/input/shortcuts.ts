import { findLayer } from '@/core/composition';
import { activeComposition, deserializeProject, serializeProject } from '@/core/project';
import { valueAtTime } from '@/core/property';
import { useEditor } from '@/state/store';
import type { EditorState } from '@/state/store';

/**
 * The After Effects keymap.
 *
 * Every binding below uses the same chord as After Effects. Commands whose
 * feature has not been built yet are listed with `status: 'planned'` and the
 * phase that will implement them — they still occupy their key so nothing else
 * can claim it, and the Keyboard Shortcuts panel shows them greyed out rather
 * than pretending they work.
 *
 * Chord syntax: lowercase, modifiers in the order `ctrl+alt+shift+key`.
 * `ctrl` matches Command on macOS. `num0` is the numeric keypad zero.
 */

export type ShortcutStatus = 'ready' | 'planned';

export interface Shortcut {
  id: string;
  label: string;
  /** One or more chords that run this command. */
  keys: string[];
  category: string;
  status: ShortcutStatus;
  /** Phase that implements a planned command. */
  phase?: number;
  run?: (state: EditorState) => void;
  /** Allow while a text field has focus (undo/redo only). */
  allowInInput?: boolean;
}

function comp(state: EditorState) {
  return activeComposition(state.project);
}

function firstSelectedLayer(state: EditorState) {
  const c = comp(state);
  const id = state.selectedLayerIds[0];
  return c && id ? findLayer(c, id) : undefined;
}

export const SHORTCUTS: Shortcut[] = [
  // -- Transport -----------------------------------------------------------
  {
    id: 'transport.playPause',
    label: 'Play / Pause preview',
    keys: ['space'],
    category: 'Transport',
    status: 'ready',
    run: (s) => s.togglePlay(),
  },
  {
    id: 'transport.ramPreview',
    label: 'RAM Preview',
    keys: ['num0'],
    category: 'Transport',
    status: 'ready',
    run: (s) => s.togglePlay(),
  },
  {
    id: 'transport.start',
    label: 'Go to start of composition',
    keys: ['home'],
    category: 'Transport',
    status: 'ready',
    run: (s) => s.goToStart(),
  },
  {
    id: 'transport.end',
    label: 'Go to end of composition',
    keys: ['end'],
    category: 'Transport',
    status: 'ready',
    run: (s) => s.goToEnd(),
  },
  {
    id: 'transport.forward1',
    label: 'Forward 1 frame',
    keys: ['pagedown', 'ctrl+arrowright'],
    category: 'Transport',
    status: 'ready',
    run: (s) => s.stepFrames(1),
  },
  {
    id: 'transport.back1',
    label: 'Back 1 frame',
    keys: ['pageup', 'ctrl+arrowleft'],
    category: 'Transport',
    status: 'ready',
    run: (s) => s.stepFrames(-1),
  },
  {
    id: 'transport.forward10',
    label: 'Forward 10 frames',
    keys: ['shift+pagedown', 'ctrl+shift+arrowright'],
    category: 'Transport',
    status: 'ready',
    run: (s) => s.stepFrames(10),
  },
  {
    id: 'transport.back10',
    label: 'Back 10 frames',
    keys: ['shift+pageup', 'ctrl+shift+arrowleft'],
    category: 'Transport',
    status: 'ready',
    run: (s) => s.stepFrames(-10),
  },
  {
    id: 'transport.nextKeyframe',
    label: 'Go to next visible keyframe',
    keys: ['k'],
    category: 'Transport',
    status: 'ready',
    run: (s) => s.goToNextKeyframe(),
  },
  {
    id: 'transport.prevKeyframe',
    label: 'Go to previous visible keyframe',
    keys: ['j'],
    category: 'Transport',
    status: 'ready',
    run: (s) => s.goToPrevKeyframe(),
  },
  {
    id: 'transport.layerIn',
    label: 'Go to layer In point',
    keys: ['i'],
    category: 'Transport',
    status: 'ready',
    run: (s) => {
      const layer = firstSelectedLayer(s);
      if (layer) s.setTime(layer.inPoint);
    },
  },
  {
    id: 'transport.layerOut',
    label: 'Go to layer Out point',
    keys: ['o'],
    category: 'Transport',
    status: 'ready',
    run: (s) => {
      const layer = firstSelectedLayer(s);
      if (layer) s.setTime(layer.outPoint);
    },
  },

  // -- Layer timing --------------------------------------------------------
  {
    id: 'layer.moveInToCTI',
    label: 'Move layer so In point is at current time',
    keys: ['['],
    category: 'Layer timing',
    status: 'ready',
    run: (s) => {
      const c = comp(s);
      if (!c) return;
      s.mutateComp('Move Layer In Point', (draft) => {
        for (const id of s.selectedLayerIds) {
          const layer = findLayer(draft, id);
          if (!layer) continue;
          const shift = s.time - layer.inPoint;
          layer.inPoint += shift;
          layer.outPoint += shift;
          layer.startTime += shift;
        }
      });
    },
  },
  {
    id: 'layer.moveOutToCTI',
    label: 'Move layer so Out point is at current time',
    keys: [']'],
    category: 'Layer timing',
    status: 'ready',
    run: (s) => {
      s.mutateComp('Move Layer Out Point', (draft) => {
        for (const id of s.selectedLayerIds) {
          const layer = findLayer(draft, id);
          if (!layer) continue;
          const shift = s.time - layer.outPoint;
          layer.inPoint += shift;
          layer.outPoint += shift;
          layer.startTime += shift;
        }
      });
    },
  },
  {
    id: 'layer.trimIn',
    label: 'Trim layer In point to current time',
    keys: ['alt+['],
    category: 'Layer timing',
    status: 'ready',
    run: (s) => {
      for (const id of s.selectedLayerIds) s.setLayerInPoint(id, s.time);
    },
  },
  {
    id: 'layer.trimOut',
    label: 'Trim layer Out point to current time',
    keys: ['alt+]'],
    category: 'Layer timing',
    status: 'ready',
    run: (s) => {
      for (const id of s.selectedLayerIds) s.setLayerOutPoint(id, s.time);
    },
  },
  {
    id: 'comp.workAreaStart',
    label: 'Set work area start',
    keys: ['b'],
    category: 'Layer timing',
    status: 'ready',
    run: (s) => s.setWorkAreaStart(s.time),
  },
  {
    id: 'comp.workAreaEnd',
    label: 'Set work area end',
    keys: ['n'],
    category: 'Layer timing',
    status: 'ready',
    run: (s) => s.setWorkAreaEnd(s.time),
  },
  {
    id: 'comp.workAreaReset',
    label: 'Set work area to selected layers (or whole comp)',
    keys: ['ctrl+alt+b'],
    category: 'Layer timing',
    status: 'ready',
    run: (s) => {
      const c = comp(s);
      if (!c) return;
      const layers = s.selectedLayerIds
        .map((id) => findLayer(c, id))
        .filter(Boolean) as { inPoint: number; outPoint: number }[];
      const start = layers.length ? Math.min(...layers.map((l) => l.inPoint)) : 0;
      const end = layers.length ? Math.max(...layers.map((l) => l.outPoint)) : c.duration;
      s.mutateComp('Set Work Area', (draft) => {
        draft.workAreaStart = start;
        draft.workAreaEnd = end;
      });
    },
  },
  {
    id: 'comp.trimToWorkArea',
    label: 'Trim composition to work area',
    keys: ['ctrl+shift+x'],
    category: 'Layer timing',
    status: 'ready',
    run: (s) => s.trimCompToWorkArea(),
  },

  // -- Property reveal -----------------------------------------------------
  ...revealShortcuts(),
  {
    id: 'reveal.animated',
    label: 'Reveal animated properties',
    keys: ['u'],
    category: 'Reveal',
    status: 'ready',
    run: (s) => s.revealAnimated(),
  },
  {
    id: 'reveal.modified',
    label: 'Reveal all modified properties',
    keys: ['uu'],
    category: 'Reveal',
    status: 'ready',
    run: (s) => s.revealModified(),
  },
  {
    id: 'reveal.effects',
    label: 'Reveal effects',
    keys: ['e'],
    category: 'Reveal',
    status: 'ready',
    run: (s) => s.revealProperties('e', false),
  },
  {
    id: 'reveal.expressions',
    label: 'Reveal expressions',
    keys: ['ee'],
    category: 'Reveal',
    status: 'ready',
    run: (s) => s.revealExpressions(),
  },
  {
    id: 'reveal.maskPath',
    label: 'Reveal mask path',
    keys: ['m'],
    category: 'Reveal',
    status: 'ready',
    run: (s) => s.revealProperties('m', false),
  },
  {
    id: 'reveal.maskAll',
    label: 'Reveal all mask properties',
    keys: ['mm'],
    category: 'Reveal',
    status: 'ready',
    run: (s) => s.revealProperties('mm', false),
  },
  {
    id: 'reveal.maskFeather',
    label: 'Reveal mask feather',
    keys: ['f'],
    category: 'Reveal',
    status: 'ready',
    run: (s) => s.revealProperties('f', false),
  },
  {
    id: 'reveal.maskOpacity',
    label: 'Reveal mask opacity',
    keys: ['tt'],
    category: 'Reveal',
    status: 'ready',
    run: (s) => s.revealProperties('tt', false),
  },
  {
    id: 'reveal.audioLevels',
    label: 'Reveal audio levels',
    keys: ['l'],
    category: 'Reveal',
    status: 'planned',
    phase: 6,
  },

  // -- Keyframes -----------------------------------------------------------
  {
    id: 'keyframe.easyEase',
    label: 'Easy Ease',
    keys: ['f9'],
    category: 'Keyframes',
    status: 'ready',
    run: (s) => s.applyEasyEaseToSelection('both'),
  },
  {
    id: 'keyframe.easyEaseIn',
    label: 'Easy Ease In',
    keys: ['shift+f9'],
    category: 'Keyframes',
    status: 'ready',
    run: (s) => s.applyEasyEaseToSelection('in'),
  },
  {
    id: 'keyframe.easyEaseOut',
    label: 'Easy Ease Out',
    keys: ['ctrl+shift+f9'],
    category: 'Keyframes',
    status: 'ready',
    run: (s) => s.applyEasyEaseToSelection('out'),
  },
  {
    id: 'keyframe.toggleHold',
    label: 'Toggle hold keyframe',
    keys: ['ctrl+alt+h'],
    category: 'Keyframes',
    status: 'ready',
    run: (s) => s.setSelectedInterpolation('hold'),
  },
  {
    id: 'keyframe.linear',
    label: 'Set linear interpolation',
    keys: ['ctrl+alt+l'],
    category: 'Keyframes',
    status: 'ready',
    run: (s) => s.setSelectedInterpolation('linear'),
  },
  {
    id: 'keyframe.delete',
    label: 'Delete selected keyframes / layers',
    keys: ['delete', 'backspace'],
    category: 'Keyframes',
    status: 'ready',
    run: (s) => {
      if (s.selectedKeyframes.length > 0) s.deleteSelectedKeyframes();
      else s.deleteSelected();
    },
  },
  {
    id: 'keyframe.interpolationDialog',
    label: 'Keyframe Interpolation dialog',
    keys: ['ctrl+alt+k'],
    category: 'Keyframes',
    status: 'ready',
    run: (s) => s.openDialog('interpolation'),
  },
  {
    id: 'keyframe.velocityDialog',
    label: 'Keyframe Velocity dialog',
    keys: ['ctrl+shift+k'],
    category: 'Keyframes',
    status: 'ready',
    run: (s) => s.openDialog('velocity'),
  },
  {
    id: 'keyframe.graphEditor',
    label: 'Toggle Graph Editor',
    keys: ['shift+f3'],
    category: 'Keyframes',
    status: 'ready',
    run: (s) => s.toggleGraphEditor(),
  },
  {
    id: 'keyframe.copy',
    label: 'Copy keyframes',
    keys: ['ctrl+c'],
    category: 'Keyframes',
    status: 'ready',
    run: (s) => s.copyKeyframes(),
  },
  {
    id: 'keyframe.paste',
    label: 'Paste keyframes at current time',
    keys: ['ctrl+v'],
    category: 'Keyframes',
    status: 'ready',
    run: (s) => s.pasteKeyframes(),
  },
  {
    id: 'keyframe.roving',
    label: 'Rove selected keyframes across time',
    keys: ['ctrl+alt+r'],
    category: 'Keyframes',
    status: 'ready',
    run: (s) => s.setSelectedRoving(true),
  },
  {
    id: 'keyframe.autoBezier',
    label: 'Auto Bezier on selected keyframes',
    keys: ['ctrl+alt+t'],
    category: 'Keyframes',
    status: 'ready',
    run: (s) => s.setSelectedTangentMode('auto'),
  },
  {
    id: 'property.separateDimensions',
    label: 'Separate / merge Position dimensions',
    keys: ['ctrl+alt+shift+d'],
    category: 'Keyframes',
    status: 'ready',
    run: (s) => {
      for (const id of s.selectedLayerIds) s.toggleSeparateDimensions(id, 'transform.position');
    },
  },

  // -- Layers --------------------------------------------------------------
  {
    id: 'layer.newSolid',
    label: 'New Solid',
    keys: ['ctrl+y'],
    category: 'Layer',
    status: 'ready',
    run: (s) => s.addSolid(),
  },
  {
    id: 'layer.newAdjustment',
    label: 'New Adjustment Layer',
    keys: ['ctrl+alt+y'],
    category: 'Layer',
    status: 'ready',
    run: (s) => s.addAdjustment(),
  },
  {
    id: 'layer.newNull',
    label: 'New Null Object',
    keys: ['ctrl+alt+shift+y'],
    category: 'Layer',
    status: 'ready',
    run: (s) => s.addNull(),
  },
  {
    id: 'layer.newText',
    label: 'New Text Layer',
    keys: ['ctrl+alt+shift+t'],
    category: 'Layer',
    status: 'ready',
    run: (s) => s.addText('Text'),
  },
  {
    id: 'layer.duplicate',
    label: 'Duplicate',
    keys: ['ctrl+d'],
    category: 'Layer',
    status: 'ready',
    run: (s) => s.duplicateSelected(),
  },
  {
    id: 'layer.selectAll',
    label: 'Select all layers',
    keys: ['ctrl+a'],
    category: 'Layer',
    status: 'ready',
    run: (s) => s.selectAllLayers(),
  },
  {
    id: 'layer.deselectAll',
    label: 'Deselect all',
    keys: ['ctrl+shift+a'],
    category: 'Layer',
    status: 'ready',
    run: (s) => s.deselectAll(),
  },
  {
    id: 'layer.centerAnchor',
    label: 'Center anchor point in layer content',
    keys: ['ctrl+alt+home'],
    category: 'Layer',
    status: 'ready',
    run: (s) => s.centerAnchorInContent(),
  },
  {
    id: 'layer.centerInComp',
    label: 'Center layer in composition',
    keys: ['ctrl+home'],
    category: 'Layer',
    status: 'ready',
    run: (s) => {
      const c = comp(s);
      if (!c) return;
      for (const id of s.selectedLayerIds) {
        s.setPropertyValue(id, 'transform.position', [c.width / 2, c.height / 2]);
      }
    },
  },
  {
    id: 'layer.fitToComp',
    label: 'Scale layer to fit composition',
    keys: ['ctrl+alt+f'],
    category: 'Layer',
    status: 'ready',
    run: (s) => {
      const c = comp(s);
      if (!c) return;
      for (const id of s.selectedLayerIds) {
        const layer = findLayer(c, id);
        if (!layer) continue;
        s.setPropertyValue(id, 'transform.scale', [
          (c.width / layer.width) * 100,
          (c.height / layer.height) * 100,
        ]);
      }
    },
  },
  {
    id: 'layer.fitWidth',
    label: 'Scale layer to fit composition width',
    keys: ['ctrl+alt+shift+h'],
    category: 'Layer',
    status: 'ready',
    run: (s) => fitAxis(s, 'width'),
  },
  {
    id: 'layer.fitHeight',
    label: 'Scale layer to fit composition height',
    keys: ['ctrl+alt+shift+g'],
    category: 'Layer',
    status: 'ready',
    run: (s) => fitAxis(s, 'height'),
  },
  {
    id: 'layer.split',
    label: 'Split layer at current time',
    keys: ['ctrl+shift+d'],
    category: 'Layer',
    status: 'ready',
    run: (s) => s.splitLayer(),
  },
  {
    id: 'layer.newShape',
    label: 'New Shape Layer',
    keys: ['ctrl+alt+shift+s'],
    category: 'Layer',
    status: 'ready',
    run: (s) => s.addShapeLayer('rect'),
  },
  {
    id: 'mask.newRect',
    label: 'New rectangular mask on the selected layers',
    keys: ['ctrl+shift+n'],
    category: 'Mask',
    status: 'ready',
    run: (s) => {
      for (const id of s.selectedLayerIds) s.addMask(id, 'rect');
    },
  },
  {
    id: 'effects.browser',
    label: 'Effects & Presets',
    keys: ['ctrl+5'],
    category: 'Effect',
    status: 'ready',
    run: (s) => s.openDialog('effects'),
  },
  {
    id: 'effects.removeAll',
    label: 'Remove all effects from the selected layers',
    keys: ['ctrl+shift+e'],
    category: 'Effect',
    status: 'ready',
    run: (s) => s.removeAllEffects(),
  },
  {
    id: 'text.addAnimator',
    label: 'Add a text animator to the selected text layer',
    keys: ['ctrl+alt+shift+a'],
    category: 'Text',
    status: 'ready',
    run: (s) => {
      for (const id of s.selectedLayerIds) s.addTextAnimator(id);
    },
  },
  {
    id: 'layer.precompose',
    label: 'Pre-compose',
    keys: ['ctrl+shift+c'],
    category: 'Layer',
    status: 'ready',
    run: (s) => s.precompose(),
  },
  {
    id: 'layer.timeRemap',
    label: 'Enable / disable Time Remapping',
    keys: ['ctrl+alt+t'],
    category: 'Layer',
    status: 'ready',
    run: (s) => {
      for (const id of s.selectedLayerIds) s.toggleTimeRemap(id);
    },
  },
  {
    id: 'layer.solidSettings',
    label: 'Solid Settings',
    keys: ['ctrl+shift+y'],
    category: 'Layer',
    status: 'planned',
    phase: 3,
  },

  // -- Composition & project ----------------------------------------------
  {
    id: 'comp.new',
    label: 'New Composition',
    keys: ['ctrl+n'],
    category: 'Composition',
    status: 'ready',
    run: (s) => s.newComposition(),
  },
  {
    id: 'comp.settings',
    label: 'Composition Settings',
    keys: ['ctrl+k'],
    category: 'Composition',
    status: 'ready',
    run: (s) => s.openDialog('compSettings'),
  },
  {
    id: 'edit.undo',
    label: 'Undo',
    keys: ['ctrl+z'],
    category: 'Edit',
    status: 'ready',
    allowInInput: true,
    run: (s) => s.undo(),
  },
  {
    id: 'edit.redo',
    label: 'Redo',
    keys: ['ctrl+shift+z'],
    category: 'Edit',
    status: 'ready',
    allowInInput: true,
    run: (s) => s.redo(),
  },
  {
    id: 'project.save',
    label: 'Save project',
    keys: ['ctrl+s'],
    category: 'Edit',
    status: 'ready',
    run: (s) => saveProjectFile(s),
  },
  {
    id: 'project.open',
    label: 'Open project',
    keys: ['ctrl+o'],
    category: 'Edit',
    status: 'ready',
    run: () => openProjectFile(),
  },

  // -- View ----------------------------------------------------------------
  {
    id: 'view.zoomIn',
    label: 'Zoom in (Composition panel)',
    keys: ['.'],
    category: 'View',
    status: 'ready',
    run: (s) => s.setViewer({
      zoom: Math.min(16, s.viewer.zoom * 1.25),
      fitOnResize: false,
    }),
  },
  {
    id: 'view.zoomOut',
    label: 'Zoom out (Composition panel)',
    keys: [','],
    category: 'View',
    status: 'ready',
    run: (s) => s.setViewer({
      zoom: Math.max(0.02, s.viewer.zoom / 1.25),
      fitOnResize: false,
    }),
  },
  {
    id: 'view.fit',
    label: 'Fit composition to window',
    keys: ['shift+/'],
    category: 'View',
    status: 'ready',
    run: (s) => s.setViewer({ fitOnResize: true, panX: 0, panY: 0 }),
  },
  {
    id: 'view.toggleTransparency',
    label: 'Toggle transparency grid',
    keys: ['ctrl+shift+alt+t'],
    category: 'View',
    status: 'ready',
    run: (s) => s.setViewer({ showTransparencyGrid: !s.viewer.showTransparencyGrid }),
  },
  {
    id: 'view.shortcutsPanel',
    label: 'Keyboard Shortcuts',
    keys: ['f1'],
    category: 'View',
    status: 'ready',
    run: (s) => s.openDialog('shortcuts'),
  },

  // -- Tools ---------------------------------------------------------------
  { id: 'tool.selection', label: 'Selection tool', keys: ['v'], category: 'Tools', status: 'ready', run: (s) => s.setTool('selection') },
  { id: 'tool.hand', label: 'Hand tool', keys: ['h'], category: 'Tools', status: 'ready', run: (s) => s.setTool('hand') },
  { id: 'tool.zoom', label: 'Zoom tool', keys: ['z'], category: 'Tools', status: 'ready', run: (s) => s.setTool('zoom') },
  { id: 'tool.rotation', label: 'Rotation tool', keys: ['w'], category: 'Tools', status: 'ready', run: (s) => s.setTool('rotation') },
  { id: 'tool.anchor', label: 'Pan Behind (anchor point) tool', keys: ['y'], category: 'Tools', status: 'ready', run: (s) => s.setTool('anchor') },
  { id: 'tool.pen', label: 'Pen tool', keys: ['g'], category: 'Tools', status: 'ready', run: (s) => s.setTool('pen') },
  { id: 'tool.text', label: 'Type tool', keys: ['ctrl+t'], category: 'Tools', status: 'ready', run: (s) => s.setTool('text') },
  {
    id: 'tool.shape',
    label: 'Shape tool (press again to cycle rectangle / ellipse)',
    keys: ['q'],
    category: 'Tools',
    status: 'ready',
    run: (s) => s.setTool(s.tool === 'rect' ? 'ellipse' : 'rect'),
  },
];

/** P / A / S / R / T reveal, their Shift+ additive forms and Alt+Shift+ keyframe forms. */
function revealShortcuts(): Shortcut[] {
  const props: [string, string, string][] = [
    ['a', 'Anchor Point', 'transform.anchorPoint'],
    ['p', 'Position', 'transform.position'],
    ['s', 'Scale', 'transform.scale'],
    ['r', 'Rotation', 'transform.rotation'],
    ['t', 'Opacity', 'transform.opacity'],
  ];
  const out: Shortcut[] = [];
  for (const [key, name, path] of props) {
    out.push({
      id: `reveal.${key}`,
      label: `Reveal ${name}`,
      keys: [key],
      category: 'Reveal',
      status: 'ready',
      run: (s) => s.revealProperties(key, false),
    });
    out.push({
      id: `reveal.add.${key}`,
      label: `Add ${name} to revealed properties`,
      keys: [`shift+${key}`],
      category: 'Reveal',
      status: 'ready',
      run: (s) => s.revealProperties(key, true),
    });
    out.push({
      id: `keyframe.add.${key}`,
      label: `Add ${name} keyframe at current time`,
      keys: [`alt+shift+${key}`],
      category: 'Keyframes',
      status: 'ready',
      run: (s) => {
        for (const id of s.selectedLayerIds) s.toggleKeyframeAt(id, path);
        s.revealProperties(key, true);
      },
    });
  }
  return out;
}

function fitAxis(s: EditorState, axis: 'width' | 'height'): void {
  const c = activeComposition(s.project);
  if (!c) return;
  for (const id of s.selectedLayerIds) {
    const layer = findLayer(c, id);
    if (!layer) continue;
    const factor = axis === 'width'
      ? (c.width / layer.width) * 100
      : (c.height / layer.height) * 100;
    const current = valueAtTime(layer.transform.scale, s.time);
    s.setPropertyValue(
      id,
      'transform.scale',
      axis === 'width' ? [factor, current[1]] : [current[0], factor],
    );
  }
}

/** Chord -> shortcut, built once. Later chords win for duplicate keys. */
export const SHORTCUT_BY_CHORD = new Map<string, Shortcut>();
for (const shortcut of SHORTCUTS) {
  for (const chord of shortcut.keys) SHORTCUT_BY_CHORD.set(chord, shortcut);
}

/** Normalize a keyboard event into a chord string. */
export function chordFromEvent(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('ctrl');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');

  let key = event.key.toLowerCase();
  if (event.code.startsWith('Numpad') && /^\d$/.test(event.code.slice(6))) {
    key = `num${event.code.slice(6)}`;
  } else if (key === ' ') {
    key = 'space';
  } else if (key === 'escape') {
    key = 'esc';
  }
  parts.push(key);
  return parts.join('+');
}

export function runShortcut(shortcut: Shortcut): boolean {
  if (!shortcut.run) return false;
  shortcut.run(useEditor.getState());
  return true;
}

/** Download the project as JSON. A File System Access save arrives in phase 7. */
export function saveProjectFile(state: EditorState): void {
  const blob = new Blob([serializeProject(state.project)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${state.project.name.replace(/\s+/g, '-').toLowerCase()}.kfs.json`;
  link.click();
  URL.revokeObjectURL(url);
  state.setStatus('Project saved.');
}

export function openProjectFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const state = useEditor.getState();
    try {
      state.loadProject(deserializeProject(await file.text()));
      state.setStatus(`Opened ${file.name}.`);
    } catch (error) {
      state.setStatus(error instanceof Error ? error.message : 'Could not open that file.');
    }
  };
  input.click();
}

export function formatChord(chord: string): string {
  return chord
    .split('+')
    .map((part) => {
      if (part.length === 1) return part.toUpperCase();
      if (part.startsWith('num')) return `Numpad ${part.slice(3)}`;
      if (part.startsWith('arrow')) return part.slice(5).replace(/^./, (c) => c.toUpperCase());
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('+');
}
