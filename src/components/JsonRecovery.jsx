import { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n.js';
import { useConfirm } from './dialogs/ConfirmProvider.jsx';

export default function JsonRecovery({ path, content, onRestore }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setSaved(null); setError('');
    if (path) window.api.latestWorkingHistory(path).then((revision) => {
      if (active) setSaved(revision);
    }).catch((failure) => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [path, content]);
  return <div className="json-recovery">
    {saved && <button disabled={busy} onClick={async () => {
      if (!await confirm(t('Restore the most recent working save? The current source will be kept in revision history.'))) return;
      setBusy(true); setError('');
      try { await onRestore(saved.content); }
      catch (failure) { setError(failure.message); }
      finally { setBusy(false); }
    }}>{t('Restore most recent working save')}</button>}
    {error && <p className="error-text" role="alert">{error}</p>}
  </div>;
}
