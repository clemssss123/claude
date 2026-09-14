import { findLayer } from '@/core/composition';
import { valueAtTime } from '@/core/property';
import { BLEND_MODES, LABEL_COLORS } from '@/core/types';
import { blendModeLabel } from '@/render/blendMode';
import { useEditor } from '@/state/store';
import { ScrubbableNumber } from '@/ui/components/ScrubbableNumber';
import type { AnyProperty, BlendMode, Composition, Id } from '@/core/types';
import type { TimelineRow } from './timelineRows';
import { ROW_HEIGHT } from './timelineRows';

interface Props {
  comp: Composition;
  rows: TimelineRow[];
  time: number;
  selectedLayerIds: Id[];
  onScroll: (top: number) => void;
  scrollRef: React.RefObject<HTMLDivElement>;
}

export function LayerOutline({ comp, rows, time, selectedLayerIds, onScroll, scrollRef }: Props) {
  return (
    <div
      className="body"
      ref={scrollRef}
      onScroll={(e) => onScroll((e.target as HTMLDivElement).scrollTop)}
    >
      {rows.map((row, index) => {
        if (row.kind === 'layer') {
          return (
            <LayerRow
              key={`l${row.layerId}`}
              comp={comp}
              layerId={row.layerId}
              index={comp.layers.findIndex((l) => l.id === row.layerId) + 1}
              selected={selectedLayerIds.includes(row.layerId)}
            />
          );
        }
        if (row.kind === 'group') {
          return (
            <div className="prop-row" key={`g${row.layerId}${index}`} style={{ paddingLeft: 18 }}>
              <span className="prop-name" style={{ color: 'var(--text)' }}>▾ {row.name}</span>
            </div>
          );
        }
        return (
          <PropertyRow
            key={`p${row.layerId}${row.path}`}
            layerId={row.layerId}
            path={row.path}
            property={row.property}
            time={time}
          />
        );
      })}
      <div style={{ height: ROW_HEIGHT }} />
    </div>
  );
}

function LayerRow({ comp, layerId, index, selected }: {
  comp: Composition; layerId: Id; index: number; selected: boolean;
}) {
  const layer = findLayer(comp, layerId);
  const expanded = useEditor((s) => Boolean(s.expanded[layerId]));
  const store = useEditor.getState();
  if (!layer) return null;

  const toggle = (key: 'enabled' | 'solo' | 'shy' | 'locked' | 'motionBlur') => (
    <button
      className={`icon ${layer[key] ? 'active' : ''}`}
      title={key}
      onClick={(e) => { e.stopPropagation(); useEditor.getState().toggleSwitch(layerId, key); }}
    >
      {SWITCH_GLYPH[key]}
    </button>
  );

  return (
    <div
      className={`layer-row ${selected ? 'selected' : ''}`}
      style={{ height: ROW_HEIGHT }}
      onPointerDown={(e) => useEditor.getState().selectLayer(layerId, e.shiftKey || e.ctrlKey)}
    >
      <div className="label-strip" style={{ background: LABEL_COLORS[layer.label % LABEL_COLORS.length] }} />
      {toggle('enabled')}
      {toggle('solo')}
      {toggle('locked')}
      <span className="index">{index}</span>
      <button
        className="icon"
        title="Expand properties"
        onClick={(e) => { e.stopPropagation(); useEditor.getState().toggleExpanded(layerId); }}
      >
        {expanded ? '▾' : '▸'}
      </button>
      <span className="name" title={layer.name}>{layer.name}</span>
      <div className="switches">
        {toggle('shy')}
        {toggle('motionBlur')}
      </div>
      <select
        value={layer.blendMode}
        title="Blend mode"
        style={{ maxWidth: 92 }}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => store.setBlendMode(layerId, e.target.value as BlendMode)}
      >
        {BLEND_MODES.map((mode) => (
          <option key={mode} value={mode}>{blendModeLabel(mode)}</option>
        ))}
      </select>
      <select
        className="parent"
        title="Parent"
        value={layer.parentId ?? ''}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => store.setParent(layerId, e.target.value || null)}
      >
        <option value="">None</option>
        {comp.layers.filter((l) => l.id !== layerId).map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
    </div>
  );
}

