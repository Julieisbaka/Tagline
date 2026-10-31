import { json } from '@codemirror/lang-json';
import { EditorView } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { useEffect, useMemo, useState } from 'react';
import { getRuntimeLimits } from '../../../electron/customization.mjs';
import { settingsCodeMirrorTheme } from '../../lib/editorExtensions.js';
import { LANGUAGES, useI18n } from '../../lib/i18n.js';
import { BUILTIN_THEMES, COLOR_TOKENS, extensionThemes, getTheme, resolveThemeSettings, validateTheme } from '../../lib/themes.js';
import SettingControl from './SettingControl.jsx';
import SettingRow from './SettingRow.jsx';

function ThemeOptions({ theme, settings, update }) {
  const { t } = useI18n();
  const saved = settings.themeSettings?.[theme.id] || {};
  const [values, setValues] = useState(() => Object.fromEntries(theme.settings.map((setting) =>
    [setting.id, saved[setting.id] ?? setting.default])));
  const [error, setError] = useState('');
  const save = (reset = false) => {
    try {
      const next = reset ? {} : Object.fromEntries(theme.settings.map((setting) => {
        const value = values[setting.id];
        if (setting.type === 'number' && String(value).trim() === '') throw new Error(t('Number settings cannot be empty.'));
        return [setting.id, setting.type === 'number' ? Number(value) : value];
      }));
      resolveThemeSettings(theme, next);
      update({ themeSettings: { ...settings.themeSettings, [theme.id]: next } });
      if (reset) setValues(Object.fromEntries(theme.settings.map((setting) => [setting.id, setting.default])));
      setError('');
    } catch (err) { setError(err.message); }
  };
  return <fieldset className="theme-options">
    <legend>{t('Theme settings')}</legend>
    {theme.settings.map((setting) => <SettingControl key={setting.id} setting={setting}
      data-theme-setting={setting.id} value={values[setting.id]}
      onChange={(value) => setValues({ ...values, [setting.id]: value })} />)}
    {error && <p className="error-text" role="alert">{error}</p>}
    <div className="settings-actions">
      <button onClick={() => save()}>{t('Apply theme settings')}</button>
      <button onClick={() => save(true)}>{t('Reset theme settings')}</button>
    </div>
  </fieldset>;
}

export default function ThemeSettings({ settings, update }) {
  const { t } = useI18n();
  const [error, setError] = useState('');
  const [contributed, setContributed] = useState(extensionThemes);
  const [draft, setDraft] = useState(null);
  const [variables, setVariables] = useState('{}');
  const active = useMemo(() => {
    try { return { theme: getTheme(settings.theme, settings.customTheme) }; }
    catch (err) { return { error: err.message }; }
  }, [settings.theme, settings.customTheme, contributed]);
  const variablesLabel = t('CSS variables (JSON object)');
  const variablesExtensions = useMemo(() => [
    json(),
    settingsCodeMirrorTheme,
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({
      'aria-label': variablesLabel,
      'aria-multiline': 'true',
      spellcheck: 'false',
    }),
  ], [variablesLabel]);
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
      update({ customTheme: theme, theme: 'custom', themeSettings: { ...settings.themeSettings, custom: {} } });
      setError('');
    } catch (err) { setError(err.message); }
  };
  const exportTheme = async () => {
    try {
      await window.api.saveTheme({ ...getTheme(settings.theme, settings.customTheme, settings.themeSettings), settings: [] });
      setError('');
    } catch (err) { setError(err.message); }
  };
  const customize = () => {
    try {
      const theme = getTheme(settings.theme, settings.customTheme, settings.themeSettings);
      setDraft({ ...theme, settings: [], name: `${theme.name} Custom`.slice(0, 80), colors: { ...theme.colors } });
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
      update({ customTheme: theme, theme: 'custom', themeSettings: { ...settings.themeSettings, custom: {} } });
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
      {active.theme?.metadata && <div className="theme-metadata">
        {active.theme.metadata.description && <p>{active.theme.metadata.description}</p>}
        {active.theme.metadata.author && <p>{t('by {author}', { author: active.theme.metadata.author })}</p>}
        {!!Object.keys(active.theme.metadata.accessibility || {}).length && <>
          <strong>{t('Accessibility information (author provided)')}</strong>
          <dl>
            {Object.entries(active.theme.metadata.accessibility).map(([key, value]) =>
              <div key={key}><dt>{t({ contrast: 'Contrast', colorVision: 'Color vision', reducedMotion: 'Reduced motion', notes: 'Notes' }[key])}</dt>
                <dd>{Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? t(value ? 'Yes' : 'No') : t(value)}</dd></div>)}
          </dl>
        </>}
      </div>}
      {!!active.theme?.settings?.length && <ThemeOptions key={`${settings.theme}:${JSON.stringify(active.theme.settings)}`}
        theme={active.theme} settings={settings} update={update} />}
      {active.error && <p role="alert" className="error-text">{active.error}</p>}
      <SettingRow label={t('Fade between themes')} description={t('Blend colors briefly when switching themes. Reduced motion disables this effect.')}>
        <input type="checkbox" data-setting="themeTransition" checked={settings.themeTransition}
          onChange={(event) => update({ themeTransition: event.target.checked })} />
      </SettingRow>
      <label className="setting-row"><span>{t('Use native UI controls')}</span>
        <input type="checkbox" data-setting="nativeUi" checked={settings.nativeUi}
          onChange={(event) => update({ nativeUi: event.target.checked })} />
      </label>
      <p>{t('Use system date pickers, context menus, confirmations and standard form controls where available. Native controls follow the app light/dark mode and OS high-contrast settings where supported. Complex application dialogs remain in-app. May conflict with custom themes.')}</p>
      <label className="setting-row"><span>{t('Import JSON theme')}</span>
        <input className="theme-file-input" type="file" accept=".json,application/json"
          aria-label={t('Import JSON theme')} onChange={importTheme} />
      </label>
      <div className="settings-actions theme-actions">
        <button onClick={exportTheme}>{t('Export current theme')}</button>
        <button onClick={customize}>{t('Customize current theme')}</button>
      </div>
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
        <div className="custom-css-editor theme-variables-editor">
          <span>{variablesLabel}</span>
          <CodeMirror value={variables} onChange={setVariables} extensions={variablesExtensions}
            theme="none" minHeight="180px" maxHeight="420px"
            basicSetup={{
              foldGutter: true, highlightActiveLine: true, autocompletion: true, searchKeymap: true,
              highlightSelectionMatches: settings.sourceSelectionMatches
            }} />
        </div>
        <p>{t('Edit any color token and safe CSS variables, including fonts, sizes, and spacing. URLs, declarations, and imports are not allowed.')}</p>
        <div className="settings-actions">
          <button onClick={apply}>{t('Apply custom theme')}</button>
          <button onClick={() => setDraft(null)}>{t('Discard theme edits')}</button>
        </div>
      </fieldset>}
      {error && <p className="error-text" role="alert">{error}</p>}
    </section>
  );
}
