import { useEffect, useState } from 'react';
import { LANGUAGES, useI18n } from '../lib/i18n.js';
import { BUILTIN_THEMES, extensionThemes, getTheme, validateTheme } from '../lib/themes.js';

export default function ThemeSettings({ settings, update }) {
  const { t } = useI18n();
  const [error, setError] = useState('');
  const [contributed, setContributed] = useState(extensionThemes);
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
      if (file.size > 64000) throw new Error(t('Theme files must be smaller than 64 KB.'));
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
      {error && <p className="error-text" role="alert">{error}</p>}
    </section>
  );
}
