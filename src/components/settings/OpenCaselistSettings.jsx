import { useEffect, useState } from 'react';
import { useI18n } from '../../lib/i18n.js';

const api = window.api.openCaselist;

export default function OpenCaselistSettings() {
  const { t } = useI18n();
  const [status, setStatus] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    api.writePasswordStatus().then((value) => {
      if (active) { setStatus(value); setEnabled(value.enabled); }
    }).catch((error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, []);
  const save = async (event) => {
    event.preventDefault();
    setError(''); setMessage('');
    if (password !== confirmation) { setError(t('Passwords do not match.')); return; }
    setBusy(true);
    const previous = currentPassword, next = password || undefined;
    setCurrentPassword(''); setPassword(''); setConfirmation('');
    try {
      const value = await api.configureWritePassword(enabled, next, previous);
      setStatus(value); setEnabled(value.enabled);
      setMessage(t('OpenCaselist write protection updated.'));
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  };
  return <form className="opencaselist-password-settings" onSubmit={save}>
    <fieldset disabled={busy || !status}>
      <legend>{t('Write protection')}</legend>
      <label className="setting-row"><span>{t('Require password for OpenCaselist write operations')}</span>
        <input type="checkbox" data-setting="opencaselistRequirePasswordForWrites" checked={enabled}
          onChange={(event) => { setEnabled(event.target.checked); setMessage(''); }} />
      </label>
      {status?.enabled && !status.passwordSet && <p role="alert">
        {t('Write operations are blocked until you set a password.')}</p>}
      {status?.passwordSet && <label className="setting-row"><span>{t('Current write password')}</span>
        <input type="password" autoComplete="current-password" maxLength={1024} required value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)} />
      </label>}
      <label className="setting-row"><span>{t('New write password')}</span>
        <input type="password" autoComplete="new-password" maxLength={1024} required={enabled && !status?.passwordSet}
          value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      <label className="setting-row"><span>{t('Confirm new write password')}</span>
        <input type="password" autoComplete="new-password" maxLength={1024} required={!!password}
          value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
      </label>
      <button type="submit">{t('Save write protection')}</button>
    </fieldset>
    <p>{t('This local password is separate from your OpenCaselist login. Reads and your sign-in session are unchanged. Write access locks after 30 minutes without writes or when Tagline restarts. The current password is required to change or disable protection.')}</p>
    <p>{t('This prevents accidental changes on shared devices, not deliberate access by someone who can edit local app data. There is no password recovery.')}</p>
    {error && <p className="error-text" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </form>;
}
