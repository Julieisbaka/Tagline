import { useEffect, useMemo, useRef, useState } from 'react';
import { fuzzyScore } from '../lib/vault.js';
import IntegrationSettings from './IntegrationSettings.jsx';
import ThemeSettings from './ThemeSettings.jsx';
import AdvancedSettings from './AdvancedSettings.jsx';
import { useI18n } from '../lib/i18n.js';

// Generic fuzzy-filtered list modal used for quick switcher, commands, templates.
export function Palette({ items, placeholder, onSelect, onClose, onCreate, createLabel }) {
  const { t } = useI18n();
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
    [items, query],
  );

  useEffect(() => setSel(0), [query]);
  useEffect(() => {
    listRef.current?.children[sel]?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const canCreate = onCreate && query.trim() && !filtered.some((f) => f.label.toLowerCase() === query.trim().toLowerCase());
  const total = filtered.length + (canCreate ? 1 : 0);

  const choose = (i, e) => {
    onClose();
    if (i < filtered.length) onSelect(filtered[i], e);
    else if (canCreate) onCreate(query.trim());
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="palette-input"
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
              if (total) choose(sel, e);
            } else if (e.key === 'Escape') onClose();
          }}
        />
        <div className="palette-list" ref={listRef}>
          {filtered.map((it, i) => (
            <div
              key={it.id}
              className={`palette-item${i === sel ? ' selected' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={(e) => choose(i, e)}
            >
              <span>{it.label}</span>
              {it.detail && <span className="palette-detail">{it.detail}</span>}
              {it.hotkey && <kbd>{it.hotkey}</kbd>}
            </div>
          ))}
          {canCreate && (
            <div
              className={`palette-item${sel === filtered.length ? ' selected' : ''}`}
              onMouseEnter={() => setSel(filtered.length)}
              onClick={() => choose(filtered.length)}
            >
              <span>
                {createLabel || t('Create')} “{query.trim()}”
              </span>
            </div>
          )}
          {!total && <div className="empty-hint">{t('No matches')}</div>}
        </div>
      </div>
    </div>
  );
}

export function PromptDialog({ title, initial = '', onSubmit, onClose }) {
  const { t } = useI18n();
  const [value, setValue] = useState(initial);
  const submit = () => {
    if (value.trim()) onSubmit(value.trim());
    onClose();
  };
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <input
          autoFocus
          value={value}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') onClose();
          }}
        />
        <div className="dialog-buttons">
          <button onClick={onClose}>{t('Cancel')}</button>
          <button className="primary" onClick={submit}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

export function SettingsDialog({ settings, update, onClose, migrationCount, onMigrate }) {
  const { t } = useI18n();
  const field = (label, key, type = 'text', extra = {}) => (
    <label className="setting-row">
      <span>{t(label)}</span>
      <input
        type={type}
        value={settings[key]}
        onChange={(e) => update({ [key]: type === 'number' ? Number(e.target.value) : e.target.value })}
        {...extra}
      />
    </label>
  );
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal dialog settings" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{t('Settings')}</h3>
        {field('Speaking rate (words per minute)', 'wpm', 'number', { min: 100, max: 500 })}
        {field('Speech document path', 'speechDoc')}
        {field('Editor font size', 'fontSize', 'number', { min: 10, max: 32 })}
        <label className="setting-row">
          <span>{t('Default editor')}</span>
          <select value={settings.editorMode} onChange={(e) => update({ editorMode: e.target.value })}>
            <option value="visual">{t('Visual (Tiptap)')}</option>
            <option value="edit">{t('Source (CodeMirror)')}</option>
          </select>
        </label>
        <ThemeSettings settings={settings} update={update} />
        <label className="setting-row"><span>{t('Focus new flow row after Ctrl+Enter')}</span>
          <input type="checkbox" data-setting="focusNewFlowRow" checked={settings.focusNewFlowRow}
            onChange={(e) => update({ focusNewFlowRow: e.target.checked })} />
        </label>
        <label className="setting-row">
          <span>{t('Readable line width')}</span>
          <input
            type="checkbox"
            checked={settings.readableWidth}
            onChange={(e) => update({ readableWidth: e.target.checked })}
          />
        </label>
        <IntegrationSettings />
        <AdvancedSettings settings={settings} update={update} migrationCount={migrationCount} onMigrate={onMigrate} />
        <div className="dialog-buttons">
          <button className="primary" onClick={onClose}>
            {t('Done')}
          </button>
        </div>
      </div>
    </div>
  );
}
