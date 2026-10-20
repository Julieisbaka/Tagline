import { useI18n } from '../lib/i18n.js';
import Icon from './Icon.jsx';

export default function Ribbon({ ctx, showLeft }) {
  const { t } = useI18n();
  const btn = (icon, title, fn, active = false) => (
    <button className={`icon-btn${active ? ' active' : ''}`} title={t(title)} onClick={fn}>
      <Icon name={icon} size={18} />
    </button>
  );
  return (
    <nav className="ribbon">
      {btn('sidebar', 'Toggle file explorer', ctx.toggleLeft, showLeft)}
      {btn('file', 'Quick switcher (Ctrl+O)', ctx.openSwitcher)}
      {btn('search', 'Search (Ctrl+Shift+F)', ctx.openSearch)}
      {btn('graph', 'Graph view (Ctrl+G)', ctx.openGraph)}
      {btn('command', 'Command palette (Ctrl+P)', ctx.openCommands)}
      {btn('folder', 'Import document with Pandoc', ctx.importDocument)}
      <div className="spacer" />
      {btn('timer', 'Toggle right sidebar (timer, backlinks, outline)', ctx.toggleRight)}
      {btn('settings', 'Settings (Ctrl+,)', ctx.openSettings)}
    </nav>
  );
}
