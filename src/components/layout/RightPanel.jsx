import { useMemo, useState } from 'react';
import { useI18n } from '../../lib/i18n.js';
import { baseName, displayName, outline } from '../../lib/vault.js';
import ExtensionSurface from '../ExtensionSurface.jsx';
import Icon from '../Icon.jsx';
import Timer from '../Timer.jsx';

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
  const linked = (activePath && index.backlinks[activePath]) || [];
  const unlinked = useMemo(() => {
    if (!name || name.length < 3) return [];
    const lower = name.toLowerCase();
    return Object.keys(contents).filter(
      (p) =>
        p !== activePath &&
        p.endsWith('.md') &&
        !linked.includes(p) &&
        contents[p].toLowerCase().includes(lower),
    );
  }, [contents, name, activePath, linked]);

  if (!activePath) return <div className="empty-hint">{t('Open a note to see its backlinks.')}</div>;
  return (
    <div>
      <div className="panel-section-title">{t('Linked mentions ({count})', { count: linked.length })}</div>
      {linked.length === 0 && <div className="empty-hint">{t('No notes link here yet.')}</div>}
      {linked.map((p) => (
        <div key={p} className="backlink" onClick={(e) => onOpen(p, e.ctrlKey || e.metaKey)}>
          <div className="backlink-title">{displayName(p, settings.hideFlowExtension, settings.showMarkdownExtension)}</div>
          {snippetsFor(contents[p] || '', `[[${name}`).map((s, i) => (
            <div key={i} className="backlink-snippet">
              {s}
            </div>
          ))}
        </div>
      ))}
      <div className="panel-section-title">{t('Unlinked mentions ({count})', { count: unlinked.length })}</div>
      {unlinked.map((p) => (
        <div key={p} className="backlink" onClick={(e) => onOpen(p, e.ctrlKey || e.metaKey)}>
          <div className="backlink-title">{displayName(p, settings.hideFlowExtension, settings.showMarkdownExtension)}</div>
          {snippetsFor(contents[p] || '', name).map((s, i) => (
            <div key={i} className="backlink-snippet">
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
  if (!items.length) return <div className="empty-hint">{t('No headings. Use F4–F7 to add pockets, hats, blocks and tags.')}</div>;
  const labels = ['', 'Pocket', 'Hat', 'Block', 'Tag', 'H5', 'H6'];
  return (
    <div className="outline">
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
  const tags = Object.entries(index.tags).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  if (!tags.length) return <div className="empty-hint">{tr('No #tags yet.')}</div>;
  return (
    <div className="tag-list">
      {tags.map(([t, ps]) => (
        <div key={t} className="tag-row" onClick={() => onTagClick(t)}>
          <span className="tag">#{t}</span>
          <span className="count">{ps.length}</span>
        </div>
      ))}
    </div>
  );
}

export default function RightPanel(props) {
  const { t } = useI18n();
  const [tab, setTab] = useState('backlinks');
  return (
    <aside className="right-panel">
      <div className="panel-tabs">
        {TABS.map(([id, icon, title]) => (
          <button key={id} className={`icon-btn${tab === id ? ' active' : ''}`} title={t(title)} onClick={() => setTab(id)}>
            <Icon name={icon} />
          </button>
        ))}
      </div>
      <div className="panel-body">
        {(props.extensions?.surfaces || []).filter((surface) => surface.kind === 'panels' && surface.visible)
          .map((surface) => <section className="extension-panel" key={`${surface.host.manifest.id}:${surface.id}`}>
            <header><strong>{surface.title}</strong>
              <button aria-label={t('Close')} onClick={() => props.extensions.closeSurface(surface)}>&times;</button>
            </header>
            <ExtensionSurface surface={surface} onClose={props.extensions.closeSurface} />
          </section>)}
        {tab === 'backlinks' && <Backlinks {...props} />}
        {tab === 'outline' && <Outline content={props.content} onJump={props.onJump} />}
        {tab === 'tags' && <Tags index={props.index} onTagClick={props.onTagClick} />}
        {/* Timer stays mounted so it keeps running while other tabs are shown. */}
        <div style={{ display: tab === 'timer' ? 'block' : 'none' }}>
          <Timer format={props.settings.format} onFormatChange={(format) => props.updateSettings({ format })}
            timerSoundEnabled={props.settings.timerSoundEnabled} timerSoundName={props.settings.timerSoundName} />
        </div>
      </div>
    </aside>
  );
}
