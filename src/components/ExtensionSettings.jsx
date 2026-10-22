import { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n.js';

const PERMISSION_LABELS = {
  editor: 'Read and insert text in the active note',
  'vault:read': 'Read notes in the open vault',
  'vault:write': 'Create and change notes in the open vault',
  settings: 'Read and change only this extension’s declared settings',
  'editor:active-note': 'Watch active-note paths without reading note content',
};

function ExtensionSettingsForm({ item, extensions }) {
  const { t } = useI18n();
  const [values, setValues] = useState({});
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      setValues(Object.fromEntries(item.contributes.settings.map((setting) =>
        [setting.id, extensions.getSetting(item, setting.id)])));
      setLoaded(true);
      setError('');
    } catch (err) { setError(err.message); setLoaded(false); }
  }, [item, extensions.settingsRevision, extensions.getSetting]);
  const apply = (reset = false) => {
    try {
      if (reset) extensions.resetSettings(item);
      else {
        const next = Object.fromEntries(item.contributes.settings.map((setting) => {
          const value = values[setting.id];
          if (setting.type === 'number' && String(value).trim() === '') {
            throw new Error(t('Number settings cannot be empty.'));
          }
          return [setting.id, setting.type === 'number' ? Number(value) : value];
        }));
        extensions.setSettings(item, next);
      }
      setError('');
    } catch (err) { setError(err.message); }
  };
  return <fieldset className="extension-settings-form">
    <legend>{t('Extension settings')}</legend>
    {loaded && item.contributes.settings.map((setting) => <label key={setting.id} className="setting-row">
      <span>{setting.title}{setting.description && <small>{setting.description}</small>}</span>
      {setting.enum ? <select data-extension-setting={setting.id} value={values[setting.id]}
        onChange={(event) => setValues({ ...values, [setting.id]: event.target.value })}>
        {setting.enum.map((value) => <option key={value} value={value}>{value}</option>)}
      </select> : <input data-extension-setting={setting.id}
        type={setting.type === 'boolean' ? 'checkbox' : setting.type === 'number' ? 'number' : 'text'}
        {...(setting.type === 'boolean' ? { checked: values[setting.id] } : { value: values[setting.id] })}
        min={setting.min} max={setting.max} maxLength={setting.maxLength ?? 1000} step="any"
        onChange={(event) => setValues({ ...values,
          [setting.id]: setting.type === 'boolean' ? event.target.checked : event.target.value })} />}
    </label>)}
    {error && <p role="alert" className="error-text">{error}</p>}
    <div className="settings-actions">
      <button disabled={!loaded} onClick={() => apply()}>{t('Save extension settings')}</button>
      <button onClick={() => apply(true)}>{t('Reset extension settings')}</button>
    </div>
  </fieldset>;
}

export default function ExtensionSettings({ extensions }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const act = async (task) => {
    setBusy(true); setError('');
    try { await task(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return <>
    <h3>{t('Installed extensions')}</h3>
    <p>{t('Extensions run in a sandbox without network, Node.js, or page access, and can only use the permissions listed below. Enable only extensions you trust.')}</p>
    <div className="settings-actions">
      <button onClick={() => act(() => window.api.openExtensionsFolder())}>{t('Open extensions folder')}</button>
      <button disabled={busy} onClick={() => act(extensions.reload)}>{t('Reload extensions')}</button>
    </div>
    {error && <p role="alert" className="error-text">{error}</p>}
    {!extensions.extensions.length && <p className="settings-empty">{t('No extensions installed. Add a folder containing manifest.json to the extensions folder, then reload.')}</p>}
    <ul className="extension-list">
      {extensions.extensions.map((item) => <li key={item.folder || item.id} className="extension-card" data-extension={item.id}>
        <div className="extension-head">
          <div>
            <strong>{item.name || item.folder}</strong>
            {item.version && <span className="extension-version">v{item.version}</span>}
            {item.author && <span className="extension-author">{t('by {author}', { author: item.author })}</span>}
          </div>
          {item.id && <label className="extension-toggle">
            <span>{t('Enabled')}</span>
            <input type="checkbox" checked={!!item.enabled} disabled={busy}
              onChange={(e) => act(() => extensions.setEnabled(item.id, e.target.checked))} />
          </label>}
        </div>
        {item.description && <p>{item.description}</p>}
        {item.reviewRequired && <p role="alert">{t('Review changed permissions and settings before enabling this extension.')}</p>}
        {item.permissions?.length > 0 && <ul className="extension-permissions" aria-label={t('Permissions')}>
          {item.permissions.map((permission) => <li key={permission}>{t(PERMISSION_LABELS[permission] || permission)}</li>)}
        </ul>}
        {item.contributes?.settings?.length > 0 && <ExtensionSettingsForm item={item} extensions={extensions} />}
        {item.error && <p role="alert" className="error-text">{item.error}</p>}
      </li>)}
    </ul>
  </>;
}
