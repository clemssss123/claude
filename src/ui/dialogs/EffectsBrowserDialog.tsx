import { useMemo, useState } from 'react';
import { allEffectDefinitions } from '@/render/effects';
import { useEditor } from '@/state/store';

/**
 * Effects & Presets: search the registry and apply an effect to the selected
 * layers. Double-click applies, as it does in After Effects.
 */
export function EffectsBrowserDialog({ onClose }: { onClose: () => void }) {
  const [filter, setFilter] = useState('');
  const selected = useEditor((s) => s.selectedLayerIds);
  const definitions = allEffectDefinitions();

  const groups = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const matched = definitions.filter((definition) => (
      query === ''
      || definition.name.toLowerCase().includes(query)
      || definition.category.toLowerCase().includes(query)
    ));
    const map = new Map<string, typeof definitions>();
    for (const definition of matched) {
      const list = map.get(definition.category) ?? [];
      list.push(definition);
      map.set(definition.category, list);
    }
    return [...map.entries()];
  }, [filter, definitions]);

  const apply = (matchName: string) => {
    const store = useEditor.getState();
    if (store.selectedLayerIds.length === 0) {
      store.setStatus('Select a layer to apply an effect to.');
      return;
    }
    for (const id of store.selectedLayerIds) store.addEffect(id, matchName);
  };

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal" style={{ width: 620 }} onPointerDown={(e) => e.stopPropagation()}>
        <header>Effects &amp; Presets</header>
        <div className="content">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
            <input
              autoFocus
              placeholder="Search effects…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ flex: 1 }}
            />
            <span style={{ color: 'var(--text-dim)' }}>
              {definitions.length} effects · {selected.length} layer
              {selected.length === 1 ? '' : 's'} selected
            </span>
          </div>

          {groups.map(([category, list]) => (
            <div key={category} style={{ marginBottom: 12 }}>
              <div style={{ color: 'var(--text-bright)', fontWeight: 600, marginBottom: 4 }}>
                {category}
              </div>
              <div className="fx-grid">
                {list.map((definition) => (
                  <button
                    key={definition.matchName}
                    className="fx-chip"
                    title={`Apply ${definition.name}`}
                    onClick={() => apply(definition.matchName)}
                  >
                    {definition.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {groups.length === 0 && <div className="empty-note">No effects match that search.</div>}
        </div>
        <footer><button className="active" onClick={onClose}>Close</button></footer>
      </div>
    </div>
  );
}
