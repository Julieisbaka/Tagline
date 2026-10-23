import { useI18n } from '../../lib/i18n.js';
import { binding, displayBinding } from '../../lib/keybindings.js';
import { moveRibbonItem, normalizeRibbonItems, RIBBON_ITEMS } from '../../lib/ribbonItems.js';
import Icon from '../Icon.jsx';

export default function Ribbon({ ctx, showLeft, keybindings, settings, updateSettings }) {
  const { t } = useI18n();
  const items = normalizeRibbonItems(settings.ribbonItems);
  const actions = {
    fileExplorer: ctx.toggleLeft,
    switcher: ctx.openSwitcher,
    search: ctx.openSearch,
    graph: ctx.openGraph,
    commands: ctx.openCommands,
    import: ctx.importDocument,
    rightPanel: ctx.toggleRight,
  };
  const title = (label, id) => {
    const shortcut = displayBinding(binding(id, keybindings));
    return `${t(label)}${shortcut ? ` (${shortcut})` : ''}`;
  };
  const moveItem = (sourceId, targetId) => updateSettings({
    ribbonItems: moveRibbonItem(items, sourceId, targetId),
  });
  return (
    <nav className="ribbon" aria-label={t('Sidebar shortcuts')}>
      {items.map((id) => {
        const item = RIBBON_ITEMS.find(({ id: itemId }) => itemId === id);
        if (!item) return null;
        const label = item.keybinding ? title(item.title, item.keybinding) : t(item.title);
        const active = id === 'fileExplorer' && showLeft;
        return <button key={id} data-ribbon-item={id}
          className={`icon-btn${active ? ' active' : ''}${id === items.at(-1) ? ' ribbon-bottom-item' : ''}`}
          title={`${label} — ${t('Drag to reorder; configure in Settings')}`}
          aria-label={label} draggable
          onClick={actions[id]}
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
    </nav>
  );
}
