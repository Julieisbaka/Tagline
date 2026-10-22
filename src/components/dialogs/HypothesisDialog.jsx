import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n.js';
import { HYPOTHESIS_TEMPLATES, buildHypotheses, entailmentLabel, premiseText } from '../../lib/nli.js';

// Explicit, on-demand stance/topic analysis with the Political DEBATE NLI model.
export default function HypothesisDialog({ sources, onClose }) {
  const { t } = useI18n();
  const scopes = useMemo(() => Object.entries(sources)
    .map(([id, markdown]) => [id, premiseText(markdown || '')]).filter(([, text]) => text), [sources]);
  const [scope, setScope] = useState(scopes[0]?.[0] || 'note');
  const [template, setTemplate] = useState('stance');
  const [lines, setLines] = useState('');
  const [status, setStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef(null);
  const premise = scopes.find(([id]) => id === scope)?.[1] || '';
  const hypotheses = buildHypotheses(template, lines);

  useEffect(() => {
    let disposed = false;
    const refresh = () => window.api.nliStatus().then((s) => { if (!disposed) setStatus(s); })
      .catch((e) => { if (!disposed) setError(e.message); });
    refresh();
    const interval = setInterval(refresh, 750);
    dialog.current?.querySelector('textarea')?.focus();
    return () => { disposed = true; clearInterval(interval); };
  }, []);

  const run = async (action) => {
    setBusy(true);
    setError('');
    try { await action(); }
    catch (e) { setError(e.message); }
    finally {
      setBusy(false);
      window.api.nliStatus().then(setStatus).catch(() => { });
    }
  };
  const working = busy || status?.busy;
  const sourceLabel = status ? status.source.folder || status.source.repo : '';
  const scopeLabels = { selection: 'Selection', card: 'Card under cursor', note: 'Whole note' };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal dialog hypothesis-dialog" role="dialog" aria-modal="true" aria-labelledby="hypothesis-title"
        ref={dialog} onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}>
        <h3 id="hypothesis-title">{t('Test a hypothesis (Political DEBATE)')}</h3>
        <p className="hint">{t('The model reads the text as a premise and estimates whether each hypothesis follows from it. It runs only when you click Analyze, entirely on this computer.')}</p>
        <div className="hypothesis-model">
          <span>{status ? `${sourceLabel} — ${t(status.ready ? 'loaded' : status.downloaded ? 'downloaded, not loaded' : 'not downloaded')}` : t('Checking model...')}</span>
          {status && !status.ready && <button disabled={working} onClick={() => run(() => window.api.loadNliModel())}>
            {t(status.downloaded ? 'Load model' : 'Download and load (about 650 MB)')}</button>}
          {status?.ready && <button disabled={working} onClick={() => run(async () => {
            await window.api.unloadNliModel();
            setResult(null);
          })}>{t('Unload model')}</button>}
        </div>
        {!scopes.length ? <p className="error-text">{t('This note has no text to analyze.')}</p> : <>
          <label className="setting-row">
            <span>{t('Text to analyze')}</span>
            <select value={scope} onChange={(e) => { setScope(e.target.value); setResult(null); }}>
              {scopes.map(([id, text]) => <option key={id} value={id}>
                {t(scopeLabels[id])} ({t('{count} words', { count: text.split(/\s+/).length })})</option>)}
            </select>
          </label>
          <label className="setting-row">
            <span>{t('Hypothesis format')}</span>
            <select value={template} onChange={(e) => setTemplate(e.target.value)}>
              {HYPOTHESIS_TEMPLATES.map((item) => <option key={item.id} value={item.id}>{t(item.label)}</option>)}
            </select>
          </label>
          <label className="hypothesis-input">
            <span>{t(template === 'custom' ? 'Hypotheses (one per line)' : 'Fill in the blank (one per line)')}</span>
            <textarea rows={4} value={lines} spellCheck
              placeholder={t(template === 'custom' ? 'Nuclear deterrence prevents war.' : 'nuclear deterrence prevents war')}
              onChange={(e) => setLines(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) document.getElementById('hypothesis-run')?.click();
              }} />
          </label>
          {template !== 'custom' && hypotheses[0] && <p className="hint">{t('Preview')}: {hypotheses[0]}</p>}
        </>}
        <div className="dialog-buttons">
          <button onClick={onClose}>{t('Close')}</button>
          <button id="hypothesis-run" className="primary"
            disabled={working || !status?.ready || !premise || !hypotheses.length || hypotheses.length > 10}
            onClick={() => run(async () => setResult(await window.api.analyzeHypotheses({ premise, hypotheses })))}>
            {t('Analyze')}</button>
        </div>
        {hypotheses.length > 10 && <p className="error-text">{t('Use at most 10 hypotheses.')}</p>}
        {working && status?.detail && <p role="status">{status.detail}</p>}
        {error && <p className="error-text" role="alert">{error}</p>}
        {result && <div className="hypothesis-results" aria-live="polite">
          {result.truncated && <p className="hint">{t('Only the first {count} passages were analyzed.', { count: result.passages })}</p>}
          {result.results.map((item) => <div key={item.hypothesis} className="hypothesis-result">
            <div className="hypothesis-score">
              <strong>{(item.entailment * 100).toFixed(1)}%</strong>
              <span>{t(entailmentLabel(item.entailment))}</span>
            </div>
            <meter min="0" max="1" low={0.2} high={0.8} optimum={1} value={item.entailment}
              aria-label={t('Entailment probability')} />
            <p>{item.hypothesis}</p>
            {result.passages > 1 && <details>
              <summary>{t('Strongest passage ({index} of {count})', { index: item.passageIndex + 1, count: result.passages })}</summary>
              <blockquote>{item.passage}</blockquote>
            </details>}
          </div>)}
        </div>}
      </div>
    </div>
  );
}
