import { useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n.js';
import { displayName, isCanvas, isFlow } from '../../lib/vault.js';
import ContextMenu from '../dialogs/ContextMenu.jsx';
import Icon from '../Icon.jsx';

export default function TabBar({ tabs, activeId, onActivate, onClose, onCloseOthers, onReorder, saveStatuses = {},
  onFileAction, hideFlowExtension = true, showMarkdownExtension = false }) {
  const { t: tr } = useI18n();
  const [menu, setMenu] = useState(null);
  const draggedId = useRef(null);
  const [dropIndex, setDropIndex] = useState(null);
  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((t) => (
        <div
          key={t.id}
          className={`tab${t.id === activeId ? ' active' : ''}${dropIndex === tabs.indexOf(t) ? ' drop-target' : ''}`}
          role="tab"
          aria-selected={t.id === activeId}
          tabIndex={0}
          draggable="true"
          onDragStart={(event) => {
            draggedId.current = t.id;
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', t.id);
            event.currentTarget.classList.add('dragging');
          }}
          onDragOver={(event) => {
            if (!draggedId.current || draggedId.current === t.id) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            const rect = event.currentTarget.getBoundingClientRect();
            setDropIndex(tabs.indexOf(t) + (event.clientX > rect.left + rect.width / 2 ? 1 : 0));
          }}
          onDrop={(event) => {
            event.preventDefault();
            const id = draggedId.current || event.dataTransfer.getData('text/plain');
            if (id && id !== t.id) {
              const sourceIndex = tabs.findIndex((tab) => tab.id === id);
              const rect = event.currentTarget.getBoundingClientRect();
              const destination = tabs.indexOf(t) + (event.clientX > rect.left + rect.width / 2 ? 1 : 0);
              onReorder(id, destination > sourceIndex ? destination - 1 : destination);
            }
            draggedId.current = null;
            setDropIndex(null);
          }}
          onDragEnd={(event) => {
            event.currentTarget.classList.remove('dragging');
            draggedId.current = null;
            setDropIndex(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(t.id); }
            if (e.altKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
              e.preventDefault();
              const index = tabs.findIndex((tab) => tab.id === t.id);
              const destination = index + (e.key === 'ArrowLeft' ? -1 : 1);
              if (destination >= 0 && destination < tabs.length) onReorder(t.id, destination);
            }
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
          <Icon name={t.kind === 'graph' ? 'graph' : isFlow(t.path) ? 'flow' : isCanvas(t.path) ? 'canvas' : 'file'} size={12} />
          <span className="tab-label">{t.kind === 'graph' ? tr('Graph view') : displayName(t.path, hideFlowExtension, showMarkdownExtension)}</span>
          {t.kind === 'file' && saveStatuses[t.path] && <span
            className={`tab-save-status ${saveStatuses[t.path]}`}
            title={tr({ unsaved: 'Unsaved changes', saving: 'Saving changes', error: 'Could not save changes' }[saveStatuses[t.path]])}
            aria-label={tr({ unsaved: 'Unsaved changes', saving: 'Saving changes', error: 'Could not save changes' }[saveStatuses[t.path]])}
            role="img" />}
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
