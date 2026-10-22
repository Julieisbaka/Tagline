import { useEffect, useState } from 'react';
import { LANGUAGES, useI18n } from '../lib/i18n.js';
import { BUILTIN_THEMES, COLOR_TOKENS, extensionThemes, getTheme, validateTheme } from '../lib/themes.js';
import { getRuntimeLimits } from '../../electron/customization.mjs';

export default function ThemeSettings({ settings, update }) {
  const { t } = useI18n();
  const [error, setError] = useState('');
  const [contributed, setContributed] = useState(extensionThemes);
  const [draft, setDraft] = useState(null);
  const [variables, setVariables] = useState('{}');
  useEffect(() => {
    const refresh = () => setContributed(extensionThemes());
    window.addEventListener('extensionthemes', refresh);
    return () => window.removeEventListener('extensionthemes', refresh);
  }, []);
  const importTheme = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      if (file.size > getRuntimeLimits().themeFileBytes) throw new Error(t('Theme file exceeds the configured size limit.'));
      const theme = validateTheme(JSON.parse(await file.text()));
      update({ customTheme: theme, theme: 'custom' });
      setError('');
    } catch (err) { setError(err.message); }
  };
  const exportTheme = async () => {
    try {
      await window.api.saveTheme(getTheme(settings.theme, settings.customTheme));
      setError('');
    } catch (err) { setError(err.message); }
  };
  const customize = () => {
    try {
      const theme = getTheme(settings.theme, settings.customTheme);
      setDraft({ ...theme, name: `${theme.name} Custom`.slice(0, 80), colors: { ...theme.colors } });
      setVariables(JSON.stringify(theme.variables || {}, null, 2));
      setError('');
    } catch (err) { setError(err.message); }
  };
  const apply = () => {
    try {
      const theme = validateTheme({ ...draft, variables: JSON.parse(variables) });
      if (new TextEncoder().encode(JSON.stringify(theme)).length > getRuntimeLimits().themeFileBytes) {
        throw new Error(t('Theme file exceeds the configured size limit.'));
      }
      update({ customTheme: theme, theme: 'custom' });
      setDraft(null); setError('');
    } catch (err) { setError(err.message); }
  };
  return (
    <section>
      <label className="setting-row"><span>{t('Language')}</span>
        <select data-setting="language" aria-label={t('Language')} value={settings.language}
          onChange={(e) => update({ language: e.target.value })}>
          {Object.entries(LANGUAGES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </label>
      <label className="setting-row"><span>{t('Theme')}</span>
        <select data-setting="theme" aria-label={t('Theme')} value={settings.theme} onChange={(e) => update({ theme: e.target.value })}>
          {BUILTIN_THEMES.map((theme) => <option key={theme.id} value={theme.id}>{t(theme.name)}</option>)}
          {contributed.map((theme) => <option key={theme.id} value={theme.id}>{`${theme.name} (${theme.extension})`}</option>)}
          {settings.theme.startsWith('ext:') && !contributed.some((theme) => theme.id === settings.theme) &&
            <option value={settings.theme}>{t('Unavailable extension theme')}</option>}
          {settings.customTheme && <option value="custom">{settings.customTheme.name}</option>}
        </select>
      </label>
      <label className="setting-row"><span>{t('Import JSON theme')}</span>
        <input className="theme-file-input" type="file" accept=".json,application/json"
          aria-label={t('Import JSON theme')} onChange={importTheme} />
      </label>
      <button onClick={exportTheme}>{t('Export current theme')}</button>
      <button onClick={customize}>{t('Customize current theme')}</button>
      {draft && <fieldset className="theme-editor">
        <legend>{t('Custom theme editor')}</legend>
        <label className="setting-row"><span>{t('Theme name')}</span>
          <input aria-label={t('Theme name')} value={draft.name} maxLength={80}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>
        <label className="setting-row"><span>{t('Theme mode')}</span>
          <select aria-label={t('Theme mode')} value={draft.mode}
            onChange={(event) => setDraft({ ...draft, mode: event.target.value })}>
            <option value="dark">{t('Dark')}</option><option value="light">{t('Light')}</option>
          </select>
        </label>
        {COLOR_TOKENS.map((token) => <label className="setting-row" key={token}>
          <span>{token}</span>
          <input aria-label={t('Color {token}', { token })} data-theme-color={token}
            value={draft.colors[token]} onChange={(event) => setDraft({
              ...draft, colors: { ...draft.colors, [token]: event.target.value },
            })} />
        </label>)}
        <label><span>{t('CSS variables (JSON object)')}</span>
          <textarea aria-label={t('CSS variables (JSON object)')} rows={8}
            value={variables} onChange={(event) => setVariables(event.target.value)} />
        </label>
        <p>{t('Edit any color token and safe CSS variables, including fonts, sizes, and spacing. URLs, declarations, and imports are not allowed.')}</p>
        <button onClick={apply}>{t('Apply custom theme')}</button>
        <button onClick={() => setDraft(null)}>{t('Discard theme edits')}</button>
      </fieldset>}
      {error && <p className="error-text" role="alert">{error}</p>}
    </section>
  );
}
