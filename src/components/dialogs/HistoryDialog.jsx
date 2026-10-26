import { useEffect, useState } from 'react';
import { baseName, isCanvas, isFlow } from '../../lib/vault.js';
import { useI18n } from '../../lib/i18n.js';
import JsonEditor from '../JsonEditor.jsx';
import { useConfirm } from './ConfirmProvider.jsx';

import ModalBackdrop from './ModalBackdrop.jsx';

export default function HistoryDialog({ path, onRestore, onClose, settings }) {
  const { t, locale } = useI18n();
  const confirm = useConfirm();
  const [revisions, setRevisions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(true);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    window.api.listHistory(path).then((items) => {
      if (!active) return;
      setRevisions(items);
      setSelected(items[0]?.id || null);
      setBusy(false);
    }).catch((e) => {
      if (!active) return;
      setError(e.message);
      setBusy(false);
    });
    return () => { active = false; };
  }, [path]);

  useEffect(() => {
    if (!selected) { setContent(''); return undefined; }
    let active = true;
    setError('');
    setContent('');
    setReading(true);
    window.api.readHistory(path, selected).then((text) => {
      if (active) { setContent(text); setReading(false); }
    }).catch((e) => {
      if (active) { setError(e.message); setReading(false); }
    });
    return () => { active = false; };
  }, [path, selected]);

  return (
    <ModalBackdrop onMouseDown={onClose}>
      <div className="modal dialog history-dialog" role="dialog" aria-modal="true"
        aria-labelledby="history-title" onMouseDown={(e) => e.stopPropagation()}>
        <h3 id="history-title">{t('Revision history')} — {baseName(path)}</h3>
        {busy ? <p role="status">{t('Loading revision history…')}</p> : !revisions.length
          ? <p>{t('No saved revisions yet. Revisions are created when this document changes.')}</p>
          : <>
            <label className="setting-row">
              <span>{t('Saved versions')}</span>
              <select value={selected || ''} onChange={(e) => setSelected(e.target.value)}>
                {revisions.map((revision) => <option key={revision.id} value={revision.id}>
                  {new Date(revision.createdAt).toLocaleString(locale)}
                </option>)}
              </select>
            </label>
            {isFlow(path) || isCanvas(path)
              ? <JsonEditor className="history-json-preview" label={t('Revision preview')} readOnly editable={false}
                value={content} height="280px" settings={settings} />
              : <textarea className="history-preview" aria-label={t('Revision preview')} readOnly value={content} />}
          </>}
        {error && <p role="alert" className="error-text">{error}</p>}
        <div className="dialog-buttons">
          <button onClick={onClose}>{t('Close')}</button>
          {!!selected && <button className="primary" disabled={busy || reading || !!error} onClick={async () => {
            if (await confirm(t('Restore this saved version? The current document will be kept in revision history.'))) {
              onRestore(content);
            }
          }}>{t('Restore this version')}</button>}
        </div>
      </div>
    </ModalBackdrop>
  );
}
