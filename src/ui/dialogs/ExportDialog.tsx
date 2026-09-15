import { useEffect, useRef, useState } from 'react';
import { activeComposition } from '@/core/project';
import { formatTimecode } from '@/core/time';
import {
  DEFAULT_EXPORT_SETTINGS, exportComposition, plannedCodec, webCodecsAvailable,
} from '@/render/export';
import type { ExportFormat, ExportProgress, ExportSettings } from '@/render/export';
import { desktop, filtersForFilename } from '@/state/desktop';
import { useEditor } from '@/state/store';

/** Render the composition out to a video file or a PNG sequence. */
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project);
  const comp = activeComposition(project);
  const [settings, setSettings] = useState<ExportSettings>(DEFAULT_EXPORT_SETTINGS);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /** Where the last export landed, in the desktop app. */
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [codecs, setCodecs] = useState<Record<string, string | null>>({});
  const cancel = useRef({ cancelled: false });

  useEffect(() => {
    if (!comp) return;
    let alive = true;
    (async () => {
      const entries = await Promise.all((['mp4', 'webm', 'png'] as ExportFormat[]).map(
        async (format) => [format, await plannedCodec(format, comp.width, comp.height)] as const,
      ));
      if (alive) setCodecs(Object.fromEntries(entries));
    })();
    return () => { alive = false; };
  }, [comp]);

  if (!comp) return null;

  const start = settings.range === 'workArea' ? comp.workAreaStart : 0;
  const end = settings.range === 'workArea' ? comp.workAreaEnd : comp.duration;
  const frames = Math.max(1, Math.round((end - start) * comp.frameRate));

  const run = async () => {
    setError(null);
    setDone(null);
    setSavedPath(null);
    cancel.current = { cancelled: false };
    setProgress({ frame: 0, total: frames, stage: 'rendering' });
    try {
      const result = await exportComposition({
        project,
        comp,
        settings,
        onProgress: setProgress,
        signal: cancel.current,
      });
      // The desktop app asks where the file should go and writes it there;
      // a browser can only hand it to the download folder.
      const bridge = desktop();
      if (bridge) {
        const saved = await bridge.saveFile({
          data: new Uint8Array(await result.blob.arrayBuffer()),
          suggestedName: result.filename,
          filters: filtersForFilename(result.filename),
        });
        if (!saved) {
          setProgress(null);
          return;
        }
        setSavedPath(saved.path);
      } else {
        const url = URL.createObjectURL(result.blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = result.filename;
        link.click();
        URL.revokeObjectURL(url);
      }
      setDone(
        `${result.filename} — ${result.frames} frames, ${result.codec}, `
        + `${formatSize(result.blob.size)}`,
      );
      useEditor.getState().setStatus(`Exported ${result.filename}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  const running = progress !== null;
  const percent = progress ? Math.round((progress.frame / progress.total) * 100) : 0;

  return (
    <div className="modal-backdrop" onPointerDown={running ? undefined : onClose}>
      <div className="modal" style={{ width: 460 }} onPointerDown={(e) => e.stopPropagation()}>
        <header>Export Composition — {comp.name}</header>
        <div className="content">
          <div className="field">
            <label>Format</label>
            <select
              value={settings.format}
              disabled={running}
              onChange={(e) => setSettings({ ...settings, format: e.target.value as ExportFormat })}
            >
              <option value="mp4" disabled={codecs.mp4 === null}>
                MP4 {codecs.mp4 ? `(${codecs.mp4})` : '— no encoder in this browser'}
              </option>
              <option value="webm" disabled={codecs.webm === null}>
                WebM {codecs.webm ? `(${codecs.webm})` : '— no encoder in this browser'}
              </option>
              <option value="png">PNG sequence (.zip)</option>
            </select>
          </div>

          <div className="field">
            <label>Range</label>
            <select
              value={settings.range}
              disabled={running}
              onChange={(e) => setSettings({
                ...settings, range: e.target.value as 'workArea' | 'composition',
              })}
            >
              <option value="workArea">Work Area</option>
              <option value="composition">Whole Composition</option>
            </select>
          </div>

          <div className="field">
            <label>Size</label>
            <select
              value={settings.scale}
              disabled={running}
              onChange={(e) => setSettings({ ...settings, scale: Number(e.target.value) })}
            >
              <option value={1}>Full — {comp.width} × {comp.height}</option>
              <option value={0.5}>Half — {Math.round(comp.width / 2)} × {Math.round(comp.height / 2)}</option>
              <option value={0.25}>Quarter — {Math.round(comp.width / 4)} × {Math.round(comp.height / 4)}</option>
            </select>
          </div>

          {settings.format !== 'png' && (
            <div className="field">
              <label>Bitrate</label>
              <select
                value={settings.bitrate}
                disabled={running}
                onChange={(e) => setSettings({ ...settings, bitrate: Number(e.target.value) })}
              >
                <option value={4_000_000}>4 Mbps — draft</option>
                <option value={12_000_000}>12 Mbps — good</option>
                <option value={30_000_000}>30 Mbps — high</option>
                <option value={60_000_000}>60 Mbps — very high</option>
              </select>
            </div>
          )}

          <div style={{ color: 'var(--text-dim)', marginTop: 10, lineHeight: 1.7 }}>
            <div>
              {formatTimecode(start, comp.frameRate)} → {formatTimecode(end, comp.frameRate)}
              {' · '}{frames} frames at {comp.frameRate} fps
            </div>
            {!webCodecsAvailable() && (
              <div>This browser has no WebCodecs encoder — the PNG sequence still works.</div>
            )}
            {settings.format === 'mp4' && codecs.mp4 && codecs.mp4 !== 'H.264' && (
              <div>
                This browser has no H.264 encoder, so the MP4 will use {codecs.mp4}.
                It plays in modern browsers; older editors may not read it.
              </div>
            )}
          </div>

          {running && (
            <div className="export-progress">
              <div className="export-bar"><div style={{ width: `${percent}%` }} /></div>
              <div>
                {progress.stage === 'finishing'
                  ? 'Finishing the file…'
                  : `Frame ${progress.frame} of ${progress.total} — ${percent}%`}
              </div>
            </div>
          )}

          {error && <div className="export-error">{error}</div>}
          {done && (
            <div className="export-done">
              Saved {done}
              {savedPath && (
                <button
                  style={{ marginLeft: 8 }}
                  onClick={() => { void desktop()?.revealFile(savedPath); }}
                >
                  Show in folder
                </button>
              )}
            </div>
          )}
        </div>
        <footer>
          {running
            ? <button onClick={() => { cancel.current.cancelled = true; }}>Cancel</button>
            : <button onClick={onClose}>Close</button>}
          <button className="active" disabled={running} onClick={run}>Export</button>
        </footer>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
