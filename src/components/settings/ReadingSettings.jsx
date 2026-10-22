import { useMemo, useState } from 'react';
import { formatDuration, spokenEvidence } from '../../lib/card.js';
import { useI18n } from '../../lib/i18n.js';
import { calibrateReading, readingAssessment, speechStats, validateReadingSample } from '../../lib/readTime.js';

export default function ReadingSettings({ settings, update }) {
  const { t } = useI18n();
  const [drafts, setDrafts] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const samples = settings.readingSamples || [];
  const result = useMemo(() => {
    try { return { profile: calibrateReading(samples), error: '' }; }
    catch (err) { return { profile: null, error: err.message }; }
  }, [samples]);
  const importSamples = async () => {
    setError(''); setBusy(true);
    try {
      const imported = await window.api.importReadingSamples();
      if (imported.canceled) return;
      if (samples.length + drafts.length + imported.documents.length > 100) throw new Error(t('Use at most 100 timed reading samples.'));
      setDrafts((previous) => [...previous, ...imported.documents.map((document) => ({
        id: crypto.randomUUID(), name: document.name.slice(0, 200), text: document.markdown,
        scope: 'full', seconds: '', warnings: document.warnings,
      }))]);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const save = (draft) => {
    try {
      const text = draft.scope === 'evidence' ? spokenEvidence(draft.text) : draft.text;
      const sample = validateReadingSample({
        id: draft.id, name: draft.name, scope: draft.scope,
        seconds: Number(draft.seconds), version: 1, stats: speechStats(text),
      });
      update({ readingSamples: [...samples, sample] });
      setDrafts((previous) => previous.filter((item) => item.id !== draft.id));
      setError('');
    } catch (err) { setError(err.message); }
  };
  const change = (id, patch) => setDrafts((previous) => previous.map((item) => item.id === id ? { ...item, ...patch } : item));
  return <section className="reading-settings">
    <h4>{t('Personal speech calibration')}</h4>
    <p>{t('The speaking-rate setting is used only without calibration. Default estimates include syllables, number and acronym pronunciation, articulation complexity, and punctuation pauses. Estimates are optimized for English.')}</p>
    <p>{t('Import one or more documents and enter the seconds you actually spent reading each. Choose the full document or only highlighted evidence and spoken citations. Only derived statistics and timing are saved locally.')}</p>
    <button disabled={busy} onClick={importSamples}>{t('Import timed reading documents')}</button>
    {drafts.map((draft) => <fieldset key={draft.id} data-reading-draft={draft.id}>
      <legend>{draft.name}</legend>
      <label className="setting-row"><span>{t('Reading scope')}</span>
        <select aria-label={t('Reading scope')} value={draft.scope} onChange={(event) => change(draft.id, { scope: event.target.value })}>
          <option value="full">{t('Full document')}</option>
          <option value="evidence">{t('Highlighted evidence and spoken citations')}</option>
        </select>
      </label>
      <label className="setting-row"><span>{t('Measured reading time (seconds)')}</span>
        <input aria-label={t('Measured reading time (seconds)')} type="number" min="0.1" max="86400" step="0.1"
          value={draft.seconds} onChange={(event) => change(draft.id, { seconds: event.target.value })} />
      </label>
      {draft.warnings && <p role="status">{draft.warnings}</p>}
      <button onClick={() => save(draft)}>{t('Save timed sample')}</button>
      <button onClick={() => setDrafts((previous) => previous.filter((item) => item.id !== draft.id))}>{t('Cancel')}</button>
    </fieldset>)}
    <p role="status">{result.profile
      ? t('Calibrated from {count} samples. Median timing error: {error}%.', {
        count: samples.length, error: (result.profile.medianRelativeError * 100).toFixed(1),
      }) : t('No valid samples: using the default speech algorithm and speaking rate.')}</p>
    <p>{t('Readability uses a standard English formula. Personal effort is relative to your sample documents (100 = your sample baseline), not a comprehension test. Calibration error is in-sample, not a guarantee for new speeches.')}</p>
    {samples.map((sample) => <div className="reading-sample" key={sample.id}>
      <span>{sample.name} — {formatDuration(sample.seconds)} — {t(sample.scope === 'full' ? 'Full document' : 'Highlighted evidence and spoken citations')}</span>
      <button aria-label={t('Remove sample {name}', { name: sample.name })}
        onClick={() => update({ readingSamples: samples.filter((item) => item.id !== sample.id) })}>{t('Remove')}</button>
      {result.profile && <small>{t('Estimated: {time}', {
        time: formatDuration(readingAssessment(sample.stats, settings.wpm, result.profile).seconds),
      })}</small>}
    </div>)}
    {samples.length > 0 && <button onClick={() => update({ readingSamples: [] })}>{t('Reset speech calibration')}</button>}
    {(error || result.error) && <p role="alert" className="error-text">{error || result.error}</p>}
  </section>;
}
