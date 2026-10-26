import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n.js';
import { fuzzyScore } from '../../lib/vault.js';
import AdvancedSettings from '../settings/AdvancedSettings.jsx';
import CustomCssSettings from '../settings/CustomCssSettings.jsx';
import CustomizationLimits from '../settings/CustomizationLimits.jsx';
import EditorSettings from '../settings/EditorSettings.jsx';
import ExtensionSettings from '../settings/ExtensionSettings.jsx';
import InstallationSettings from '../settings/InstallationSettings.jsx';
import IntegrationSettings from '../settings/IntegrationSettings.jsx';
import KeybindingSettings from '../settings/KeybindingSettings.jsx';
import OpenCaselistSettings from '../settings/OpenCaselistSettings.jsx';
import ReadingSettings from '../settings/ReadingSettings.jsx';
import RibbonSettings from '../settings/RibbonSettings.jsx';
import SettingRow from '../settings/SettingRow.jsx';
import ThemeSettings from '../settings/ThemeSettings.jsx';
import ModalBackdrop from './ModalBackdrop.jsx';

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
    <ModalBackdrop onMouseDown={onClose}>
      <div className="modal palette" role="dialog" aria-modal="true" aria-label={placeholder} onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="palette-input"
          aria-label={placeholder}
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
    </ModalBackdrop>
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
    <ModalBackdrop onMouseDown={onClose}>
      <div className="modal dialog" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <input
          autoFocus
          aria-label={title}
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
    </ModalBackdrop>
  );
}

