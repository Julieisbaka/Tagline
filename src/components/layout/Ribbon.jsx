import { useState } from 'react';
import { useI18n } from '../../lib/i18n.js';
import { binding, displayBinding } from '../../lib/keybindings.js';
import { moveRibbonItem, normalizeRibbonItems, RIBBON_ITEMS } from '../../lib/ribbonItems.js';
import Icon from '../Icon.jsx';
import ContextMenu from '../dialogs/ContextMenu.jsx';

export default function Ribbon({ ctx, showLeft, keybindings, settings, updateSettings, contributions = [] }) {
  const { t } = useI18n();
  const [menu, setMenu] = useState(null);
  const catalog = [...RIBBON_ITEMS, ...contributions];
  const items = normalizeRibbonItems(settings.ribbonItems, contributions, settings.hiddenRibbonItems);
  const availableItems = items.filter((id) => catalog.some((item) => item.id === id));
  const actions = {
    fileExplorer: ctx.toggleLeft,
    switcher: ctx.openSwitcher,
    search: ctx.openSearch,
    graph: ctx.openGraph,
    commands: ctx.openCommands,
    import: ctx.importDocument,
    rightPanel: ctx.toggleRight,
    evidenceCheckup: ctx.evidenceCheckup,
  };
  const title = (label, id) => {
    const shortcut = displayBinding(binding(id, keybindings));
    return `${t(label)}${shortcut ? ` (${shortcut})` : ''}`;
  };
  const moveItem = (sourceId, targetId) => updateSettings({
    ribbonItems: moveRibbonItem(items, sourceId, targetId),
  });
  const context = (event, id) => {
    event.preventDefault();
    const index = availableItems.indexOf(id);
    setMenu({
      x: event.clientX, y: event.clientY, items: [
        { label: 'Move up', disabled: index === 0, run: () => moveItem(id, availableItems[index - 1]) },
        { label: 'Move down', disabled: index === availableItems.length - 1, run: () => moveItem(id, availableItems[index + 1]) },
        {
          label: 'Remove from sidebar', run: () => updateSettings({
            ribbonItems: items.filter((item) => item !== id),
            hiddenRibbonItems: [...new Set([...(settings.hiddenRibbonItems || []), id])],
          })
        },
        { label: 'Settings', run: ctx.openWorkspaceSettings },
      ]
    });
  };
  return (
    <nav className="ribbon" aria-label={t('Sidebar shortcuts')}>
      {items.map((id) => {
        const item = catalog.find(({ id: itemId }) => itemId === id);
        if (!item) return null;
        const label = item.keybinding ? title(item.title, item.keybinding) : t(item.title);
        const active = id === 'fileExplorer' && showLeft;
        return <button key={id} data-ribbon-item={id}
          className={`icon-btn${active ? ' active' : ''}`}
          title={`${label} — ${t('Drag to reorder; configure in Settings')}`}
          aria-label={label} draggable
          onClick={item.run || actions[id]}
          onContextMenu={(event) => context(event, id)}
          onKeyDown={(event) => {
            if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
              const rect = event.currentTarget.getBoundingClientRect();
              context({ preventDefault: () => event.preventDefault(), clientX: rect.right, clientY: rect.top }, id);
            }
          }}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', id);
            event.currentTarget.classList.add('dragging');
          }}
          onDragEnd={(event) => event.currentTarget.classList.remove('dragging')}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            moveItem(event.dataTransfer.getData('text/plain'), id);
          }}>
          <Icon name={item.icon} size={18} />
        </button>;
      })}
      <button className="icon-btn ribbon-settings-button" title={title('Settings', 'settings')}
        aria-label={title('Settings', 'settings')}
        onClick={ctx.openSettings}>
        <Icon name="settings" size={18} />
      </button>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </nav>
  );
}
