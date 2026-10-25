import { useEffect, useId, useState } from 'react';
import { trapTabKey } from '../lib/focusScope.js';
import { useI18n } from '../lib/i18n.js';

export default function EditorLinkForm({ noteNames, onInsert, onClose }) {
  const { t } = useI18n();
  const id = useId();
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');
  const [suggesting, setSuggesting] = useState(true);
  const [active, setActive] = useState(0);
  const query = target.split(/[|#]/)[0].toLowerCase();
  const suggestions = [...new Set(noteNames)].filter((name) => name.toLowerCase().includes(query)).slice(0, 30);
  const expanded = suggesting && suggestions.length > 0;
  useEffect(() => {
    const option = expanded && document.getElementById(`${id}-option-${active}`);
    if (!option) return;
    const list = option.parentElement;
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
    }
  }, [active, expanded, id, query]);
  const choose = (name) => {
    setTarget(name + target.slice(target.split(/[|#]/)[0].length));
    setSuggesting(false);
    setError('');
  };
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
    <div className="wiki-link-picker">
      <input autoFocus aria-label={t('Wiki link target')} placeholder="Note#Heading|Label"
        role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-options`}
        aria-activedescendant={expanded ? `${id}-option-${Math.min(active, suggestions.length - 1)}` : undefined}
        autoComplete="off" value={target} onFocus={() => setSuggesting(true)}
        onChange={(event) => { setTarget(event.target.value); setActive(0); setSuggesting(true); setError(''); }}
        onKeyDown={(event) => {
          if (!expanded) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            choose(suggestions[Math.min(active, suggestions.length - 1)]);
          }
        }}
        aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} />
      {expanded && <div id={`${id}-options`} className="wiki-link-options" role="listbox" aria-label={t('Notes')}>
        {suggestions.map((name, index) => <button type="button" role="option" key={name}
          id={`${id}-option-${index}`} aria-selected={index === active} tabIndex={-1}
          onMouseEnter={() => setActive(index)}
          onMouseDown={(event) => event.preventDefault()} onClick={() => choose(name)}>{name}</button>)}
      </div>}
    </div>
    <button type="submit">{t('Insert link')}</button>
    <button type="button" onClick={onClose}>{t('Cancel')}</button>
    {error && <span id={`${id}-error`} className="error-text" role="alert">{error}</span>}
  </form>;
}
