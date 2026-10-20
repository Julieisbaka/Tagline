import { useState } from 'react';
import { useI18n } from '../lib/i18n.js';

export default function AdvancedSettings({ settings, update, migrationCount = 0, onMigrate }) {
  const { t } = useI18n();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const number = (label, key, max) => <label className="setting-row">
    <span>{t(label)}</span>
    <input type="number" min={key === 'searchMaxResults' ? 1 : 0} max={max} step="1" value={settings[key]}
      data-setting={key} onChange={(e) => {
        if (e.target.validity.valid && e.target.value !== '') update({ [key]: Number(e.target.value) });
      }} />
  </label>;
  const run = async (action) => {
    setError(''); setBusy(true);
    try { await action(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <section className="advanced-settings">
    <h4>{t('Performance and search')}</h4>
    {number('Visual cache maximum entries (0 disables)', 'visualCacheEntries', 256)}
    {number('Visual cache maximum characters', 'visualCacheCharacters', 100_000_000)}
    {number('Maximum search results', 'searchMaxResults', 1000)}
    <h4>{t('Fonts and folder paths')}</h4>
    <label className="setting-row"><span>{t('Installed font family')}</span>
      <input value={settings.fontFamily} onChange={(e) => update({ fontFamily: e.target.value, importedFont: false })}
        placeholder="Georgia" />
    </label>
    <div className="integration-buttons">
      <button disabled={busy} onClick={() => run(async () => {
        const font = await window.api.importFont();
        if (!font) return;
        const face = new FontFace('Tagline Font Validation', `url("${font.data}")`);
        await face.load();
        await window.api.activateFont();
        update({ importedFont: Date.now() });
      })}>{t('Import font file')}</button>
      <button onClick={() => update({ fontFamily: '', importedFont: false })}>{t('Reset font')}</button>
    </div>
    <p>{t('Custom fonts apply to note text. Import only fonts you trust and are licensed to use.')}</p>
    <label className="setting-row"><span>{t('Use underscores for spaces in folder paths')}</span>
      <input type="checkbox" data-setting="underscoreFolders" checked={settings.underscoreFolders}
        onChange={(e) => update({ underscoreFolders: e.target.checked })} />
    </label>
    {settings.underscoreFolders && migrationCount > 0 && <div role="status">
      <p>{t('{count} existing folders contain spaces. They will not change until you migrate them. Back up your vault first.',
        { count: migrationCount })}</p>
      <button disabled={busy} onClick={() => {
        if (window.confirm(t('Rename folders and update wikilinks? Back up your vault before continuing.'))) run(onMigrate);
      }}>{t('Auto migrate folders')}</button>
    </div>}
    {error && <p role="alert" className="error-text">{error}</p>}
  </section>;
}
