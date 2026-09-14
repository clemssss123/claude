import { useState } from 'react';
import { activeComposition } from '@/core/project';
import { hexToRgba, rgbToHex } from '@/core/property';
import { useEditor } from '@/state/store';

export function CompSettingsDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project);
  const comp = activeComposition(project);
  const [draft, setDraft] = useState(() => comp && ({
    name: comp.name,
    width: comp.width,
    height: comp.height,
    frameRate: comp.frameRate,
    duration: comp.duration,
    bg: rgbToHex(comp.bgColor[0], comp.bgColor[1], comp.bgColor[2]),
    shutterAngle: comp.motionBlur.shutterAngle,
    shutterPhase: comp.motionBlur.shutterPhase,
    samplesPerFrame: comp.motionBlur.samplesPerFrame,
  }));

  if (!comp || !draft) return null;

  const apply = () => {
    useEditor.getState().updateCompSettings({
      name: draft.name,
      width: Math.max(1, Math.round(draft.width)),
      height: Math.max(1, Math.round(draft.height)),
      frameRate: Math.max(1, draft.frameRate),
      duration: Math.max(1 / draft.frameRate, draft.duration),
      bgColor: hexToRgba(draft.bg, 1),
      motionBlur: {
        ...comp.motionBlur,
        shutterAngle: draft.shutterAngle,
        shutterPhase: draft.shutterPhase,
        samplesPerFrame: Math.max(2, Math.round(draft.samplesPerFrame)),
      },
    });
    onClose();
  };

  const field = (label: string, node: React.ReactNode) => (
    <div className="field"><label>{label}</label>{node}</div>
  );

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <header>Composition Settings</header>
        <div className="content">
          {field('Composition Name', (
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          ))}
          {field('Width', (
            <input type="number" value={draft.width} onChange={(e) => setDraft({ ...draft, width: Number(e.target.value) })} />
          ))}
          {field('Height', (
            <input type="number" value={draft.height} onChange={(e) => setDraft({ ...draft, height: Number(e.target.value) })} />
          ))}
          {field('Frame Rate', (
            <input type="number" step="0.001" value={draft.frameRate} onChange={(e) => setDraft({ ...draft, frameRate: Number(e.target.value) })} />
          ))}
          {field('Duration (s)', (
            <input type="number" step="0.1" value={draft.duration} onChange={(e) => setDraft({ ...draft, duration: Number(e.target.value) })} />
          ))}
          {field('Background', (
            <input type="color" value={draft.bg} onChange={(e) => setDraft({ ...draft, bg: e.target.value })} />
          ))}
          <div style={{ margin: '14px 0 8px', color: 'var(--text-dim)' }}>
            Motion blur — stored now, rendered in phase 5.
          </div>
          {field('Shutter Angle', (
            <input type="number" value={draft.shutterAngle} onChange={(e) => setDraft({ ...draft, shutterAngle: Number(e.target.value) })} />
          ))}
          {field('Shutter Phase', (
            <input type="number" value={draft.shutterPhase} onChange={(e) => setDraft({ ...draft, shutterPhase: Number(e.target.value) })} />
          ))}
          {field('Samples Per Frame', (
            <input type="number" value={draft.samplesPerFrame} onChange={(e) => setDraft({ ...draft, samplesPerFrame: Number(e.target.value) })} />
          ))}
        </div>
        <footer>
          <button onClick={onClose}>Cancel</button>
          <button className="active" onClick={apply}>OK</button>
        </footer>
      </div>
    </div>
  );
}
