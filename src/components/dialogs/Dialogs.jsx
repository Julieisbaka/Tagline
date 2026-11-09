import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n.js';
import { fuzzyScore } from '../../lib/vault.js';
import ModalBackdrop from './ModalBackdrop.jsx';
export { SettingsDialog } from './Dialogs/SettingsDialog.jsx';

// Generic fuzzy-filtered list modal used for quick switcher, commands, templates.
export function Palette({ items, placeholder, onSelect, onClose, onCreate, createLabel }) {
  const { t } = useI18n();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef(null);

  const filtered = useMemo(
    () =>
      items
        .map((it) => ({ it, s: fuzzyScore(query, it.label + ' ' + (it.detail || '')) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 100)
        .map((x) => x.it),
    [items, query]
  );

  useEffect(() => setSel(0), [query]);
  useEffect(() => {
    listRef.current?.children[sel]?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const canCreate =
    onCreate &&
    query.trim() &&
    !filtered.some((f) => f.label.toLowerCase() === query.trim().toLowerCase());
  const total = filtered.length + (canCreate ? 1 : 0);

  const choose = (i, e) => {
    onClose();
    if (i < filtered.length) {
      onSelect(filtered[i], e);
    } else if (canCreate) {
      onCreate(query.trim());
    }
  };

  return (
    <ModalBackdrop onMouseDown={onClose}>
      <div
        className='modal palette'
        role='dialog'
        aria-modal='true'
        aria-label={placeholder}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          className='palette-input'
          role='combobox'
          aria-label={placeholder}
          aria-autocomplete='list'
          aria-expanded={total > 0}
          aria-haspopup='listbox'
          aria-controls={listId}
          aria-activedescendant={total ? `${listId}-option-${sel}` : undefined}
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => Math.min(total - 1, s + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (total) {
                choose(sel, e);
              }
            } else if (e.key === 'Escape') {
              onClose();
            }
          }}
        />
        <div
          className='palette-list'
          id={listId}
          role='listbox'
          aria-label={placeholder}
          ref={listRef}
        >
          {filtered.map((it, i) => (
            <div
              key={it.id}
              id={`${listId}-option-${i}`}
              className={`palette-item${i === sel ? ' selected' : ''}`}
              role='option'
              aria-selected={i === sel}
              onMouseEnter={() => setSel(i)}
              onClick={(e) => choose(i, e)}
            >
              <span>{it.label}</span>
              {it.detail && <span className='palette-detail'>{it.detail}</span>}
              {it.hotkey && <kbd>{it.hotkey}</kbd>}
            </div>
          ))}
          {canCreate && (
            <div
              id={`${listId}-option-${filtered.length}`}
              className={`palette-item${sel === filtered.length ? ' selected' : ''}`}
              role='option'
              aria-selected={sel === filtered.length}
              onMouseEnter={() => setSel(filtered.length)}
              onClick={() => choose(filtered.length)}
            >
              <span>
                {createLabel || t('Create')} “{query.trim()}”
              </span>
            </div>
          )}
        </div>
        {!total && (
          <div className='empty-hint' role='status'>
            {t('No matches')}
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}

export function PromptDialog({ title, initial = '', onSubmit, onClose }) {
  const { t } = useI18n();
  const [value, setValue] = useState(initial);
  const submit = () => {
    if (value.trim()) {
      onSubmit(value.trim());
    }
    onClose();
  };
  return (
    <ModalBackdrop onMouseDown={onClose}>
      <div
        className='modal dialog'
        role='dialog'
        aria-modal='true'
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        <input
          autoFocus
          aria-label={title}
          value={value}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              submit();
            }
            if (e.key === 'Escape') {
              onClose();
            }
          }}
        />
        <div className='dialog-buttons'>
          <button onClick={onClose}>{t('Cancel')}</button>
          <button className='primary' onClick={submit}>
            OK
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
