import { useEffect, useRef, useState } from 'react';
import platformCopy from '@platform-settings';
import { useI18n } from '../../../lib/i18n.js';
import ModalBackdrop from '../ModalBackdrop.jsx';
import SettingsPanels from './SettingsPanels.jsx';

export function SettingsDialog({
  settings,
  update,
  onClose,
  extensions,
  onOpenCaselist,
  onOpenTabroom,
  speechDoc,
  speechDocuments = [],
  onSelectSpeechDoc,
  initialSection = 'workspace',
  contents = {},
}) {
  const { t, locale } = useI18n();
  const platform = platformCopy[locale] || platformCopy.en;
  const [section, setSection] = useState(initialSection);
  const [query, setQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState([]);
  const contentRef = useRef(null);
  const searchRef = useRef(null);
  useEffect(() => {
    const content = contentRef.current;
    const index = () => {
      const next = [...content.querySelectorAll('[data-settings-panel]')].map((panel) => ({
        id: panel.dataset.settingsPanel,
        entries: [...panel.querySelectorAll('label, h3, h4, p, button, dt, summary')]
          .map((element) => ({
            element,
            text: element.textContent.replace(/\s+/g, ' ').trim(),
          }))
          .filter((entry) => entry.text),
      }));
      setSearchIndex((previous) =>
        previous.length === next.length &&
        next.every(
          (panel, i) =>
            panel.id === previous[i].id &&
            panel.entries.length === previous[i].entries.length &&
            panel.entries.every(
              (entry, j) =>
                entry.element === previous[i].entries[j].element &&
                entry.text === previous[i].entries[j].text
            )
        )
          ? previous
          : next
      );
    };
    index();
    const observer = new MutationObserver(index);
    observer.observe(content, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  const sections = [
    ['workspace', 'Workspace', 'Tabs and sidebar shortcuts'],
    ['appearance', 'Appearance', 'Themes, fonts, and styles'],
    ['editors', 'Editors', 'Note, flow, canvas, and source editors'],
    ['general', 'Speech and reading', 'Speech documents, calibration, and timers'],
    ['files', 'Files and folders', 'Paths, links, and file associations'],
    ['history', 'Revision history', 'Retention and canvas history'],
    ['shortcuts', 'Keyboard shortcuts', 'Command keybindings'],
    ['accessibility', 'Accessibility', 'Motion, focus, and display'],
    ['performance', 'Performance and search', 'Resource and search limits'],
    ['integrations', 'Integrations', 'Services, document tools, and local models'],
    ['extensions', 'Extensions', 'Extension commands and themes'],
    ['advanced', 'Advanced', 'Customization limits and internal flags'],
    ['installation', 'Installation', 'Version, updates, and uninstall'],
  ];
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const results = terms.length
    ? sections.flatMap(([id, label, description]) => {
        const entries = searchIndex.find((panel) => panel.id === id)?.entries || [];
        const matches = (text) => terms.every((term) => text.toLocaleLowerCase().includes(term));
        const entry =
          entries.find((item) => item.text.toLocaleLowerCase().includes(terms.join(' '))) ||
          entries.find((item) => matches(item.text));
        return entry || matches(`${t(label)} ${t(description)}`)
          ? [{ id, label: t(label), entry }]
          : [];
      })
    : [];
  const openResult = ({ id, entry }) => {
    setSection(id);
    setQuery('');
    requestAnimationFrame(() => {
      const target = entry?.element;
      for (
        let group = target?.closest('details');
        group;
        group = group.parentElement?.closest('details')
      ) {
        group.open = true;
      }
      target?.scrollIntoView({ block: 'center' });
      const control = target?.matches('button')
        ? target
        : target?.control || target?.querySelector('input, select, textarea, button');
      if (control && !control.disabled) {
        control.focus({ preventScroll: true });
      }
    });
  };
  const field = (label, key, type = 'text', extra = {}) => (
    <label className='setting-row'>
      <span>{t(label)}</span>
      <input
        type={type}
        value={settings[key]}
        onChange={(e) => {
          if (type === 'number' && (!e.target.validity.valid || e.target.value === '')) {
            return;
          }
          update({ [key]: type === 'number' ? Number(e.target.value) : e.target.value });
        }}
        {...extra}
      />
    </label>
  );
  return (
    <ModalBackdrop className='modal-backdrop settings-backdrop' onMouseDown={onClose}>
      <div
        className='modal dialog settings'
        role='dialog'
        aria-modal='true'
        aria-labelledby='settings-title'
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <aside className='settings-sidebar'>
          <div className='settings-brand'>
            Tagline <span>{t('Workspace preferences')}</span>
          </div>
          <div className='settings-search'>
            <input
              ref={searchRef}
              type='search'
              aria-label={t('Search settings')}
              placeholder={t('Search settings')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && query) {
                  event.preventDefault();
                  event.stopPropagation();
                  setQuery('');
                }
                if (event.key === 'Enter' && results.length) {
                  event.preventDefault();
                  openResult(results[0]);
                }
              }}
            />
            {query && (
              <button
                className='icon-btn'
                aria-label={t('Clear settings search')}
                onClick={() => {
                  setQuery('');
                  searchRef.current.focus();
                }}
              >
                &times;
              </button>
            )}
          </div>
          <nav aria-label={t('Settings sections')}>
            {sections.map(([id, label]) => (
              <button
                key={id}
                data-section={id}
                aria-current={section === id ? 'page' : undefined}
                className={section === id ? 'active' : ''}
                onClick={() => {
                  setSection(id);
                  setQuery('');
                }}
              >
                {t(label)}
              </button>
            ))}
          </nav>
          <p>{t('Changes save automatically')}</p>
        </aside>
        <div className='settings-main'>
          <header className='settings-header'>
            <div>
              <h2 id='settings-title'>{t(sections.find(([id]) => id === section)[1])}</h2>
              <p>{t(sections.find(([id]) => id === section)[2])}</p>
            </div>
            <button className='settings-close' aria-label={t('Close settings')} onClick={onClose}>
              &times;
            </button>
          </header>
          {terms.length > 0 && (
            <div className='settings-search-results'>
              <h3>{t('Search results')}</h3>
              <p role='status'>{t('{count} matching sections', { count: results.length })}</p>
              {!results.length && <p>{t('No matching settings')}</p>}
              {results.map((result) => (
                <button key={result.id} onClick={() => openResult(result)}>
                  <strong>{result.label}</strong>
                  {result.entry && <span>{result.entry.text}</span>}
                </button>
              ))}
            </div>
          )}
          <SettingsPanels
            contentRef={contentRef}
            terms={terms}
            section={section}
            t={t}
            settings={settings}
            update={update}
            field={field}
            speechDoc={speechDoc}
            speechDocuments={speechDocuments}
            onSelectSpeechDoc={onSelectSpeechDoc}
            contents={contents}
            extensions={extensions}
            onOpenCaselist={onOpenCaselist}
            onOpenTabroom={onOpenTabroom}
            platform={platform}
            onClose={onClose}
          />
          <footer className='settings-footer'>
            <span>{t('Settings are saved on this device')}</span>
            <button className='primary' onClick={onClose}>
              {t('Done')}
            </button>
          </footer>
        </div>
      </div>
    </ModalBackdrop>
  );
}
