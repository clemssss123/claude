import { useState } from 'react';
import { findLayer } from '@/core/composition';
import { getProperty } from '@/core/layer';
import { activeComposition } from '@/core/project';
import { useEditor } from '@/state/store';
import type { InterpolationType, SpatialType } from '@/core/types';

type TemporalChoice = 'linear' | 'bezier' | 'hold' | 'auto' | 'continuous';

const TEMPORAL_LABELS: Record<TemporalChoice, string> = {
  linear: 'Linear',
  bezier: 'Bezier',
  continuous: 'Continuous Bezier',
  auto: 'Auto Bezier',
  hold: 'Hold',
};

const SPATIAL_LABELS: Record<SpatialType, string> = {
  linear: 'Linear',
  bezier: 'Bezier',
  auto: 'Auto Bezier',
};

/** After Effects' Keyframe Interpolation dialog (Ctrl+Alt+K). */
export function KeyframeInterpolationDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project);
  const refs = useEditor((s) => s.selectedKeyframes);
  const comp = activeComposition(project);

  const first = refs[0];
  const layer = comp && first ? findLayer(comp, first.layerId) : undefined;
  const property = layer && first ? getProperty(layer, first.path) : undefined;
  const keyframe = property?.keyframes.find((k) => k.id === first?.kfId);

  const [temporalIn, setTemporalIn] = useState<TemporalChoice>(
    () => toChoice(keyframe?.inType, keyframe?.tangentMode),
  );
  const [temporalOut, setTemporalOut] = useState<TemporalChoice>(
    () => toChoice(keyframe?.outType, keyframe?.tangentMode),
  );
  const [spatial, setSpatial] = useState<SpatialType>(keyframe?.spatialType ?? 'auto');
  const [roving, setRoving] = useState(Boolean(keyframe?.roving));

  if (!keyframe) {
    return (
      <div className="modal-backdrop" onPointerDown={onClose}>
        <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
          <header>Keyframe Interpolation</header>
          <div className="content">Select a keyframe first.</div>
          <footer><button className="active" onClick={onClose}>Close</button></footer>
        </div>
      </div>
    );
  }

  const apply = () => {
    const store = useEditor.getState();
    store.setSelectedInterpolation(toType(temporalIn), 'in');
    store.setSelectedInterpolation(toType(temporalOut), 'out');

    if (temporalIn === 'auto' || temporalOut === 'auto') store.setSelectedTangentMode('auto');
    else if (temporalIn === 'continuous' || temporalOut === 'continuous') {
      store.setSelectedTangentMode('continuous');
    } else store.setSelectedTangentMode('independent');

    if (property?.spatial) store.setSelectedSpatialType(spatial);
    store.setSelectedRoving(roving);
    onClose();
  };

  const select = <T extends string>(
    label: string, value: T, options: Record<string, string>,
    onChange: (v: T) => void, disabled = false,
  ) => (
    <div className="field">
      <label>{label}</label>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {Object.entries(options).map(([key, text]) => (
          <option key={key} value={key}>{text}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <header>Keyframe Interpolation — {property?.name}</header>
        <div className="content">
          <div style={{ color: 'var(--text-dim)', marginBottom: 10 }}>
            Applies to {refs.length} selected keyframe{refs.length === 1 ? '' : 's'}.
          </div>
          {select('Temporal In', temporalIn, TEMPORAL_LABELS, setTemporalIn)}
          {select('Temporal Out', temporalOut, TEMPORAL_LABELS, setTemporalOut)}
          {select(
            'Spatial', spatial, SPATIAL_LABELS, setSpatial, !property?.spatial,
          )}
          {!property?.spatial && (
            <div style={{ color: 'var(--text-dim)', marginTop: -4, marginBottom: 10 }}>
              Spatial interpolation applies to positional properties.
            </div>
          )}
          <label style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <input
              type="checkbox"
              checked={roving}
              onChange={(e) => setRoving(e.target.checked)}
            />
            Rove Across Time
          </label>
        </div>
        <footer>
          <button onClick={onClose}>Cancel</button>
          <button className="active" onClick={apply}>OK</button>
        </footer>
      </div>
    </div>
  );
}

function toChoice(
  type: InterpolationType | undefined,
  tangentMode: string | undefined,
): TemporalChoice {
  if (type === 'hold') return 'hold';
  if (type === 'linear') return 'linear';
  if (tangentMode === 'auto') return 'auto';
  if (tangentMode === 'continuous') return 'continuous';
  return 'bezier';
}

function toType(choice: TemporalChoice): InterpolationType {
  if (choice === 'linear' || choice === 'hold') return choice;
  return 'bezier';
}
