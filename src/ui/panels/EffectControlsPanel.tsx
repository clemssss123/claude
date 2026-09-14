import { findLayer } from '@/core/composition';
import { transformProperties } from '@/core/layer';
import { activeComposition } from '@/core/project';
import { valueAtTime } from '@/core/property';
import { useEditor } from '@/state/store';
import { ScrubbableNumber } from '@/ui/components/ScrubbableNumber';

/**
 * Effect Controls. Until the effect engine lands in phase 4 this panel shows
 * the selected layer's transform group, which is what it docks alongside.
 */
export function EffectControlsPanel() {
  const project = useEditor((s) => s.project);
  const time = useEditor((s) => s.time);
  const selected = useEditor((s) => s.selectedLayerIds);

  const comp = activeComposition(project);
  const layer = comp && selected.length === 1 ? findLayer(comp, selected[0]) : undefined;

  return (
    <div className="panel">
      <header>Effect Controls{layer ? `: ${layer.name}` : ''}</header>
      <div className="body">
        {!layer && <div className="empty-note">Select a single layer.</div>}
        {layer && (
          <>
            {transformProperties(layer).map(({ path, property }) => {
              const value = valueAtTime(property, time);
              const components = Array.isArray(value) ? value : [value as number];
              return (
                <div className="prop-row" key={path} style={{ paddingLeft: 8 }}>
                  <span className="prop-name">{property.name}</span>
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
                        onChange={(next, phase) => {
                          const current = valueAtTime(property, time);
                          const out = Array.isArray(current) ? [...current] : [current as number];
                          out[i] = next;
                          useEditor.getState().setPropertyValue(
                            layer.id,
                            path,
                            (Array.isArray(current) ? out : out[0]) as never,
                            phase === 'drag' ? `fx:${layer.id}:${path}` : undefined,
                          );
                        }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
            <div className="empty-note">
              Effects arrive in phase 4 — this panel will list them here.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
