import { activeComposition } from '@/core/project';
import { formatTimecode } from '@/core/time';
import { useEditor } from '@/state/store';

export function PreviewPanel() {
  const project = useEditor((s) => s.project);
  const playing = useEditor((s) => s.playing);
  const loop = useEditor((s) => s.loopPlayback);
  const time = useEditor((s) => s.time);
  const selected = useEditor((s) => s.selectedLayerIds);
  const comp = activeComposition(project);
  const store = useEditor.getState();

  return (
    <div className="panel">
      <header>Preview</header>
      <div className="body" style={{ padding: 8 }}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
          <button title="Go to start (Home)" onClick={() => store.goToStart()}>⏮</button>
          <button title="Back 1 frame (Page Up)" onClick={() => store.stepFrames(-1)}>◀</button>
          <button
            title="Play / Pause (Space)"
            className={playing ? 'active' : ''}
            onClick={() => store.togglePlay()}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <button title="Forward 1 frame (Page Down)" onClick={() => store.stepFrames(1)}>▶</button>
          <button title="Go to end (End)" onClick={() => store.goToEnd()}>⏭</button>
          <button
            title="Loop over the work area"
            className={loop ? 'active' : ''}
            onClick={() => useEditor.setState({ loopPlayback: !loop })}
          >
            ⟳
          </button>
        </div>

        {comp && (
          <div style={{ color: 'var(--text-dim)', lineHeight: 1.8 }}>
            <div>Time&nbsp;&nbsp;<span style={{ color: 'var(--text-bright)' }}>
              {formatTimecode(time, comp.frameRate)}
            </span></div>
            <div>Work area&nbsp;&nbsp;{formatTimecode(comp.workAreaStart, comp.frameRate)} → {formatTimecode(comp.workAreaEnd, comp.frameRate)}</div>
            <div>Layers&nbsp;&nbsp;{comp.layers.length}, {selected.length} selected</div>
          </div>
        )}
      </div>
    </div>
  );
}
