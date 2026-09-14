import { useState } from 'react';
import { findLayer } from '@/core/composition';
import { getProperty } from '@/core/layer';
import { activeComposition } from '@/core/project';
import { useEditor } from '@/state/store';

/**
 * After Effects' Keyframe Velocity dialog (Ctrl+Shift+K): the numeric way in
 * to the same influence/speed handles the graph editor drags.
 */
export function KeyframeVelocityDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project);
  const refs = useEditor((s) => s.selectedKeyframes);
  const comp = activeComposition(project);

  const first = refs[0];
  const layer = comp && first ? findLayer(comp, first.layerId) : undefined;
  const property = layer && first ? getProperty(layer, first.path) : undefined;
  const keyframe = property?.keyframes.find((k) => k.id === first?.kfId);

  const [draft, setDraft] = useState(() => ({
    inSpeed: keyframe?.easeIn.speed ?? 0,
    inInfluence: keyframe?.easeIn.influence ?? 33.33,
    outSpeed: keyframe?.easeOut.speed ?? 0,
    outInfluence: keyframe?.easeOut.influence ?? 33.33,
    continuous: keyframe?.tangentMode === 'continuous',
  }));

  if (!keyframe) {
    return (
      <div className="modal-backdrop" onPointerDown={onClose}>
        <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
          <header>Keyframe Velocity</header>
          <div className="content">Select a keyframe first.</div>
          <footer><button className="active" onClick={onClose}>Close</button></footer>
        </div>
      </div>
    );
  }

  const apply = () => {
    const store = useEditor.getState();
    for (const ref of refs) {
      store.setKeyframeEase(ref, 'in', {
        speed: draft.inSpeed,
        influence: draft.inInfluence,
      });
      store.setKeyframeEase(ref, 'out', {
        speed: draft.continuous ? draft.inSpeed : draft.outSpeed,
        influence: draft.outInfluence,
      });
    }
    if (draft.continuous) store.setSelectedTangentMode('continuous');
    onClose();
  };

  const numberField = (
    label: string,
    key: 'inSpeed' | 'inInfluence' | 'outSpeed' | 'outInfluence',
    unit: string,
  ) => (
    <div className="field">
      <label>{label}</label>
      <span>
        <input
          type="number"
          step="0.1"
          value={draft[key]}
          onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
          style={{ width: 110 }}
        />
        <span style={{ color: 'var(--text-dim)', marginLeft: 6 }}>{unit}</span>
      </span>
    </div>
  );

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <header>Keyframe Velocity — {property?.name}</header>
        <div className="content">
          <div style={{ color: 'var(--text-dim)', marginBottom: 8 }}>
            Applies to {refs.length} selected keyframe{refs.length === 1 ? '' : 's'}.
          </div>
          <div style={{ color: 'var(--text-bright)', margin: '10px 0 6px' }}>Incoming</div>
          {numberField('Velocity', 'inSpeed', `${property?.unit ?? 'units'}/sec`)}
          {numberField('Influence', 'inInfluence', '%')}
          <div style={{ color: 'var(--text-bright)', margin: '14px 0 6px' }}>Outgoing</div>
          {numberField('Velocity', 'outSpeed', `${property?.unit ?? 'units'}/sec`)}
          {numberField('Influence', 'outInfluence', '%')}
          <label style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            <input
              type="checkbox"
              checked={draft.continuous}
              onChange={(e) => setDraft({ ...draft, continuous: e.target.checked })}
            />
            Continuous — keep the incoming and outgoing speeds equal
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
