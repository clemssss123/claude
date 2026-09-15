import { useEffect, useRef, useState } from 'react';
import { openProjectFile, saveProjectFile } from '@/input/shortcuts';
import { useShortcuts } from '@/input/useShortcuts';
import { buildLabel } from '@/core/version';
import { isDesktop } from '@/state/desktop';
import { readAutoSave, writeAutoSave } from '@/state/persistence';
import { useEditor } from '@/state/store';
import { usePlayback } from '@/state/usePlayback';
import { Splitter } from '@/ui/components/Splitter';
import { CompSettingsDialog } from '@/ui/dialogs/CompSettingsDialog';
import { EffectsBrowserDialog } from '@/ui/dialogs/EffectsBrowserDialog';
import { ExportDialog } from '@/ui/dialogs/ExportDialog';
import { SolidSettingsDialog } from '@/ui/dialogs/SolidSettingsDialog';
import { KeyframeInterpolationDialog } from '@/ui/dialogs/KeyframeInterpolationDialog';
import { KeyframeVelocityDialog } from '@/ui/dialogs/KeyframeVelocityDialog';
import { ShortcutsDialog } from '@/ui/dialogs/ShortcutsDialog';
import { UpdateDialog } from '@/ui/dialogs/UpdateDialog';
import { EffectControlsPanel } from '@/ui/panels/EffectControlsPanel';
import { PreviewPanel } from '@/ui/panels/PreviewPanel';
import { ProjectPanel } from '@/ui/panels/ProjectPanel';
import { TimelinePanel } from '@/ui/panels/TimelinePanel';
import { ViewerPanel } from '@/ui/panels/ViewerPanel';
import { Toolbar } from '@/ui/Toolbar';

/** How often the document is snapshotted into IndexedDB. */
const AUTOSAVE_INTERVAL_MS = 15_000;

export function App() {
  useShortcuts();
  usePlayback();

  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(280);
  const [timelineHeight, setTimelineHeight] = useState(390);

  const dialog = useEditor((s) => s.dialog);
  const project = useEditor((s) => s.project);
  const [restorable, setRestorable] = useState<{ savedAt: number } | null>(null);
  const restoredProject = useRef<Awaited<ReturnType<typeof readAutoSave>>>(null);
  const status = useEditor((s) => s.statusMessage);
  const past = useEditor((s) => s.past);
  const store = useEditor.getState();

  // A snapshot from a previous session is offered back rather than loaded
  // over whatever the user is looking at now.
  useEffect(() => {
    let alive = true;
    (async () => {
      const snapshot = await readAutoSave();
      if (!alive || !snapshot) return;
      restoredProject.current = snapshot;
      setRestorable({ savedAt: snapshot.savedAt });
    })();
    return () => { alive = false; };
  }, []);

  // Snapshot the document periodically, so a closed tab is not a lost session.
  useEffect(() => {
    const id = window.setInterval(() => { void writeAutoSave(project); }, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [project]);

  // Escape closes whichever dialog is open.
  useEffect(() => {
    if (!dialog) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useEditor.getState().openDialog(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialog]);

  // Status messages are transient.
  useEffect(() => {
    if (!status) return undefined;
    const id = window.setTimeout(() => useEditor.getState().setStatus(null), 4000);
    return () => window.clearTimeout(id);
  }, [status]);

  return (
    <div className="app">
      <div className="menubar">
        <span className="brand">KEYFRAME STUDIO</span>
        <button onClick={() => store.newComposition()}>New Comp</button>
        <button onClick={() => store.openDialog('compSettings')}>Comp Settings</button>
        <button onClick={() => { void saveProjectFile(useEditor.getState()); }}>Save</button>
        <button onClick={() => { void openProjectFile(); }}>Open</button>
        <button onClick={() => store.openDialog('export')}>Export…</button>
        <button onClick={() => store.undo()} disabled={past.length === 0}>Undo</button>
        <button onClick={() => store.redo()}>Redo</button>
        <span className="spacer" />
        <button onClick={() => store.openDialog('updates')}>Update</button>
        <button onClick={() => store.openDialog('shortcuts')}>Keyboard Shortcuts (F1)</button>
      </div>

      <Toolbar />

      <div
        className="workspace"
        style={{ ['--timeline-height' as string]: `${timelineHeight}px` }}
      >
        <div
          className="upper"
          style={{
            ['--left-width' as string]: `${leftWidth}px`,
            ['--right-width' as string]: `${rightWidth}px`,
          }}
        >
          <ProjectPanel />
          <Splitter
            orientation="vertical"
            onDrag={(dx) => setLeftWidth((w) => Math.min(520, Math.max(160, w + dx)))}
          />
          <ViewerPanel />
          <Splitter
            orientation="vertical"
            onDrag={(dx) => setRightWidth((w) => Math.min(520, Math.max(180, w - dx)))}
          />
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ flex: 2, minHeight: 0, display: 'flex' }}><EffectControlsPanel /></div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex' }}><PreviewPanel /></div>
          </div>
        </div>

        <Splitter
          orientation="horizontal"
          onDrag={(dy) => setTimelineHeight((h) => Math.min(760, Math.max(160, h - dy)))}
        />

        <TimelinePanel />
      </div>

      {restorable && (
        <div className="restore-bar">
          <span>
            A project from {new Date(restorable.savedAt).toLocaleString()} was
            auto-saved {isDesktop() ? 'on this computer' : 'in this browser'}.
          </span>
          <button
            className="active"
            onClick={() => {
              if (restoredProject.current) {
                useEditor.getState().loadProject(restoredProject.current.project);
                useEditor.getState().setStatus('Restored the auto-saved project.');
              }
              setRestorable(null);
            }}
          >
            Restore
          </button>
          <button onClick={() => setRestorable(null)}>Dismiss</button>
        </div>
      )}

      <div className="status-bar">
        <span>{status ?? 'Ready'}</span>
        <span style={{ flex: 1 }} />
        <span title="Click for updates" style={{ cursor: 'pointer' }} onClick={() => store.openDialog('updates')}>
          Keyframe Studio {buildLabel()}
        </span>
      </div>

      {dialog === 'compSettings' && <CompSettingsDialog onClose={() => store.openDialog(null)} />}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => store.openDialog(null)} />}
      {dialog === 'updates' && <UpdateDialog onClose={() => store.openDialog(null)} />}
      {dialog === 'effects' && <EffectsBrowserDialog onClose={() => store.openDialog(null)} />}
      {dialog === 'export' && <ExportDialog onClose={() => store.openDialog(null)} />}
      {dialog === 'solidSettings' && <SolidSettingsDialog onClose={() => store.openDialog(null)} />}
      {dialog === 'velocity' && <KeyframeVelocityDialog onClose={() => store.openDialog(null)} />}
      {dialog === 'interpolation' && (
        <KeyframeInterpolationDialog onClose={() => store.openDialog(null)} />
      )}
    </div>
  );
}
