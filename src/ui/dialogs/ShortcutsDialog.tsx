import { useMemo, useState } from 'react';
import { SHORTCUTS, formatChord } from '@/input/shortcuts';
import type { Shortcut } from '@/input/shortcuts';

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const [filter, setFilter] = useState('');

  const groups = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const matched = SHORTCUTS.filter((s) => (
      query === ''
      || s.label.toLowerCase().includes(query)
      || s.keys.some((k) => k.includes(query))
      || s.category.toLowerCase().includes(query)
    ));
    const map = new Map<string, Shortcut[]>();
    for (const shortcut of matched) {
      const list = map.get(shortcut.category) ?? [];
      list.push(shortcut);
      map.set(shortcut.category, list);
    }
    return [...map.entries()];
  }, [filter]);

  const ready = SHORTCUTS.filter((s) => s.status === 'ready').length;

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal" style={{ width: 760 }} onPointerDown={(e) => e.stopPropagation()}>
        <header>Keyboard Shortcuts — After Effects keymap</header>
        <div className="content">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
            <input
              placeholder="Filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ flex: 1 }}
            />
            <span style={{ color: 'var(--text-dim)' }}>
              {ready} of {SHORTCUTS.length} active in this build
            </span>
          </div>
          {groups.map(([category, items]) => (
            <div key={category} style={{ marginBottom: 16 }}>
              <div style={{ color: 'var(--text-bright)', fontWeight: 600, marginBottom: 4 }}>
                {category}
              </div>
              <table className="shortcut-table">
                <tbody>
                  {items.map((shortcut) => (
                    <tr key={shortcut.id} className={shortcut.status === 'planned' ? 'planned' : ''}>
                      <td style={{ width: 220 }}>
                        {shortcut.keys.map((chord) => (
                          <span className="chord" key={chord} style={{ marginRight: 4 }}>
                            {formatChord(chord)}
                          </span>
                        ))}
                      </td>
                      <td>{shortcut.label}</td>
                      <td style={{ width: 90, textAlign: 'right' }}>
                        <span className={`badge ${shortcut.status === 'ready' ? 'ready' : ''}`}>
                          {shortcut.status === 'ready' ? 'active' : `phase ${shortcut.phase ?? '?'}`}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
        <footer><button className="active" onClick={onClose}>Close</button></footer>
      </div>
    </div>
  );
}
