import { useEffect, useState } from 'react';
import { useI18n } from '../../lib/i18n.js';

export default function VaultManagerDialog({ onOpen, onChoose, onSample, onClose }) {
  const { t } = useI18n();
  const [vaults, setVaults] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setVaults(await window.api.listRecentVaults());
      setError('');
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { refresh(); }, []);

  const run = async (action) => {
    setBusy(true);
    setError('');
    try {
      if (await action()) onClose();
      else await refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
    <div className="modal dialog vault-manager-dialog" role="dialog" aria-modal="true"
      aria-labelledby="vault-manager-title" onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === 'Escape' && !busy) { e.preventDefault(); onClose(); } }}>
      <h3 id="vault-manager-title">{t('Manage vaults')}</h3>
      <p>{t('Open a saved vault without browsing for its folder. Remove a vault from this list without deleting its files.')}</p>
      {vaults.length ? <ul className="vault-manager-list">
        {vaults.map((vault) => <li key={vault.root}>
          <div className="vault-manager-details">
            <strong>{vault.name}</strong>
            <span>{vault.root}</span>
            {!vault.exists && <span className="error-text">{t('Folder not found')}</span>}
          </div>
          <div className="vault-manager-actions">
            <button disabled={busy || !vault.exists} onClick={() => run(() => onOpen(vault.root))}>{t('Open')}</button>
            <button disabled={busy || !vault.exists} onClick={() => window.api.revealRecentVault(vault.root)
              .catch((e) => setError(e.message))}>{t('Show in file explorer')}</button>
            <button disabled={busy} onClick={async () => {
              try { await window.api.forgetRecentVault(vault.root); await refresh(); }
              catch (e) { setError(e.message); }
            }}>{t('Remove from list')}</button>
          </div>
        </li>)}
      </ul> : <p>{t('No saved vaults yet.')}</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="dialog-buttons vault-manager-footer">
        {onSample && <button disabled={busy} onClick={() => run(onSample)}>{t('Create sample vault')}</button>}
        <button disabled={busy} onClick={() => run(onChoose)}>{t('Add existing or create vault…')}</button>
        <button onClick={onClose}>{t('Close')}</button>
      </div>
    </div>
  </div>;
}
