import { useI18n } from '../../lib/i18n.js';
import { binding, displayBinding } from '../../lib/keybindings.js';
import Icon from '../Icon.jsx';

export default function Ribbon({ ctx, showLeft, keybindings }) {
  const { t } = useI18n();
  const btn = (icon, title, fn, active = false) => (
    <button className={`icon-btn${active ? ' active' : ''}`} title={t(title)} onClick={fn}>
      <Icon name={icon} size={18} />
    </button>
  );
  const title = (label, id) => {
    const shortcut = displayBinding(binding(id, keybindings));
    return `${t(label)}${shortcut ? ` (${shortcut})` : ''}`;
  };
  return (
    <nav className="ribbon">
      {btn('sidebar', 'Toggle file explorer', ctx.toggleLeft, showLeft)}
      {btn('file', title('Quick switcher', 'switcher'), ctx.openSwitcher)}
      {btn('search', title('Search', 'search'), ctx.openSearch)}
      {btn('graph', title('Graph view', 'graph'), ctx.openGraph)}
      {btn('command', title('Command palette', 'commands'), ctx.openCommands)}
      {btn('folder', 'Import document with Pandoc', ctx.importDocument)}
      <div className="spacer" />
      {btn('timer', 'Toggle right sidebar (timer, backlinks, outline)', ctx.toggleRight)}
      {btn('settings', title('Settings', 'settings'), ctx.openSettings)}
    </nav>
  );
}
