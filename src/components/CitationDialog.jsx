import { useState } from 'react';
import { createCitation } from '../lib/citation.js';
import { useI18n } from '../lib/i18n.js';

export default function CitationDialog({ onInsert, onClose }) {
  const { t } = useI18n();
  const [values, setValues] = useState({ author: '', year: '', title: '', publication: '', url: '',
    accessed: new Date().toISOString().slice(0, 10) });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
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
      {Object.entries({ author: 'Author', year: 'Year', title: 'Title', publication: 'Publication',
        url: 'URL', accessed: 'Access date' }).map(([key, label]) => <label className="setting-row" key={key}>
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
