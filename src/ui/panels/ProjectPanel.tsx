import { activeComposition } from '@/core/project';
import { useEditor } from '@/state/store';

export function ProjectPanel() {
  const project = useEditor((s) => s.project);
  const active = activeComposition(project);
  const store = useEditor.getState();

  return (
    <div className="panel">
      <header>
        <span>Project</span>
        <span className="spacer" />
        <button className="icon" title="New Composition (Ctrl+N)" onClick={() => store.newComposition()}>+</button>
      </header>
      <div className="body">
        <div style={{ padding: '6px 8px', color: 'var(--text-dim)' }}>{project.name}</div>
        {project.compositions.map((comp) => (
          <div
            key={comp.id}
            className={`layer-row ${comp.id === project.activeCompId ? 'selected' : ''}`}
            style={{ paddingLeft: 8 }}
            onClick={() => store.setActiveComp(comp.id)}
          >
            <span style={{ flex: 1 }}>🎬 {comp.name}</span>
            <span style={{ color: 'var(--text-dim)' }}>{comp.layers.length}</span>
          </div>
        ))}
        {active && (
          <div style={{ padding: '10px 8px', color: 'var(--text-dim)', lineHeight: 1.7 }}>
            <div>{active.width} × {active.height}</div>
            <div>{active.frameRate} fps</div>
            <div>{active.duration.toFixed(2)} s</div>
            <button
              style={{ marginTop: 8 }}
              onClick={() => store.openDialog('compSettings')}
            >
              Composition Settings…
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
