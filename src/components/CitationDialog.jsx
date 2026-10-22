import { useState } from 'react';
import { createCitation } from '../lib/citation.js';
import { useI18n } from '../lib/i18n.js';

export default function CitationDialog({ onInsert, onClose }) {
  const { t } = useI18n();
  const [values, setValues] = useState({
    author: '', year: '', title: '', publication: '', url: '',
    accessed: new Date().toISOString().slice(0, 10)
  });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const extract = async () => {
    setLoading(true); setError(''); setMessage('');
    const original = { ...values };
    try {
      const fields = await window.api.extractCitation(original.url);
      setValues((current) => {
        if (current.url !== original.url) return current;
        const next = { ...current };
        for (const key of ['author', 'year', 'title', 'publication']) {
          if (!current[key].trim() && current[key] === original[key] && fields[key]) next[key] = fields[key];
        }
        return next;
      });
      setMessage(t('Available fields extracted. Review the citation before using it; existing fields were kept.'));
    } catch (error) { setError(t(error.message)); }
    finally { setLoading(false); }
  };
  let citation = '';
  try { citation = createCitation(values); } catch { /* Display validation errors on submission, not while typing. */ }
  const perform = async (copy) => {
    setError('');
    try {
      const text = createCitation(values);
      if (copy) { await navigator.clipboard.writeText(text); setMessage(t('Copied citation')); }
      else { await onInsert(text); onClose(); }
    } catch (e) { setError(t(e.message)); }
  };
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <form className="modal dialog citation-dialog" onMouseDown={(e) => e.stopPropagation()}
      onSubmit={(e) => { e.preventDefault(); perform(false); }}>
      <h3>{t('Create citation')}</h3>
      <p>{t('Paste a public article URL or DOI. Autofill reads public citation metadata only; it does not fetch full text or bypass access controls.')}</p>
      <div className="citation-url">
        <input name="url" type="url" aria-label={t('Article URL')} placeholder="https://..." value={values.url} disabled={loading}
          onChange={(e) => setValues({ ...values, url: e.target.value })} />
        <button type="button" disabled={loading || !values.url.trim()} onClick={extract}>
          {t(loading ? 'Extracting...' : 'Autofill from URL')}
        </button>
      </div>
      {Object.entries({
        author: 'Author', year: 'Year', title: 'Title', publication: 'Publication',
        accessed: 'Access date'
      }).map(([key, label]) => <label className="setting-row" key={key}>
        <span>{t(label)}</span>
        <input name={key} value={values[key]} autoFocus={key === 'author'}
          type={key === 'accessed' ? 'date' : 'text'} required={['author', 'year'].includes(key)}
          onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
      </label>)}
      <pre className="citation-preview">{citation}</pre>
      {error && <p role="alert" className="error-text">{error}</p>}
      {message && <p role="status">{message}</p>}
      <div className="dialog-buttons">
        <button type="button" onClick={onClose}>{t('Cancel')}</button>
        <button type="button" onClick={() => perform(true)}>{t('Copy citation')}</button>
        <button type="submit" className="primary" disabled={!onInsert}>{t('Insert citation')}</button>
      </div>
    </form>
  </div>;
}
