import { useState } from 'react';
import { useI18n } from '../../lib/i18n.js';
import { moveWorkspaceItem, normalizeWorkspaceItems } from '../../lib/workspaceItems.js';
import ContextMenu from '../dialogs/ContextMenu.jsx';

export default function ConfigurableBar({ className, label, catalog, value, onChange, renderItem, children }) {
  const { t } = useI18n();
  const [menu, setMenu] = useState(null);
  const items = normalizeWorkspaceItems(value, catalog);
  const context = (event, id) => {
    event.preventDefault();
    const index = items.indexOf(id);
    setMenu({ x: event.clientX, y: event.clientY, items: [
      ...(index < 0 ? [] : [
        { label: 'Move left', disabled: index === 0, run: () => onChange(moveWorkspaceItem(items, id, items[index - 1])) },
        { label: 'Move right', disabled: index === items.length - 1, run: () => onChange(moveWorkspaceItem(items, id, items[index + 1])) },
        { label: 'Hide item', run: () => onChange(items.filter((item) => item !== id)) },
      ]),
      ...catalog.filter((item) => !items.includes(item.id)).map((item) => ({
        label: t('Show {name}', { name: t(item.title) }), run: () => onChange([...items, item.id]),
      })),
      { label: 'Restore default items', run: () => onChange(catalog.map((item) => item.id)) },
    ] });
  };
  return <div className={className} role="group" aria-label={t(label)} tabIndex={0}
    onContextMenu={(event) => {
      if (!event.target.closest('.context-menu')) context(event, event.target.closest('[data-bar-item]')?.dataset.barItem);
    }}
    onKeyDown={(event) => {
      if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
      const target = event.target.closest('[data-bar-item]') || event.currentTarget;
      const rect = target.getBoundingClientRect();
      context({ preventDefault: () => event.preventDefault(), clientX: rect.left, clientY: rect.top }, target.dataset.barItem);
    }}>
    {items.map((id) => {
      const content = renderItem(id);
      if (!content) return null;
      return <span className="configurable-bar-item" key={id} data-bar-item={id} draggable tabIndex={0}
        title={t('Drag to reorder; right-click to customize')}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData(`application/x-tagline-${className}`, id);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          onChange(moveWorkspaceItem(items, event.dataTransfer.getData(`application/x-tagline-${className}`), id));
        }}>{content}</span>;
    })}
    {children}
    {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
  </div>;
}
