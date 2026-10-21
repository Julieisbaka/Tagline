import { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n.js';

export default function CustomCssSettings({ settings, update }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(settings.customCss);
  const [error, setError] = useState('');
  useEffect(() => setDraft(settings.customCss), [settings.customCss]);
  const warning = 'Custom CSS is unrestricted. It can hide controls, break the layout, and load external resources. Only enable CSS you trust.';
  return <section className="custom-css-settings">
    <h4>{t('Custom CSS')}</h4>
    <p>{t(warning)}</p>
    <label className="setting-row"><span>{t('Enable custom CSS')}</span>
      <input type="checkbox" data-setting="customCssEnabled" checked={settings.customCssEnabled}
        onChange={(event) => {
          const enabled = event.target.checked;
          if (!enabled || window.confirm(t(warning))) update({ customCssEnabled: enabled });
        }} />
    </label>
    <label className="setting-row"><span>{t('Import CSS file')}</span>
      <input type="file" className="theme-file-input" accept=".css,text/css" aria-label={t('Import CSS file')}
        onChange={async (event) => {
          const file = event.target.files[0];
          event.target.value = '';
          if (!file) return;
          try { setDraft(await file.text()); setError(''); }
          catch (err) { setError(err.message); }
        }} />
    </label>
    <label className="custom-css-editor">
      <span>{t('CSS source')}</span>
      <textarea aria-label={t('CSS source')} spellCheck={false} value={draft} onChange={(event) => setDraft(event.target.value)} />
    </label>
    <div className="settings-actions">
      <button disabled={draft === settings.customCss} onClick={() => update({ customCss: draft })}>{t('Apply CSS')}</button>
      <button onClick={() => setDraft(settings.customCss)}>{t('Discard CSS edits')}</button>
      <button onClick={() => { update({ customCss: '', customCssEnabled: false }); setError(''); }}>{t('Reset custom CSS')}</button>
    </div>
    <p>{t('CSS is saved on this device and applied after you choose Apply CSS. To recover hidden controls, use View > Toggle Developer Tools and disable customCssEnabled in tagline-settings, then reload.')}</p>
    {error && <p className="error-text" role="alert">{error}</p>}
  </section>;
}
