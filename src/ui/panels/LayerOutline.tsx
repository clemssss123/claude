import { useEffect, useState } from 'react';
import { findLayer } from '@/core/composition';
import { valueAtTime } from '@/core/property';
import { BLEND_MODES, LABEL_COLORS, MASK_MODES, TRACK_MATTE_TYPES } from '@/core/types';
import { blendModeLabel } from '@/render/blendMode';
import { useEditor } from '@/state/store';
import { ScrubbableNumber } from '@/ui/components/ScrubbableNumber';
import type {
  AnyProperty, BlendMode, Composition, Id, MaskMode, TrackMatteType,
} from '@/core/types';
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

/** Indentation per outline level, in pixels. */
const INDENT = 14;

export function LayerOutline({ comp, rows, time, selectedLayerIds, onScroll, scrollRef }: Props) {
  return (
    <div
      className="body"
      ref={scrollRef}
      onScroll={(e) => onScroll((e.target as HTMLDivElement).scrollTop)}
    >
      {rows.map((row) => {
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
          return <GroupRow key={row.key} row={row} />;
        }
        if (row.kind === 'expression') {
          return (
            <ExpressionRow
              key={row.key}
              layerId={row.layerId}
              path={row.path}
              property={row.property}
              depth={row.depth}
            />
          );
        }
        return (
          <PropertyRow
            key={row.key}
            layerId={row.layerId}
            path={row.path}
            property={row.property}
            depth={row.depth}
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

  const hasLayerAbove = index > 1;

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
      <span
        className="name"
        title={layer.type === 'precomp'
          ? `${layer.name} — double-click to open this composition`
          : layer.name}
        onDoubleClick={() => {
          if (layer.type === 'precomp') useEditor.getState().openPrecompSource(layerId);
        }}
      >
        {layer.type === 'precomp' ? '▣ ' : layer.type === 'media' ? '🎞 ' : ''}{layer.name}
      </span>
      <div className="switches">
        {toggle('shy')}
        {toggle('motionBlur')}
      </div>
      <select
        value={layer.blendMode}
        title="Blend mode"
        style={{ maxWidth: 84 }}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => store.setBlendMode(layerId, e.target.value as BlendMode)}
      >
        {BLEND_MODES.map((mode) => (
          <option key={mode} value={mode}>{blendModeLabel(mode)}</option>
        ))}
      </select>
      <select
        value={layer.trackMatte}
        title={hasLayerAbove
          ? 'Track matte — uses the layer above'
          : 'Track matte needs a layer above this one'}
        style={{ maxWidth: 84 }}
        disabled={!hasLayerAbove}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => store.setTrackMatte(layerId, e.target.value as TrackMatteType)}
      >
        {TRACK_MATTE_TYPES.map((type) => (
          <option key={type} value={type}>{TRACK_MATTE_LABELS[type]}</option>
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

const TRACK_MATTE_LABELS: Record<TrackMatteType, string> = {
  none: 'No Matte',
  alpha: 'Alpha',
  'alpha-inverted': 'Alpha Inv.',
  luma: 'Luma',
  'luma-inverted': 'Luma Inv.',
};

/** Group header row: Masks, a single mask, a shape item, a text animator… */
function GroupRow({ row }: { row: Extract<TimelineRow, { kind: 'group' }> }) {
  const project = useEditor((s) => s.project);
  const comp = project.compositions.find((c) => c.id === project.activeCompId);
  const layer = comp && findLayer(comp, row.layerId);
  const target = row.target;

  const maskIndex = target?.type === 'mask' ? Number(target.path.split('.')[1]) : -1;
  const mask = layer && maskIndex >= 0 ? layer.masks[maskIndex] : undefined;
  const animatorIndex = target?.type === 'animator' ? Number(target.path.split('.')[1]) : -1;
  const animator = layer?.type === 'text' && animatorIndex >= 0
    ? layer.animators[animatorIndex] : undefined;
  const selectorParts = target?.type === 'selector' ? target.path.split('.') : null;

  return (
    <div className="prop-row group-row" style={{ height: ROW_HEIGHT, paddingLeft: 8 + row.depth * INDENT }}>
      {mask && (
        <span
          className="mask-swatch"
          style={{ background: mask.color }}
          title="Mask colour in the viewer"
        />
      )}
      <span className="prop-name group-name">▾ {row.name}</span>

      {mask && (
        <>
          <select
            value={mask.mode}
            title="Mask mode"
            onChange={(e) => useEditor.getState().updateMask(row.layerId, maskIndex, {
              mode: e.target.value as MaskMode,
            })}
          >
            {MASK_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </option>
            ))}
          </select>
          <label className="inline-check" title="Invert this mask">
            <input
              type="checkbox"
              checked={mask.inverted}
              onChange={() => useEditor.getState().updateMask(row.layerId, maskIndex, {
                inverted: !mask.inverted,
              })}
            />
            Inverted
          </label>
          <button
            className="icon"
            title="Delete mask"
            onClick={() => useEditor.getState().deleteMask(row.layerId, maskIndex)}
          >
            ✕
          </button>
        </>
      )}

      {animator && (
        <>
          <select
            value=""
            title="Add a property to this animator"
            onChange={(e) => {
              if (!e.target.value) return;
              useEditor.getState().toggleAnimatorProperty(
                row.layerId, animatorIndex,
                e.target.value as 'position' | 'scale' | 'rotation' | 'opacity' | 'tracking' | 'fillColor',
              );
            }}
          >
            <option value="">Add ▾</option>
            {(['position', 'scale', 'rotation', 'opacity', 'tracking', 'fillColor'] as const).map((key) => (
              <option key={key} value={key}>
                {animator.properties.enabled[key] ? `✓ ${PROPERTY_LABELS[key]}` : PROPERTY_LABELS[key]}
              </option>
            ))}
          </select>
          <button
            className="icon"
            title="Add a range selector"
            onClick={() => useEditor.getState().addRangeSelector(row.layerId, animatorIndex)}
          >
            + Selector
          </button>
        </>
      )}

      {selectorParts && animatorForSelector(layer, selectorParts) && (
        <SelectorOptions layerId={row.layerId} parts={selectorParts} />
      )}

      {row.key.endsWith(':contents') && (
        <select
          value=""
          title="Add a shape item to this layer"
          onChange={(e) => {
            if (!e.target.value) return;
            useEditor.getState().addShapeItem(
              row.layerId,
              e.target.value as 'fill' | 'stroke' | 'trim' | 'repeater' | 'offset',
            );
            e.target.value = '';
          }}
        >
          <option value="">Add ▾</option>
          <option value="fill">Fill</option>
          <option value="stroke">Stroke</option>
          <option value="trim">Trim Paths</option>
          <option value="repeater">Repeater</option>
          <option value="offset">Offset Paths</option>
        </select>
      )}

      {target?.type === 'shape' && (
        <button
          className="icon"
          title="Delete shape item"
          onClick={() => useEditor.getState().removeShapeItem(row.layerId, target.path)}
        >
          ✕
        </button>
      )}
    </div>
  );
}

const PROPERTY_LABELS: Record<string, string> = {
  position: 'Position',
  scale: 'Scale',
  rotation: 'Rotation',
  opacity: 'Opacity',
  tracking: 'Tracking',
  fillColor: 'Fill Color',
};

function animatorForSelector(layer: ReturnType<typeof findLayer>, parts: string[]) {
  if (!layer || layer.type !== 'text') return undefined;
  return layer.animators[Number(parts[1])]?.selectors[Number(parts[3])];
}

function SelectorOptions({ layerId, parts }: { layerId: Id; parts: string[] }) {
  const project = useEditor((s) => s.project);
  const comp = project.compositions.find((c) => c.id === project.activeCompId);
  const layer = comp && findLayer(comp, layerId);
  const selector = animatorForSelector(layer, parts);
  if (!selector) return null;

  const animatorIndex = Number(parts[1]);
  const selectorIndex = Number(parts[3]);
  const set = (patch: { shape?: string; units?: string; mode?: string }) => (
    useEditor.getState().setSelectorOption(layerId, animatorIndex, selectorIndex, patch)
  );

  return (
    <>
      <select value={selector.shape} title="Falloff shape" onChange={(e) => set({ shape: e.target.value })}>
        {['square', 'ramp-up', 'ramp-down', 'triangle', 'round', 'smooth'].map((shape) => (
          <option key={shape} value={shape}>{shape}</option>
        ))}
      </select>
      <select value={selector.units} title="Units" onChange={(e) => set({ units: e.target.value })}>
        <option value="percent">%</option>
        <option value="index">index</option>
      </select>
      <select value={selector.mode} title="Mode" onChange={(e) => set({ mode: e.target.value })}>
        <option value="add">Add</option>
        <option value="subtract">Subtract</option>
      </select>
    </>
  );
}

/** The editable expression attached to a property, with its error if any. */
function ExpressionRow({ layerId, path, property, depth }: {
  layerId: Id; path: string; property: AnyProperty; depth: number;
}) {
  const [draft, setDraft] = useState(property.expression ?? '');
  const [focused, setFocused] = useState(false);
  const error = useEditor((s) => s.expressionErrors[property.id]);

  // While the field is not focused it follows the document, so undo shows.
  useEffect(() => {
    if (!focused) setDraft(property.expression ?? '');
  }, [property.expression, focused]);

  return (
    <div
      className={`prop-row expression-row ${error ? 'has-error' : ''}`}
      style={{ height: ROW_HEIGHT, paddingLeft: 8 + depth * INDENT }}
    >
      <span className="expr-mark" title={error ?? 'Expression'}>=</span>
      <input
        className="expr-input"
        value={draft}
        spellCheck={false}
        placeholder="value"
        title={error ?? 'Expression'}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          useEditor.getState().setExpression(layerId, path, draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(property.expression ?? '');
            (e.target as HTMLInputElement).blur();
          }
          e.stopPropagation();
        }}
      />
      <button
        className="icon"
        title="Remove expression"
        onClick={() => useEditor.getState().setExpression(layerId, path, null)}
      >
        ✕
      </button>
    </div>
  );
}

/** "transform.position.dimensions.0" -> "transform.position", else null. */
function parentVectorPath(path: string): string | null {
  const match = /^(.*)\.dimensions\.\d+$/.exec(path);
  return match ? match[1] : null;
}

function PropertyRow({ layerId, path, property, depth, time }: {
  layerId: Id; path: string; property: AnyProperty; depth: number; time: number;
}) {
  const store = useEditor.getState();
  const selected = useEditor((s) => s.selectedProperties.some(
    (p) => p.layerId === layerId && p.path === path,
  ));
  const value = valueAtTime(property, time);
  const hasKeyAtTime = property.animated
    && property.keyframes.some((k) => Math.abs(k.time - time) < 1e-6);

  const vectorPath = parentVectorPath(path);
  const separated = vectorPath !== null;
  const showSeparateToggle = property.spatial || (separated && path.endsWith('.0'));
  const togglePath = vectorPath ?? path;

  const components = property.kind === 'path'
    ? null
    : (Array.isArray(value) ? value : [value as number]);

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

  return (
    <div
      className={`prop-row ${selected ? 'selected' : ''}`}
      style={{ height: ROW_HEIGHT, paddingLeft: 8 + depth * INDENT }}
    >
      <button
        className={`stopwatch ${property.animated ? 'on' : ''} ${property.expression ? 'expr' : ''}`}
        title="Stopwatch — Alt+click to add an expression"
        onClick={(e) => {
          if (e.altKey) useEditor.getState().toggleExpression(layerId, path);
          else store.toggleStopwatch(layerId, path);
        }}
      >
        {property.expression ? '=' : property.animated ? '⏱' : '○'}
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
        {components === null && (
          <span className="shape-value" title="Edit the path in the Composition panel">
            Shape
          </span>
        )}
        {components?.map((component, i) => (
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
