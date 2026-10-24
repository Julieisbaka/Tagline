import { useEffect, useState } from 'react';
import { useI18n } from '../../lib/i18n.js';

import ModalBackdrop from './ModalBackdrop.jsx';

export default function SummaryDialog({ content, title, onClose }) {
  const { t } = useI18n();
  const [status, setStatus] = useState(null);
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let disposed = false;
    const refresh = () => window.api.summaryStatus().then((value) => { if (!disposed) setStatus(value); })
      .catch((e) => { if (!disposed) setError(e.message); });
    refresh();
    const interval = setInterval(refresh, 750);
    return () => { disposed = true; clearInterval(interval); };
  }, []);

  const run = async (action) => {
    setBusy(true);
    setError('');
    try {
      const result = await action();
      if (typeof result === 'string') setSummary(result);
      setStatus(await window.api.summaryStatus());
    } catch (e) {
      setError(e.message);
      window.api.summaryStatus().then(setStatus).catch(() => { });
    } finally {
      setBusy(false);
    }
  };
  const working = busy || status?.busy;

  return <ModalBackdrop onMouseDown={onClose}>
    <div className="modal dialog summary-dialog" role="dialog" aria-modal="true"
      aria-labelledby="summary-title" onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}>
      <h3 id="summary-title">{t('Summarize document')}</h3>
      <p className="hint">{t('Generate a summary of “{title}” with the Long-T5 model. The model runs only when you request it, and document text stays on this computer.', { title })}</p>
      <p>{status ? `${status.model} — ${t(status.ready ? 'loaded' : 'not loaded')}` : t('Checking model...')}</p>
      {!status?.ready && <button disabled={working || !status} onClick={() => run(() => window.api.loadSummaryModel())}>
        {t('Download and load summary model')}</button>}
      <button className="primary" disabled={working || !status?.ready || !content.trim()}
        onClick={() => run(() => window.api.summarizeDocument(content))}>{t('Summarize now')}</button>
      {status?.busy && <p role="status">{t(status.detail || 'Working...')}</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      {summary && <section className="summary-result" aria-live="polite">
        <h4>{t('Summary')}</h4>
        <p>{summary}</p>
      </section>}
      <div className="dialog-buttons"><button onClick={onClose}>{t('Close')}</button></div>
    </div>
  </ModalBackdrop>;
}
