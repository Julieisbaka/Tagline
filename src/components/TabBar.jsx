import { useState } from 'react';
import { useI18n } from '../lib/i18n.js';
import { baseName, isFlow } from '../lib/vault.js';
import ContextMenu from './ContextMenu.jsx';
import Icon from './Icon.jsx';

export default function TabBar({ tabs, activeId, onActivate, onClose, onCloseOthers, onFileAction }) {
  const { t: tr } = useI18n();
  const [menu, setMenu] = useState(null);
  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((t) => (
        <div
          key={t.id}
          className={`tab${t.id === activeId ? ' active' : ''}`}
          role="tab"
          aria-selected={t.id === activeId}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(t.id); }
          }}
          onClick={() => onActivate(t.id)}
          onAuxClick={(e) => e.button === 1 && onClose(t.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({
              x: e.clientX, y: e.clientY, items: [
                { label: 'Close tab', run: () => onClose(t.id) },
                { label: 'Close other tabs', run: () => onCloseOthers(t.id) },
                ...(t.kind === 'file' ? [
                  { label: 'Rename…', run: () => onFileAction('rename', t.path) },
                  { label: 'Reveal in file explorer', run: () => onFileAction('reveal', t.path) },
                ] : []),
              ]
            });
          }}
          title={t.path || tr('Graph view')}
        >
          <Icon name={t.kind === 'graph' ? 'graph' : isFlow(t.path) ? 'flow' : 'file'} size={12} />
          <span className="tab-label">{t.kind === 'graph' ? tr('Graph view') : baseName(t.path)}</span>
          <button
            className="tab-close"
            aria-label={tr('Close tab')}
            onClick={(e) => {
              e.stopPropagation();
              onClose(t.id);
            }}
          >
            <Icon name="x" size={10} />
          </button>
        </div>
      ))}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
