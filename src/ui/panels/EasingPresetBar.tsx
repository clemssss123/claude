import { useMemo, useState } from 'react';
import { BUILTIN_PRESETS } from '@/core/easings';
import type { EasingPreset } from '@/core/easings';
import { useEditor } from '@/state/store';
import { CurveThumb } from '@/ui/components/CurveThumb';
import { CurveEditor } from './CurveEditor';

/**
 * The easing library, in the spirit of the Flow extension: a strip of curves
 * you click to ease the selected keyframes, plus your own saved presets.
 */
export function EasingPresetBar() {
  const customPresets = useEditor((s) => s.customPresets);
  const selectedKeyframes = useEditor((s) => s.selectedKeyframes);
  const [showEditor, setShowEditor] = useState(false);
  const [filter, setFilter] = useState<string>('All');

  const groups = useMemo(() => {
    const all = [...BUILTIN_PRESETS, ...customPresets];
    const map = new Map<string, EasingPreset[]>();
    for (const preset of all) {
      const list = map.get(preset.group) ?? [];
      list.push(preset);
      map.set(preset.group, list);
    }
    return map;
  }, [customPresets]);

  const visible = filter === 'All'
    ? [...groups.entries()]
    : [...groups.entries()].filter(([group]) => group === filter);

  const apply = (preset: EasingPreset) => useEditor.getState().applyEasingPreset(preset);

  return (
    <div className="preset-bar">
      <div className="preset-bar-head">
        <strong>Easing</strong>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option>All</option>
          {[...groups.keys()].map((group) => <option key={group}>{group}</option>)}
        </select>
        <span className="preset-hint">
          {selectedKeyframes.length === 0
            ? 'select two adjacent keyframes'
            : `${selectedKeyframes.length} keyframe${selectedKeyframes.length === 1 ? '' : 's'} selected`}
        </span>
        <span style={{ flex: 1 }} />
        <button
          className={showEditor ? 'icon active' : 'icon'}
          onClick={() => setShowEditor((v) => !v)}
          title="Custom curve editor"
        >
          Curve…
        </button>
      </div>

      <div className="preset-scroll">
        {visible.map(([group, presets]) => (
          <div className="preset-group" key={group}>
            <div className="preset-group-name">{group}</div>
            <div className="preset-row">
              {presets.map((preset) => (
                <div className="preset-chip" key={preset.id}>
                  <button
                    className="preset-button"
                    title={`${preset.name}${preset.kind === 'baked' ? ' (baked into keyframes)' : ''}`}
                    onClick={() => apply(preset)}
                  >
                    <CurveThumb preset={preset} />
                  </button>
                  <span className="preset-name">{preset.name.replace(`${group} `, '')}</span>
                  {!preset.builtin && (
                    <div className="preset-tools">
                      <button
                        className="icon"
                        title="Move left"
                        onClick={() => useEditor.getState().moveCustomPreset(preset.id, -1)}
                      >
                        ‹
                      </button>
                      <button
                        className="icon"
                        title="Rename"
                        onClick={() => {
                          const next = window.prompt('Preset name', preset.name);
                          if (next) useEditor.getState().renameCustomPreset(preset.id, next);
                        }}
                      >
                        ✎
                      </button>
                      <button
                        className="icon"
                        title="Delete"
                        onClick={() => useEditor.getState().removeCustomPreset(preset.id)}
                      >
                        ✕
                      </button>
                      <button
                        className="icon"
                        title="Move right"
                        onClick={() => useEditor.getState().moveCustomPreset(preset.id, 1)}
                      >
                        ›
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {showEditor && <CurveEditor onClose={() => setShowEditor(false)} />}
    </div>
  );
}
