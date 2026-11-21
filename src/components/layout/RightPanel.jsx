import { useMemo, useState } from 'react';
import { useI18n } from '../../lib/i18n.js';
import { flowsUsingCard } from '../../lib/flowCardLinks.js';
import { baseName, displayName, isFlow, isMarkdown, outline } from '../../lib/vault.js';
import Icon from '../Icon.jsx';
import Timer from '../Timer.jsx';
import ExtensionPanelList from './ExtensionPanelList.jsx';

const TABS = [
  ['backlinks', 'link', 'Backlinks'],
  ['outline', 'list', 'Outline'],
  ['tags', 'tag', 'Tags'],
  ['timer', 'timer', 'Timer'],
];

function snippetsFor(content, name) {
  const lower = name.toLowerCase();
  return content
    .split('\n')
    .filter((l) => l.toLowerCase().includes(lower))
    .slice(0, 3)
    .map((l) => l.trim().slice(0, 160));
}

function Backlinks({ activePath, index, contents, onOpen, settings }) {
  const { t } = useI18n();
  const name = activePath ? baseName(activePath) : '';
  const linked = useMemo(
    () => (activePath ? index.backlinks[activePath] || [] : []),
    [activePath, index.backlinks]
  );
  const usedInRounds = useMemo(
    () => (activePath && isMarkdown(activePath) ? flowsUsingCard(index, activePath) : []),
    [activePath, index]
  );
  const otherLinked =
    activePath && isMarkdown(activePath) ? linked.filter((p) => !isFlow(p)) : linked;
  const unlinked = useMemo(() => {
    if (!name || name.length < 3) {
      return [];
    }
    const lower = name.toLowerCase();
    return Object.keys(contents).filter(
      (p) =>
        p !== activePath &&
        p.endsWith('.md') &&
        !linked.includes(p) &&
        contents[p].toLowerCase().includes(lower)
    );
  }, [contents, name, activePath, linked]);

  if (!activePath) {
    return <div className='empty-hint'>{t('Open a note to see its backlinks.')}</div>;
  }
  return (
    <div>
      {isMarkdown(activePath) && (
        <>
          <div className='panel-section-title'>
            {t('Used in flows ({count})', { count: usedInRounds.length })}
          </div>
          {usedInRounds.length === 0 && (
            <div className='empty-hint'>{t('No flows link to this note yet.')}</div>
          )}
          {usedInRounds.map((p) => (
            <button
              type='button'
              key={p}
              className='backlink flow-backlink'
              title={p}
              onClick={(e) => onOpen(p, e.ctrlKey || e.metaKey)}
            >
              {displayName(p, settings.hideFlowExtension, settings.showMarkdownExtension)}
            </button>
          ))}
        </>
      )}
      <div className='panel-section-title'>
        {t('Linked mentions ({count})', { count: otherLinked.length })}
      </div>
      {otherLinked.length === 0 && <div className='empty-hint'>{t('No notes link here yet.')}</div>}
      {otherLinked.map((p) => (
        <div key={p} className='backlink' onClick={(e) => onOpen(p, e.ctrlKey || e.metaKey)}>
          <div className='backlink-title'>
            {displayName(p, settings.hideFlowExtension, settings.showMarkdownExtension)}
          </div>
          {snippetsFor(contents[p] || '', `[[${name}`).map((s, i) => (
            <div key={i} className='backlink-snippet'>
              {s}
            </div>
          ))}
        </div>
      ))}
      <div className='panel-section-title'>
        {t('Unlinked mentions ({count})', { count: unlinked.length })}
      </div>
      {unlinked.map((p) => (
        <div key={p} className='backlink' onClick={(e) => onOpen(p, e.ctrlKey || e.metaKey)}>
          <div className='backlink-title'>
            {displayName(p, settings.hideFlowExtension, settings.showMarkdownExtension)}
          </div>
          {snippetsFor(contents[p] || '', name).map((s, i) => (
            <div key={i} className='backlink-snippet'>
              {s}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Outline({ content, onJump }) {
  const { t } = useI18n();
  const items = useMemo(() => outline(content || ''), [content]);
  if (!items.length) {
    return (
      <div className='empty-hint'>
        {t('No headings. Use F4–F7 to add pockets, hats, blocks and tags.')}
      </div>
    );
  }
  const labels = ['', 'Pocket', 'Hat', 'Block', 'Tag', 'H5', 'H6'];
  return (
    <div className='outline'>
      {items.map((h, i) => (
        <div
          key={i}
          className={`outline-item level-${h.level}`}
          style={{ paddingLeft: 6 + (h.level - 1) * 12 }}
          onClick={() => onJump(h)}
          title={t(labels[h.level])}
        >
          {h.text.replace(/[=+*]/g, '')}
        </div>
      ))}
    </div>
  );
}

function Tags({ index, onTagClick }) {
  const { t: tr } = useI18n();
  const tags = Object.entries(index.tags).sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])
  );
  if (!tags.length) {
    return (
      <div className='empty-hint'>
        {tr('Add tags in note Properties. Existing #tags in note text remain searchable.')}
      </div>
    );
  }
  return (
    <div className='tag-list'>
      {tags.map(([t, ps]) => (
        <div key={t} className='tag-row' onClick={() => onTagClick(t)}>
          <span className='tag'>#{t}</span>
          <span className='count'>{ps.length}</span>
        </div>
      ))}
    </div>
  );
}

export default function RightPanel(props) {
  const { t } = useI18n();
  const [tab, setTab] = useState('backlinks');
  const [timerArmed, setTimerArmed] = useState(false);
  return (
    <aside className='right-panel'>
      <div className='panel-tabs'>
        {TABS.map(([id, icon, title]) => (
          <button
            key={id}
            className={`icon-btn${tab === id ? ' active' : ''}`}
            title={id === 'timer' && timerArmed ? t('Timer (microphone armed)') : t(title)}
            aria-label={id === 'timer' && timerArmed ? t('Timer (microphone armed)') : t(title)}
            onClick={() => setTab(id)}
            style={id === 'timer' && timerArmed ? { position: 'relative' } : undefined}
          >
            <Icon name={icon} />
            {id === 'timer' && timerArmed && (
              <span
                className='armed-dot'
                aria-hidden='true'
                style={{
                  position: 'absolute',
                  top: 2,
                  right: 2,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'var(--text-error, #d33)',
                }}
              />
            )}
          </button>
        ))}
      </div>
      <div className='panel-body'>
        <ExtensionPanelList
          extensions={props.extensions}
          placement='right-panel'
          activePath={props.activePath}
          mode={props.mode}
        />
        {tab === 'backlinks' && <Backlinks {...props} />}
        {tab === 'outline' && <Outline content={props.content} onJump={props.onJump} />}
        {tab === 'tags' && <Tags index={props.index} onTagClick={props.onTagClick} />}
        {/* Timer stays mounted so it keeps running while other tabs are shown. */}
        <div style={{ display: tab === 'timer' ? 'block' : 'none' }}>
          <Timer
            format={props.settings.format}
            onFormatChange={(format) => props.updateSettings({ format })}
            presets={props.settings.timerPresets}
            onAddPreset={(preset) => {
              const presets = Array.isArray(props.settings.timerPresets)
                ? props.settings.timerPresets
                : [];
              props.updateSettings({
                timerPresets: presets.some((p) => p?.id === preset.id)
                  ? presets.map((p) => (p?.id === preset.id ? preset : p))
                  : [...presets, preset],
                format: preset.id,
              });
            }}
            timerSoundEnabled={props.settings.timerSoundEnabled}
            timerSoundName={props.settings.timerSoundName}
            timerAutoStartUseSpeechRecognition={props.settings.timerAutoStartUseSpeechRecognition}
            timerAutoStartThreshold={props.settings.timerAutoStartThreshold}
            onThresholdChange={(value) => props.updateSettings({ timerAutoStartThreshold: value })}
            timerFloatingWindow={props.settings.timerFloatingWindow}
            recognitionLanguage={props.settings.language}
            interactionSounds={props.settings.interactionSounds}
            onArmedChange={setTimerArmed}
          />
        </div>
      </div>
    </aside>
  );
}
