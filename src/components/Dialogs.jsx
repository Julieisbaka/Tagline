import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.js';
import { fuzzyScore } from '../lib/vault.js';
import AdvancedSettings from './AdvancedSettings.jsx';
import IntegrationSettings from './IntegrationSettings.jsx';
import ThemeSettings from './ThemeSettings.jsx';
import ExtensionSettings from './ExtensionSettings.jsx';
import KeybindingSettings from './KeybindingSettings.jsx';

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

export function SettingsDialog({ settings, update, onClose, extensions }) {
  const { t } = useI18n();
  const [section, setSection] = useState('general');
  const shell = useRef(null);
  const previousFocus = useRef(document.activeElement);
  useEffect(() => {
    shell.current?.focus();
    return () => previousFocus.current?.focus();
  }, []);
  const sections = [
    ['general', 'General', 'Your writing and debate workspace'],
    ['appearance', 'Appearance', 'Make Tagline feel like yours'],
    ['performance', 'Performance and search', 'Control resource usage and results'],
    ['files', 'Files and folders', 'Portable paths and file associations'],
    ['integrations', 'Integrations', 'Document conversion and local models'],
    ['shortcuts', 'Keyboard shortcuts', 'Your commands, your keys'],
    ['extensions', 'Extensions', 'Sandboxed commands and themes from your extensions folder'],
  ];
  const field = (label, key, type = 'text', extra = {}) => (
    <label className="setting-row">
      <span>{t(label)}</span>
      <input
        type={type}
        value={settings[key]}
        onChange={(e) => {
          if (type === 'number' && (!e.target.validity.valid || e.target.value === '')) return;
          update({ [key]: type === 'number' ? Number(e.target.value) : e.target.value });
        }}
        {...extra}
      />
    </label>
  );
  return (
    <div className="modal-backdrop settings-backdrop" onMouseDown={onClose}>
      <div className="modal dialog settings" role="dialog" aria-modal="true" aria-labelledby="settings-title"
        ref={shell} tabIndex={-1} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => {
          if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onClose(); }
          if (e.key !== 'Tab') return;
          const controls = [...shell.current.querySelectorAll('button, input, select, textarea, [tabindex="0"]')]
            .filter((element) => !element.disabled && element.getClientRects().length);
          const first = controls[0]; const last = controls.at(-1);
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }}>
        <aside className="settings-sidebar">
          <div className="settings-brand">Tagline <span>{t('Workspace preferences')}</span></div>
          <nav aria-label={t('Settings sections')}>
            {sections.map(([id, label]) => <button key={id} data-section={id}
              aria-current={section === id ? 'page' : undefined} className={section === id ? 'active' : ''}
              onClick={() => setSection(id)}>{t(label)}</button>)}
          </nav>
          <p>{t('Changes save automatically')}</p>
        </aside>
        <div className="settings-main">
          <header className="settings-header">
            <div><h2 id="settings-title">{t(sections.find(([id]) => id === section)[1])}</h2>
              <p>{t(sections.find(([id]) => id === section)[2])}</p></div>
            <button className="settings-close" aria-label={t('Close settings')} onClick={onClose}>&times;</button>
          </header>
          <div className="settings-content">
        <section hidden={section !== 'general'} className="settings-panel">
        <h3>{t('Writing and debate')}</h3>
        {field('Speaking rate (words per minute)', 'wpm', 'number', { min: 100, max: 500 })}
        <p>{t('Read time uses syllables and pronunciation complexity, calibrated at 1.5 syllables per word. Estimates are optimized for English.')}</p>
        {field('Speech document path', 'speechDoc')}
        <label className="setting-row">
          <span>{t('Default editor')}</span>
          <select value={settings.editorMode} onChange={(e) => update({ editorMode: e.target.value })}>
            <option value="visual">{t('Visual (Tiptap)')}</option>
            <option value="edit">{t('Source (CodeMirror)')}</option>
          </select>
        </label>
        <label className="setting-row"><span>{t('Focus new flow rows')}</span>
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
        </section>
        <section hidden={section !== 'appearance'} className="settings-panel">
          <h3>{t('Theme and typography')}</h3>
          <ThemeSettings settings={settings} update={update} />
          {field('Editor font size', 'fontSize', 'number', { min: 10, max: 32 })}
          <AdvancedSettings settings={settings} update={update} section="fonts" />
        </section>
        <section hidden={section !== 'performance'} className="settings-panel">
          <AdvancedSettings settings={settings} update={update} section="performance" />
        </section>
        <section hidden={section !== 'files'} className="settings-panel">
          <AdvancedSettings settings={settings} update={update} section="files" />
          <h4>{t('Flow file association')}</h4>
          <p>{t('Installed builds register Tagline as an app for .flow files. To make it the default, use Open With in your file manager and select Tagline. On macOS choose Change All in Get Info.')}</p>
        </section>
        <section hidden={section !== 'integrations'} className="settings-panel">
        <IntegrationSettings />
        </section>
        <section hidden={section !== 'shortcuts'} className="settings-panel">
          <KeybindingSettings settings={settings} update={update} extra={extensions?.commands || []} />
        </section>
        <section hidden={section !== 'extensions'} className="settings-panel">
          {extensions && <ExtensionSettings extensions={extensions} />}
        </section>
          </div>
          <footer className="settings-footer"><span>{t('Settings are saved on this device')}</span>
            <button className="primary" onClick={onClose}>{t('Done')}</button>
          </footer>
        </div>
      </div>
    </div>
  );
}
