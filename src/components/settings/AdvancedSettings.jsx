import { useState } from 'react';
import { useI18n } from '../../lib/i18n.js';

export default function AdvancedSettings({ settings, update, section = 'all' }) {
  const { t } = useI18n();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const number = (label, key, max) => <label className="setting-row">
    <span>{t(label)}</span>
    <input type="number" min={['searchMaxResults', 'historyRetention'].includes(key) ? 1 : 0} max={max} step="1" value={settings[key]}
      data-setting={key} onChange={(e) => {
        if (e.target.validity.valid && e.target.value !== '') update({ [key]: Number(e.target.value) });
      }} />
  </label>;
  const run = async (action) => {
    setError(''); setBusy(true);
    try { await action(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <section className="advanced-settings">
    {(section === 'all' || section === 'performance') && <>
    <h4>{t('Performance and search')}</h4>
    {number('Visual cache maximum entries (0 disables)', 'visualCacheEntries', 256)}
    {number('Visual cache maximum characters', 'visualCacheCharacters', 100_000_000)}
    {number('Maximum search results', 'searchMaxResults', 1000)}
    </>}
    {(section === 'all' || section === 'fonts') && <>
    <h4>{t('Custom fonts')}</h4>
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
    </>}
    {(section === 'all' || section === 'files') && <>
    <h4>{t('Folder paths')}</h4>
    <label className="setting-row"><span>{t('Use underscores for spaces in folder paths')}</span>
      <input type="checkbox" data-setting="underscoreFolders" checked={settings.underscoreFolders}
        onChange={(e) => update({ underscoreFolders: e.target.checked })} />
    </label>
    <h4>{t('File names')}</h4>
    <label className="setting-row"><span>{t('Hide .flow file extension')}</span>
      <input type="checkbox" data-setting="hideFlowExtension" checked={settings.hideFlowExtension}
        onChange={(e) => update({ hideFlowExtension: e.target.checked })} />
    </label>
    <label className="setting-row"><span>{t('Show .md file extension')}</span>
      <input type="checkbox" data-setting="showMarkdownExtension" checked={settings.showMarkdownExtension}
        onChange={(e) => update({ showMarkdownExtension: e.target.checked })} />
    </label>
    <h4>{t('Links and workspace')}</h4>
    <label className="setting-row"><span>{t('Automatically update wiki links when renaming')}</span>
      <input type="checkbox" data-setting="autoRelink" checked={settings.autoRelink}
        onChange={(e) => update({ autoRelink: e.target.checked })} />
    </label>
    <label className="setting-row"><span>{t('Close tabs when files disappear externally')}</span>
      <input type="checkbox" data-setting="closeMissingTabs" checked={settings.closeMissingTabs}
        onChange={(e) => update({ closeMissingTabs: e.target.checked })} />
    </label>
    <p>{t('Deleting files inside Tagline always closes their tabs. Kept missing-file tabs show a notice until the file returns.')}</p>
    <label className="setting-row"><span>{t('Persist workspace tabs')}</span>
      <input type="checkbox" data-setting="persistWorkspaceTabs" checked={settings.persistWorkspaceTabs}
        onChange={(e) => update({ persistWorkspaceTabs: e.target.checked })} />
    </label>
    <p>{t('When disabled, current tabs stay open but are not saved. Saved workspaces remain dormant and are restored when this is enabled again.')}</p>
    <h4>{t('Revision history')}</h4>
    {number('Maximum saved revisions per document', 'historyRetention', 5000)}
    <p>{t('Older revisions are removed after the next document change. History is stored in each vault under .tagline/history.')}</p>
    </>}
    {error && <p role="alert" className="error-text">{error}</p>}
  </section>;
}
