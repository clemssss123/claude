import { useEffect } from 'react';

export interface MenuItem {
  label: string;
  onSelect?: () => void;
  divider?: boolean;
  disabled?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
    };
  }, [onClose]);

  return (
    <div
      className="context-menu"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items.map((item, index) => (
        item.divider ? (
          <div className="divider" key={`d${index}`} />
        ) : (
          <button
            key={item.label}
            disabled={item.disabled}
            onClick={() => { item.onSelect?.(); onClose(); }}
          >
            {item.label}
          </button>
        )
      ))}
    </div>
  );
}