export function SettingsDialog({ settings, update, onClose, extensions, onOpenCaselist,
  speechDoc, speechDocuments = [], onSelectSpeechDoc }) {
  const { t } = useI18n();
  const [section, setSection] = useState('general');
  const [query, setQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState([]);
  const contentRef = useRef(null);
  const searchRef = useRef(null);
  useEffect(() => {
    const content = contentRef.current;
    const index = () => {
      const next = [...content.querySelectorAll('[data-settings-panel]')].map((panel) => ({
        id: panel.dataset.settingsPanel,
        entries: [...panel.querySelectorAll('label, h3, h4, p, button, dt')].map((element) => ({
          element, text: element.textContent.replace(/\s+/g, ' ').trim(),
        })).filter((entry) => entry.text),
      }));
      setSearchIndex((previous) => previous.length === next.length && next.every((panel, i) =>
        panel.id === previous[i].id && panel.entries.length === previous[i].entries.length &&
        panel.entries.every((entry, j) => entry.element === previous[i].entries[j].element &&
          entry.text === previous[i].entries[j].text)) ? previous : next);
    };
    index();
    const observer = new MutationObserver(index);
    observer.observe(content, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  const sections = [
    ['general', 'General', 'Your writing and debate workspace'],
    ['editors', 'Editors', 'Configure Tiptap and CodeMirror'],
    ['appearance', 'Appearance', 'Make Tagline feel like yours'],
    ['accessibility', 'Accessibility', 'Focus indicators and editor accessibility'],
    ['performance', 'Performance and search', 'Control resource usage and results'],
    ['files', 'Files and folders', 'Portable paths and file associations'],
    ['integrations', 'Integrations', 'Document conversion and local models'],
    ['shortcuts', 'Keyboard shortcuts', 'Your commands, your keys'],
    ['extensions', 'Extensions', 'Sandboxed commands and themes from your extensions folder'],
    ['advanced', 'Advanced settings', 'Inspect and reset internal application flags'],
    ['installation', 'Installation', 'Version, runtime, and local data'],
  ];
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const results = terms.length ? sections.flatMap(([id, label, description]) => {
    const entries = searchIndex.find((panel) => panel.id === id)?.entries || [];
    const matches = (text) => terms.every((term) => text.toLocaleLowerCase().includes(term));
    const entry = entries.find((item) => item.text.toLocaleLowerCase().includes(terms.join(' ')))
      || entries.find((item) => matches(item.text));
    return entry || matches(`${t(label)} ${t(description)}`)
      ? [{ id, label: t(label), entry }] : [];
  }) : [];
  const openResult = ({ id, entry }) => {
    setSection(id);
    setQuery('');
    requestAnimationFrame(() => {
      const target = entry?.element;
      target?.scrollIntoView({ block: 'center' });
      const control = target?.matches('button') ? target : target?.querySelector('input, select, textarea, button');
      if (control && !control.disabled) control.focus({ preventScroll: true });
    });
  };
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
    <ModalBackdrop className="modal-backdrop settings-backdrop" onMouseDown={onClose}>
      <div className="modal dialog settings" role="dialog" aria-modal="true" aria-labelledby="settings-title"
        tabIndex={-1} onMouseDown={(e) => e.stopPropagation()}>
        <aside className="settings-sidebar">
          <div className="settings-brand">Tagline <span>{t('Workspace preferences')}</span></div>
          <div className="settings-search">
            <input ref={searchRef} type="search" aria-label={t('Search settings')}
              placeholder={t('Search settings')} value={query} onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && query) {
                  event.preventDefault(); event.stopPropagation(); setQuery('');
                }
                if (event.key === 'Enter' && results.length) { event.preventDefault(); openResult(results[0]); }
              }} />
            {query && <button className="icon-btn" aria-label={t('Clear settings search')}
              onClick={() => { setQuery(''); searchRef.current.focus(); }}>&times;</button>}
          </div>
          <nav aria-label={t('Settings sections')}>
            {sections.map(([id, label]) => <button key={id} data-section={id}
              aria-current={section === id ? 'page' : undefined} className={section === id ? 'active' : ''}
              onClick={() => { setSection(id); setQuery(''); }}>{t(label)}</button>)}
          </nav>
          <p>{t('Changes save automatically')}</p>
        </aside>
        <div className="settings-main">
          <header className="settings-header">
            <div><h2 id="settings-title">{t(sections.find(([id]) => id === section)[1])}</h2>
              <p>{t(sections.find(([id]) => id === section)[2])}</p></div>
            <button className="settings-close" aria-label={t('Close settings')} onClick={onClose}>&times;</button>
          </header>
          {terms.length > 0 && <div className="settings-search-results">
            <h3>{t('Search results')}</h3>
            <p role="status">{t('{count} matching sections', { count: results.length })}</p>
            {!results.length && <p>{t('No matching settings')}</p>}
            {results.map((result) => <button key={result.id} onClick={() => openResult(result)}>
              <strong>{result.label}</strong>
              {result.entry && <span>{result.entry.text}</span>}
            </button>)}
          </div>}
          <div className="settings-content" ref={contentRef} hidden={terms.length > 0}>
            <section data-settings-panel="general" hidden={section !== 'general'} className="settings-panel">
              <h3>{t('Writing and debate')}</h3>
              {field('Speaking rate (words per minute)', 'wpm', 'number', { min: 50, max: 1000 })}
              <ReadingSettings settings={settings} update={update} />
              <label className="setting-row"><span>{t('Active speech document')}</span>
                <select data-setting="speechDoc" value={speechDoc} onChange={(event) => onSelectSpeechDoc(event.target.value)}>
                  {[...new Set([speechDoc, ...speechDocuments])].filter(Boolean).map((path) =>
                    <option key={path} value={path}>{path}</option>)}
                </select>
              </label>
              <p className="settings-help">{t('Speech documents use speech: true in YAML frontmatter. Right-click a Markdown file and choose Set as speech doc to mark it and make it the active destination.')}</p>
              <SettingRow label={t('Default editor')} description={t('Choose the initial editing mode for Markdown notes.')}>
                <select value={settings.editorMode} onChange={(e) => update({ editorMode: e.target.value })}>
                  <option value="visual">{t('Visual (Tiptap)')}</option>
                  <option value="edit">{t('Source (CodeMirror)')}</option>
                </select>
              </SettingRow>
              <SettingRow label={t('Focus new flow rows')} description={t('Move the cursor into a newly added flow row.')}>
                <input type="checkbox" data-setting="focusNewFlowRow" checked={settings.focusNewFlowRow}
                  onChange={(e) => update({ focusNewFlowRow: e.target.checked })} />
              </SettingRow>
              <SettingRow label={t('Readable line width')} description={t('Limit note text to the content width configured in Editors.')}>
                <input
                  type="checkbox"
                  checked={settings.readableWidth}
                  onChange={(e) => update({ readableWidth: e.target.checked })}
                />
              </SettingRow>
            </section>
            <section data-settings-panel="editors" hidden={section !== 'editors'} className="settings-panel">
              <EditorSettings settings={settings} update={update} />
            </section>
            <section data-settings-panel="accessibility" hidden={section !== 'accessibility'} className="settings-panel">
              <label className="setting-row"><span>{t('Show note editor focus outline')}</span>
                <input type="checkbox" data-setting="editorFocusOutline" checked={settings.editorFocusOutline}
                  onChange={(event) => update({ editorFocusOutline: event.target.checked })} />
              </label>
              <p className="settings-help">{t('Highlight the focused visual or source note editor. Keyboard focus indicators on other controls remain enabled.')}</p>
              {[
                ['Reduce motion', 'reduceMotion', 'Minimize interface animations and transitions.'],
                ['Stronger keyboard focus indicators', 'strongFocusIndicators', 'Make the keyboard-focused control easier to see.'],
                ['Larger interface text', 'largerInterfaceText', 'Enlarge application labels and menus without changing the editor font size.'],
                ['Larger buttons and click targets', 'largerClickTargets', 'Increase the size of controls to make them easier to activate.'],
                ['Always underline links', 'underlineLinks', 'Keep links underlined so they are recognizable without relying on color.'],
              ].map(([label, key, description]) => <SettingRow key={key} label={t(label)} description={t(description)}>
                <input type="checkbox" data-setting={key} checked={settings[key]}
                  onChange={(event) => update({ [key]: event.target.checked })} />
              </SettingRow>)}
              <p className="settings-help">{t('Reduce motion also respects your operating system preference. Larger targets use a minimum of 48 pixels. Stronger focus includes note editors during keyboard navigation.')}</p>
            </section>
            <section data-settings-panel="appearance" hidden={section !== 'appearance'} className="settings-panel">
              <h3>{t('Theme and typography')}</h3>
              <ThemeSettings settings={settings} update={update} />
              <RibbonSettings settings={settings} update={update} contributions={extensions?.ribbonItems} />
              {field('Editor font size', 'fontSize', 'number', { min: 10, max: 32 })}
              <AdvancedSettings settings={settings} update={update} section="fonts" />
              <CustomCssSettings settings={settings} update={update} />
            </section>
            <section data-settings-panel="performance" hidden={section !== 'performance'} className="settings-panel">
              <AdvancedSettings settings={settings} update={update} section="performance" />
            </section>
            <section data-settings-panel="files" hidden={section !== 'files'} className="settings-panel">
              <AdvancedSettings settings={settings} update={update} section="files" />
              <h4>{t('Flow file association')}</h4>
              <p>{t('Installed builds register Tagline as an app for .flow files. To make it the default, use Open With in your file manager and select Tagline. On macOS choose Change All in Get Info.')}</p>
            </section>
            <section data-settings-panel="integrations" hidden={section !== 'integrations'} className="settings-panel">
              <h3>OpenCaselist</h3>
              <p>{t('Browse disclosures, download files, and publish changes using your OpenCaselist account.')}</p>
              <button onClick={onOpenCaselist}>{t('Open OpenCaselist')}</button>
              <OpenCaselistSettings />
              <label className="setting-row"><span>{t('Open websites inside Tagline')}</span>
                <input type="checkbox" data-setting="embedWebsites" checked={settings.embedWebsites}
                  onChange={(e) => update({ embedWebsites: e.target.checked })} />
              </label>
              <p>{t('Websites use a separate signed-in session and identify as standard Chrome. Disable this to use your default browser.')}</p>
              <IntegrationSettings />
            </section>
            <section data-settings-panel="shortcuts" hidden={section !== 'shortcuts'} className="settings-panel">
              <KeybindingSettings settings={settings} update={update} extra={extensions?.commands || []} />
            </section>
            <section data-settings-panel="extensions" hidden={section !== 'extensions'} className="settings-panel">
              {extensions && <ExtensionSettings extensions={extensions} />}
            </section>
            <section data-settings-panel="advanced" hidden={section !== 'advanced'} className="settings-panel">
              <CustomizationLimits settings={settings} />
              <section className="internal-flags">
                <h4>{t('Internal flags')}</h4>
                <p>{t('These flags record workspace state and dismissed notices.')}</p>
                <label className="setting-row"><span>{t('Visual editor notice dismissed')}</span>
                  <input type="checkbox" data-flag="visualNoticeDismissed" checked={!!settings.internalFlags?.visualNoticeDismissed}
                    onChange={(e) => update({ internalFlags: { ...settings.internalFlags, visualNoticeDismissed: e.target.checked } })} />
                </label>
                <label className="setting-row"><span>{t('Has seen onboarding')}</span>
                  <input type="checkbox" data-flag="hasSeenOnboarding" checked={!!settings.internalFlags?.hasSeenOnboarding}
                    onChange={(event) => update({ internalFlags: { ...settings.internalFlags, hasSeenOnboarding: event.target.checked } })} />
                </label>
                <button onClick={() => {
                  update({ internalFlags: { ...settings.internalFlags, hasSeenOnboarding: false } });
                  onClose();
                }}>{t('Show onboarding again')}</button>
              </section>
            </section>
            <section data-settings-panel="installation" hidden={section !== 'installation'} className="settings-panel">
              <InstallationSettings />
            </section>
          </div>
          <footer className="settings-footer"><span>{t('Settings are saved on this device')}</span>
            <button className="primary" onClick={onClose}>{t('Done')}</button>
          </footer>
        </div>
      </div>
    </ModalBackdrop>
  );
}
