import { useEditor } from '@/state/store';
import type { Tool } from '@/state/store';

const TOOLS: { id: Tool; glyph: string; label: string; chord: string; ready: boolean }[] = [
  { id: 'selection', glyph: '➚', label: 'Selection', chord: 'V', ready: true },
  { id: 'hand', glyph: '✋', label: 'Hand', chord: 'H', ready: true },
  { id: 'zoom', glyph: '🔍', label: 'Zoom', chord: 'Z', ready: true },
  { id: 'rotation', glyph: '↻', label: 'Rotation', chord: 'W', ready: true },
  { id: 'anchor', glyph: '⌖', label: 'Pan Behind (Anchor Point)', chord: 'Y', ready: true },
  { id: 'pen', glyph: '✒', label: 'Pen — phase 3', chord: 'G', ready: false },
  { id: 'text', glyph: 'T', label: 'Type — phase 3', chord: 'Ctrl+T', ready: false },
  { id: 'shape', glyph: '▭', label: 'Shape — phase 3', chord: 'Q', ready: false },
];

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const store = useEditor.getState();

  return (
    <div className="toolbar">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`icon ${tool === t.id ? 'active' : ''}`}
          title={`${t.label} (${t.chord})`}
          disabled={!t.ready}
          style={!t.ready ? { opacity: 0.35 } : undefined}
          onClick={() => store.setTool(t.id)}
        >
          {t.glyph}
        </button>
      ))}
      <div className="sep" />
      <button title="New Solid (Ctrl+Y)" onClick={() => store.addSolid()}>Solid</button>
      <button title="New Text Layer (Ctrl+Alt+Shift+T)" onClick={() => store.addText('Text')}>Text</button>
      <button title="New Null Object (Ctrl+Alt+Shift+Y)" onClick={() => store.addNull()}>Null</button>
      <button title="New Adjustment Layer (Ctrl+Alt+Y)" onClick={() => store.addAdjustment()}>Adjustment</button>
      <div className="sep" />
      <button title="Duplicate (Ctrl+D)" onClick={() => store.duplicateSelected()}>Duplicate</button>
      <button title="Delete (Delete)" onClick={() => store.deleteSelected()}>Delete</button>
      <div className="sep" />
      <button title="Easy Ease (F9)" onClick={() => store.applyEasyEaseToSelection('both')}>Easy Ease</button>
    </div>
  );
}
