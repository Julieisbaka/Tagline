import { useState } from 'react';
import { useI18n } from '../lib/i18n.js';

const PERMISSION_LABELS = {
  editor: 'Read and insert text in the active note',
  'vault:read': 'Read notes in the open vault',
  'vault:write': 'Create and change notes in the open vault',
};

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
        {item.permissions?.length > 0 && <ul className="extension-permissions" aria-label={t('Permissions')}>
          {item.permissions.map((permission) => <li key={permission}>{t(PERMISSION_LABELS[permission] || permission)}</li>)}
        </ul>}
        {item.error && <p role="alert" className="error-text">{item.error}</p>}
      </li>)}
    </ul>
  </>;
}
