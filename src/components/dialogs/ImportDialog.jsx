import { useState } from 'react';
import { useI18n } from '../../lib/i18n.js';

export default function ImportDialog({ onImport, onClose }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const choose = async () => {
    setBusy(true);
    setError('');
    try {
      const doc = await window.api.importDocument();
      if (!doc.canceled) { setResult(doc); setName(doc.name); }
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const path = await onImport(name.replace(/[\\/:*?"<>|]/g, '-').replace(/\.md$/i, '') + '.md', result.markdown);
      if (path) onClose();
      else setError(t('Could not save imported note. Please try again.'));
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div className="modal dialog import-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{t('Import document with Pandoc')}</h3>
        <p>{t('Choose a DOCX, ODT, RTF, HTML, or EPUB document. Review the Markdown before adding it to this vault. The original is never changed.')}</p>
        <p>{t('Images and complex formatting may not survive conversion. Imported HTML stays in source mode when needed.')}</p>
        <button disabled={busy} onClick={choose}>{t('Choose document')}</button>
        {result && <>
          <label className="setting-row"><span>{t('Note name')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          {result.warnings && <pre role="status">{result.warnings}</pre>}
          <textarea className="import-preview" aria-label={t('Imported Markdown preview')}
            readOnly value={result.markdown} />
        </>}
        {error && <p role="alert" className="error-text">{error}</p>}
        <div className="dialog-buttons">
          <button disabled={busy} onClick={onClose}>{t('Cancel')}</button>
          <button className="primary" disabled={busy || !result || !name.trim()} onClick={save}>
            {t(busy ? 'Importing...' : 'Add to vault')}
          </button>
        </div>
      </div>
    </div>
  );
}
