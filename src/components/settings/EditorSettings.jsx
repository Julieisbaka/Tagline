import { useI18n } from '../../lib/i18n.js';

export default function EditorSettings({ settings, update }) {
  const { t } = useI18n();
  const checkbox = (label, key) => <label className="setting-row">
    <span>{t(label)}</span>
    <input type="checkbox" data-setting={key} checked={settings[key]}
      onChange={(event) => update({ [key]: event.target.checked })} />
  </label>;
  return <section className="editor-settings">
    {checkbox('Show formatting toolbar', 'visualToolbar')}
    <label className="setting-row">
      <span>{t('Editor line height')}</span>
      <input type="number" data-setting="visualLineHeight" min="1" max="2.5" step="0.05"
        value={settings.visualLineHeight} onChange={(event) => {
          if (event.target.validity.valid && event.target.value !== '') {
            update({ visualLineHeight: Number(event.target.value) });
          }
        }} />
    </label>
    <h3>{t('Source editor (CodeMirror)')}</h3>
    {checkbox('Show line numbers', 'sourceLineNumbers')}
    {checkbox('Wrap long lines', 'sourceLineWrapping')}
    {checkbox('Highlight active line', 'sourceActiveLine')}
    {checkbox('Show autocomplete suggestions', 'sourceAutocomplete')}
  </section>;
}
