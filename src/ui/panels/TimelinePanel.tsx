import { useEffect, useMemo, useRef, useState } from 'react';
import { activeComposition } from '@/core/project';
import { formatFrames, formatTimecode } from '@/core/time';
import { useEditor } from '@/state/store';
import { ContextMenu } from '@/ui/components/ContextMenu';
import { Splitter } from '@/ui/components/Splitter';
import type { KeyframeRef } from '@/state/store';
import { LayerOutline } from './LayerOutline';
import { TrackArea } from './TrackArea';
import type { TimelineView } from './TrackArea';
import { buildRows } from './timelineRows';

export function TimelinePanel() {
  const project = useEditor((s) => s.project);
  const time = useEditor((s) => s.time);
  const revealed = useEditor((s) => s.revealed);
  const selectedLayerIds = useEditor((s) => s.selectedLayerIds);
  const selectedKeyframes = useEditor((s) => s.selectedKeyframes);
  const timeDisplay = useEditor((s) => s.timeDisplay);
  const graphEditor = useEditor((s) => s.graphEditor);

  const comp = activeComposition(project);
  const [outlineWidth, setOutlineWidth] = useState(400);
  const [scrollTop, setScrollTop] = useState(0);
  const [shyHidden, setShyHidden] = useState(false);
  const [view, setView] = useState<TimelineView>({ start: 0, end: comp?.duration ?? 10 });
  const [menu, setMenu] = useState<{ x: number; y: number; ref: KeyframeRef } | null>(null);
  const outlineRef = useRef<HTMLDivElement>(null);

  // Keep the visible range inside the composition when its duration changes.
  useEffect(() => {
    if (!comp) return;
    setView((v) => (v.end > comp.duration ? { start: 0, end: comp.duration } : v));
  }, [comp?.duration, comp]);

  useEffect(() => {
    if (outlineRef.current && outlineRef.current.scrollTop !== scrollTop) {
      outlineRef.current.scrollTop = scrollTop;
    }
  }, [scrollTop]);

  const rows = useMemo(
    () => (comp ? buildRows(comp, revealed, shyHidden) : []),
    [comp, revealed, shyHidden, project],
  );

  if (!comp) return <div className="panel"><div className="empty-note">No composition.</div></div>;

  const store = useEditor.getState();

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="tl-head">
        <span
          className="timecode"
          title="Current time — click to toggle timecode / frames"
          onClick={() => store.setTimeDisplay(timeDisplay === 'timecode' ? 'frames' : 'timecode')}
        >
          {timeDisplay === 'timecode'
            ? formatTimecode(time, comp.frameRate)
            : `${formatFrames(time, comp.frameRate)} f`}
        </span>
        <button
          className={shyHidden ? 'icon active' : 'icon'}
          title="Hide shy layers"
          onClick={() => setShyHidden((v) => !v)}
        >
          Shy
        </button>
        <button
          className={comp.motionBlur.enabled ? 'icon active' : 'icon'}
          title="Enable motion blur for the composition (renders in phase 5)"
          onClick={() => store.updateCompSettings({
            motionBlur: { ...comp.motionBlur, enabled: !comp.motionBlur.enabled },
          })}
        >
          Motion Blur
        </button>
        <span style={{ flex: 1 }} />
        <button
          className={graphEditor ? 'icon active' : 'icon'}
          title="Graph Editor (Shift+F3) — arrives in phase 2"
          onClick={() => {
            store.toggleGraphEditor();
            store.setStatus('Graph Editor lands in phase 2.');
          }}
        >
          Graph Editor
        </button>
        <button
          className="icon"
          title="Fit timeline to composition"
          onClick={() => setView({ start: 0, end: comp.duration })}
        >
          Fit
        </button>
      </div>

      <div
        className="timeline"
        style={{ ['--outline-width' as string]: `${outlineWidth}px`, flex: 1, minHeight: 0 }}
      >
        <div className="timeline-outline">
          <div className="tl-colhead">
            <span style={{ width: 92 }}>Switches</span>
            <span style={{ flex: 1 }}>Layer Name</span>
            <span style={{ width: 96 }}>Mode</span>
            <span style={{ width: 96 }}>Parent</span>
          </div>
          <LayerOutline
            comp={comp}
            rows={rows}
            time={time}
            selectedLayerIds={selectedLayerIds}
            scrollRef={outlineRef}
            onScroll={setScrollTop}
          />
        </div>

        <Splitter
          orientation="vertical"
          onDrag={(dx) => setOutlineWidth((w) => Math.min(760, Math.max(220, w + dx)))}
        />

        <TrackArea
          comp={comp}
          rows={rows}
          time={time}
          view={view}
          scrollTop={scrollTop}
          selectedLayerIds={selectedLayerIds}
          selectedKeyframes={selectedKeyframes}
          onViewChange={setView}
          onScroll={setScrollTop}
          onKeyframeContextMenu={(x, y, ref) => setMenu({ x, y, ref })}
        />
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Easy Ease  (F9)', onSelect: () => store.applyEasyEaseToSelection('both') },
            { label: 'Easy Ease In  (Shift+F9)', onSelect: () => store.applyEasyEaseToSelection('in') },
            { label: 'Easy Ease Out  (Ctrl+Shift+F9)', onSelect: () => store.applyEasyEaseToSelection('out') },
            { label: '', divider: true },
            { label: 'Linear', onSelect: () => store.setSelectedInterpolation('linear') },
            { label: 'Bezier', onSelect: () => store.setSelectedInterpolation('bezier') },
            { label: 'Hold', onSelect: () => store.setSelectedInterpolation('hold') },
            { label: '', divider: true },
            { label: 'Delete Keyframes', onSelect: () => store.deleteSelectedKeyframes() },
          ]}
        />
      )}
    </div>
  );
}
