import { useState } from 'react';
import { findLayer } from '@/core/composition';
import { activeComposition } from '@/core/project';
import { hexToRgba, rgbToHex } from '@/core/property';
import { useEditor } from '@/state/store';

/** After Effects' Solid Settings (Ctrl+Shift+Y): name, size and colour. */
export function SolidSettingsDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project);
  const selected = useEditor((s) => s.selectedLayerIds);
  const comp = activeComposition(project);
  const layer = comp && selected.length === 1 ? findLayer(comp, selected[0]) : undefined;
  const solid = layer?.type === 'solid' ? layer : undefined;

  const [draft, setDraft] = useState(() => ({
    name: solid?.name ?? '',
    width: solid?.width ?? 0,
    height: solid?.height ?? 0,
    colour: solid ? rgbToHex(solid.color[0], solid.color[1], solid.color[2]) : '#ffffff',
  }));

  if (!solid) {
    return (
      <div className="modal-backdrop" onPointerDown={onClose}>
        <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
          <header>Solid Settings</header>
          <div className="content">Select a single solid layer.</div>
          <footer><button className="active" onClick={onClose}>Close</button></footer>
        </div>
      </div>
    );
  }

  const apply = () => {
    useEditor.getState().mutateComp('Solid Settings', (c) => {
      const target = findLayer(c, solid.id);
      if (!target || target.type !== 'solid') return;
      target.name = draft.name.trim() || target.name;
      target.width = Math.max(1, Math.round(draft.width));
      target.height = Math.max(1, Math.round(draft.height));
      target.color = hexToRgba(draft.colour, target.color[3]);
    });
    onClose();
  };

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <header>Solid Settings — {solid.name}</header>
        <div className="content">
          <div className="field">
            <label>Name</label>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Width</label>
            <input
              type="number"
              value={draft.width}
              onChange={(e) => setDraft({ ...draft, width: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>Height</label>
            <input
              type="number"
              value={draft.height}
              onChange={(e) => setDraft({ ...draft, height: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>Color</label>
            <input
              type="color"
              value={draft.colour}
              onChange={(e) => setDraft({ ...draft, colour: e.target.value })}
            />
          </div>
          {comp && (
            <button
              onClick={() => setDraft({ ...draft, width: comp.width, height: comp.height })}
            >
              Make Comp Size
            </button>
          )}
        </div>
        <footer>
          <button onClick={onClose}>Cancel</button>
          <button className="active" onClick={apply}>OK</button>
        </footer>
      </div>
    </div>
  );
}
