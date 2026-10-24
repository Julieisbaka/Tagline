import { useId, useState } from 'react';
import { trapTabKey } from '../lib/focusScope.js';
import { useI18n } from '../lib/i18n.js';

export default function EditorLinkForm({ noteNames, onInsert, onClose }) {
  const { t } = useI18n();
  const id = useId();
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');
  return <form className="visual-link-form" onSubmit={(event) => {
    event.preventDefault();
    if (!/^([^\]|#]+)(?:#([^\]|]*))?(?:\|([^\]]*))?$/.test(target.trim())) {
      setError(t('Use Note, Note#Heading, or Note|Label for a wiki link.'));
      return;
    }
    onInsert(target.trim());
  }} onKeyDown={(event) => {
    trapTabKey(event, event.currentTarget);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }}>
    <input autoFocus aria-label={t('Wiki link target')} placeholder="Note#Heading|Label" list={id}
      value={target} onChange={(event) => setTarget(event.target.value)} aria-invalid={!!error}
      aria-describedby={error ? `${id}-error` : undefined} />
    <datalist id={id}>{[...new Set(noteNames)].map((name) => <option key={name} value={name} />)}</datalist>
    <button type="submit">{t('Insert link')}</button>
    <button type="button" onClick={onClose}>{t('Cancel')}</button>
    {error && <span id={`${id}-error`} className="error-text" role="alert">{error}</span>}
  </form>;
}
