import { useEffect, useRef, useState } from 'react';
import { activeComposition } from '@/core/project';
import type { FootageAsset } from '@/core/types';
import { footageThumbnail, onFootageFrameReady } from '@/render/assets';
import { useEditor } from '@/state/store';

export function ProjectPanel() {
  const project = useEditor((s) => s.project);
  const active = activeComposition(project);
  const store = useEditor.getState();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);

  return (
    <div className="panel">
      <header>
        <span>Project</span>
        <span className="spacer" />
        <button
          className="icon"
          title="Import Footage… (Ctrl+I)"
          onClick={() => fileInput.current?.click()}
        >
          ⭳
        </button>
        <button className="icon" title="New Composition (Ctrl+N)" onClick={() => store.newComposition()}>+</button>
      </header>
      <input
        ref={fileInput}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        data-testid="footage-input"
        onChange={(event) => {
          const files = event.target.files;
          if (files && files.length > 0) void store.importFootage(files);
          // Let the same file be picked again after a remove.
          event.target.value = '';
        }}
      />
      <div
        className={`body ${dropping ? 'drop-target' : ''}`}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDropping(false);
          if (event.dataTransfer.files.length > 0) {
            void store.importFootage(event.dataTransfer.files);
          }
        }}
      >
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

        <div className="footage-list" data-testid="footage-list">
          {project.footage.map((asset) => (
            <FootageRow key={asset.id} asset={asset} />
          ))}
          {project.footage.length === 0 && (
            <div className="footage-empty">
              Drop images or video here, or use Import.
            </div>
          )}
        </div>

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

/**
 * One imported item. Double-click adds it to the active composition, the way
 * the Project panel does in After Effects.
 */
function FootageRow({ asset }: { asset: FootageAsset }) {
  const store = useEditor.getState();
  const [thumb, setThumb] = useState<string | null>(() => footageThumbnail(asset.id));

  // A video's first frame may only decode a moment after the import lands.
  useEffect(() => {
    if (thumb || asset.missing) return undefined;
    const update = () => setThumb(footageThumbnail(asset.id));
    update();
    const timer = window.setTimeout(update, 120);
    const off = onFootageFrameReady(update);
    return () => { window.clearTimeout(timer); off(); };
  }, [asset.id, asset.missing, thumb]);

  return (
    <div
      className={`footage-row ${asset.missing ? 'missing' : ''}`}
      data-testid="footage-row"
      title={`${asset.name}\n${asset.width} × ${asset.height}`}
      onDoubleClick={() => store.addFootageToComp(asset.id)}
    >
      <div className="footage-thumb">
        {thumb
          ? <img src={thumb} alt="" />
          : <span>{asset.missing ? '⚠' : asset.kind === 'video' ? '🎞' : '🖼'}</span>}
      </div>
      <div className="footage-meta">
        <div className="footage-name">{asset.name}</div>
        <div className="footage-detail">
          {asset.missing
            ? 'Missing'
            : `${asset.width}×${asset.height} · ${describeSource(asset)} · ${formatSize(asset.size)}`}
        </div>
      </div>
      <div className="footage-actions">
        {asset.missing ? (
          <button className="icon" title="Relink…" onClick={() => void store.relinkFootage(asset.id)}>🔗</button>
        ) : (
          <button className="icon" title="Add to composition" onClick={() => store.addFootageToComp(asset.id)}>+</button>
        )}
        <button className="icon" title="Remove" onClick={() => void store.removeFootage(asset.id)}>×</button>
      </div>
    </div>
  );
}

function describeSource(asset: FootageAsset): string {
  return asset.kind === 'video' ? `${asset.duration.toFixed(2)} s` : 'Still';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
