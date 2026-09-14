import { useState } from 'react';
import { findLayer } from '@/core/composition';
import { getProperty, transformProperties } from '@/core/layer';
import { activeComposition } from '@/core/project';
import { rgbToHex, hexToRgba, valueAtTime } from '@/core/property';
import { allEffectDefinitions, getEffectDefinition } from '@/render/effects';
import type { EffectParamDef } from '@/render/effects';
import { useEditor } from '@/state/store';
import { ScrubbableNumber } from '@/ui/components/ScrubbableNumber';
import type { AnyProperty, EffectInstance, Id, RGBA } from '@/core/types';

/**
 * Effect Controls: the effects applied to the selected layer, with their
 * parameters, plus the layer's transform underneath for reference.
 */
export function EffectControlsPanel() {
  const project = useEditor((s) => s.project);
  const time = useEditor((s) => s.time);
  const selected = useEditor((s) => s.selectedLayerIds);
  const [adding, setAdding] = useState('');

  const comp = activeComposition(project);
  const layer = comp && selected.length === 1 ? findLayer(comp, selected[0]) : undefined;

  const definitions = allEffectDefinitions();
  const byCategory = new Map<string, typeof definitions>();
  for (const definition of definitions) {
    const list = byCategory.get(definition.category) ?? [];
    list.push(definition);
    byCategory.set(definition.category, list);
  }

  return (
    <div className="panel">
      <header>
        <span>Effect Controls{layer ? `: ${layer.name}` : ''}</span>
        <span className="spacer" />
        <button
          className="icon"
          title="Browse all effects (Ctrl+5)"
          onClick={() => useEditor.getState().openDialog('effects')}
        >
          Browse…
        </button>
      </header>
      <div className="body">
        {!layer && <div className="empty-note">Select a single layer.</div>}
        {layer && (
          <>
            <div style={{ padding: '6px 8px' }}>
              <select
                value={adding}
                style={{ width: '100%' }}
                onChange={(e) => {
                  if (!e.target.value) return;
                  useEditor.getState().addEffect(layer.id, e.target.value);
                  setAdding('');
                }}
              >
                <option value="">Add effect ▾</option>
                {[...byCategory.entries()].map(([category, list]) => (
                  <optgroup key={category} label={category}>
                    {list.map((definition) => (
                      <option key={definition.matchName} value={definition.matchName}>
                        {definition.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {layer.effects.length === 0 && (
              <div className="empty-note">No effects on this layer yet.</div>
            )}

            {layer.effects.map((effect, index) => (
              <EffectBlock
                key={effect.id}
                layerId={layer.id}
                effect={effect}
                index={index}
                time={time}
                isLast={index === layer.effects.length - 1}
              />
            ))}

            <div className="fx-heading">Transform</div>
            {transformProperties(layer).map(({ path, property }) => (
              <ParamRow
                key={path}
                layerId={layer.id}
                path={path}
                property={property}
                time={time}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function EffectBlock({ layerId, effect, index, time, isLast }: {
  layerId: Id; effect: EffectInstance; index: number; time: number; isLast: boolean;
}) {
  const definition = getEffectDefinition(effect.matchName);
  const store = useEditor.getState();

  return (
    <div className="fx-block">
      <div className="fx-header">
        <button
          className={`icon ${effect.enabled ? 'active' : ''}`}
          title={effect.enabled ? 'Disable effect' : 'Enable effect'}
          onClick={() => store.toggleEffect(layerId, index)}
        >
          {effect.enabled ? 'fx' : '—'}
        </button>
        <span className="fx-name">{effect.name}</span>
        <span className="spacer" style={{ flex: 1 }} />
        <button
          className="icon"
          title="Move up"
          disabled={index === 0}
          onClick={() => store.moveEffect(layerId, index, -1)}
        >
          ▲
        </button>
        <button
          className="icon"
          title="Move down"
          disabled={isLast}
          onClick={() => store.moveEffect(layerId, index, 1)}
        >
          ▼
        </button>
        <button
          className="icon"
          title="Remove effect"
          onClick={() => store.removeEffect(layerId, index)}
        >
          ✕
        </button>
      </div>
      {definition?.params.map((param) => (
        <ParamRow
          key={param.key}
          layerId={layerId}
          path={`effects.${index}.params.${param.key}`}
          property={effect.params[param.key]}
          time={time}
          param={param}
        />
      ))}
    </div>
  );
}

function ParamRow({ layerId, path, property, time, param }: {
  layerId: Id; path: string; property: AnyProperty | undefined; time: number;
  param?: EffectParamDef;
}) {
  const project = useEditor((s) => s.project);
  const comp = activeComposition(project);
  const layer = comp && findLayer(comp, layerId);
  const live = layer ? getProperty(layer, path) : undefined;
  const target = live ?? property;
  if (!target) return null;

  const value = valueAtTime(target, time);
  const store = useEditor.getState();

  const write = (next: unknown, coalesce: boolean) => {
    store.setPropertyValue(
      layerId, path, next as never,
      coalesce ? `fx:${layerId}:${path}` : undefined,
    );
  };

  const stopwatch = (
    <button
      className={`stopwatch ${target.animated ? 'on' : ''}`}
      title="Toggle animation (stopwatch)"
      onClick={() => store.toggleStopwatch(layerId, path)}
    >
      {target.animated ? '⏱' : '○'}
    </button>
  );

  if (param?.kind === 'select') {
    return (
      <div className="prop-row" style={{ paddingLeft: 8 }}>
        {stopwatch}
        <span className="prop-name">{target.name}</span>
        <div className="prop-value">
          <select
            value={String(Math.round(value as number))}
            onChange={(e) => write(Number(e.target.value), false)}
          >
            {(param.options ?? []).map((label, i) => (
              <option key={label} value={i}>{label}</option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  if (param?.kind === 'checkbox') {
    return (
      <div className="prop-row" style={{ paddingLeft: 8 }}>
        {stopwatch}
        <span className="prop-name">{target.name}</span>
        <div className="prop-value">
          <input
            type="checkbox"
            checked={(value as number) >= 0.5}
            onChange={(e) => write(e.target.checked ? 1 : 0, false)}
          />
        </div>
      </div>
    );
  }

  if (target.kind === 'color') {
    const color = value as RGBA;
    return (
      <div className="prop-row" style={{ paddingLeft: 8 }}>
        {stopwatch}
        <span className="prop-name">{target.name}</span>
        <div className="prop-value">
          <input
            type="color"
            value={rgbToHex(color[0], color[1], color[2])}
            onChange={(e) => write(hexToRgba(e.target.value, color[3]), false)}
          />
        </div>
      </div>
    );
  }

  if (target.kind === 'path') {
    return (
      <div className="prop-row" style={{ paddingLeft: 8 }}>
        {stopwatch}
        <span className="prop-name">{target.name}</span>
        <div className="prop-value"><span className="shape-value">Shape</span></div>
      </div>
    );
  }

  const components = Array.isArray(value) ? value : [value as number];
  return (
    <div className="prop-row" style={{ paddingLeft: 8 }}>
      {stopwatch}
      <span className="prop-name">{target.name}</span>
      <div className="prop-value">
        {components.map((component, i) => (
          <ScrubbableNumber
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            value={component}
            unit={target.unit ?? ''}
            min={target.min}
            max={target.max}
            speed={target.speedPerPixel ?? 1}
            title={target.dimensionNames?.[i]}
            onChange={(next, phase) => {
              const current = valueAtTime(target, time);
              const out = Array.isArray(current) ? [...current] : [current as number];
              out[i] = next;
              write(Array.isArray(current) ? out : out[0], phase === 'drag');
            }}
          />
        ))}
      </div>
    </div>
  );
}