const SWITCH_GLYPH: Record<string, string> = {
  enabled: '👁',
  solo: '◉',
  locked: '🔒',
  shy: 'S',
  motionBlur: 'M',
};

/** "transform.position.dimensions.0" -> "transform.position", else null. */
function parentVectorPath(path: string): string | null {
  const match = /^(.*)\.dimensions\.\d+$/.exec(path);
  return match ? match[1] : null;
}

function PropertyRow({ layerId, path, property, time }: {
  layerId: Id; path: string; property: AnyProperty; time: number;
}) {
  const store = useEditor.getState();
  const selected = useEditor((s) => s.selectedProperties.some(
    (p) => p.layerId === layerId && p.path === path,
  ));
  const value = valueAtTime(property, time);
  const hasKeyAtTime = property.animated
    && property.keyframes.some((k) => Math.abs(k.time - time) < 1e-6);

  // The separate/merge toggle belongs to the vector, so it is shown on the
  // vector's own row or on the first of its split dimensions.
  const vectorPath = parentVectorPath(path);
  const separated = vectorPath !== null;
  const showSeparateToggle = property.spatial || (separated && path.endsWith('.0'));
  const togglePath = vectorPath ?? path;

  const setComponent = (index: number, next: number, phase: 'drag' | 'commit') => {
    const current = valueAtTime(property, time);
    const out = Array.isArray(current) ? [...current] : [current as number];
    out[index] = next;
    useEditor.getState().setPropertyValue(
      layerId,
      path,
      (Array.isArray(current) ? out : out[0]) as never,
      phase === 'drag' ? `prop:${layerId}:${path}` : undefined,
    );
  };

  const components = Array.isArray(value) ? value : [value as number];

  return (
    <div className={`prop-row ${selected ? 'selected' : ''}`} style={{ height: ROW_HEIGHT }}>
      <button
        className={`stopwatch ${property.animated ? 'on' : ''}`}
        title="Toggle animation (stopwatch)"
        onClick={() => store.toggleStopwatch(layerId, path)}
      >
        {property.animated ? '⏱' : '○'}
      </button>
      <span
        className="prop-name"
        title="Click to graph this property; double-click to select all its keyframes"
        onClick={(e) => useEditor.getState().selectProperty(
          { layerId, path }, e.shiftKey || e.ctrlKey,
        )}
        onDoubleClick={() => useEditor.getState().selectAllKeyframesOf({ layerId, path })}
      >
        {property.name}
      </span>
      {showSeparateToggle && (
        <button
          className={`sep-dimensions ${separated ? 'on' : ''}`}
          title={separated ? 'Merge dimensions' : 'Separate dimensions'}
          onClick={() => useEditor.getState().toggleSeparateDimensions(layerId, togglePath)}
        >
          ⇔
        </button>
      )}
      <div className="prop-value">
        {components.map((component, i) => (
          <ScrubbableNumber
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            value={component}
            unit={property.unit ?? ''}
            min={property.min}
            max={property.max}
            speed={property.speedPerPixel ?? 1}
            title={property.dimensionNames?.[i]}
            onChange={(next, phase) => setComponent(i, next, phase)}
          />
        ))}
      </div>
      {property.animated && (
        <div className="kf-nav">
          <button title="Previous keyframe" onClick={() => store.goToPrevKeyframe()}>◀</button>
          <button
            className={`dot ${hasKeyAtTime ? 'on' : ''}`}
            title="Add or remove keyframe at current time"
            onClick={() => useEditor.getState().toggleKeyframeAt(layerId, path)}
          >
            {hasKeyAtTime ? '◆' : '◇'}
          </button>
          <button title="Next keyframe" onClick={() => store.goToNextKeyframe()}>▶</button>
        </div>
      )}
    </div>
  );
}
