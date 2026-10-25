import { useEffect, useMemo, useRef, useState } from 'react';
import { cardStats, formatDuration, getSectionAt } from '../lib/card.js';
import { readFrontmatter } from '../lib/frontmatter.js';
import { useI18n } from '../lib/i18n.js';
import { binding, displayBinding } from '../lib/keybindings.js';
import { calibrateReading, readingAssessment, readingSeconds } from '../lib/readTime.js';
import { baseName, isFlow } from '../lib/vault.js';
import { visualBlocker, visualSelection } from '../lib/visualHelpers.js';
import { deferred } from './Deferred.jsx';
import Icon from './Icon.jsx';

const Editor = deferred(() => import('./Editor.jsx'));
const FlowEditor = deferred(() => import('./FlowEditor.jsx'));
const Preview = deferred(() => import('./Preview.jsx'));
const VisualEditor = deferred(() => import('./VisualEditor.jsx'));

export default function NoteView({
  path,
  content,
  mode,
  setMode,
  highlightOnly,
  setHighlightOnly,
  jump,
  noteNames,
  resolve,
  onChange,
  onOpenLink,
  onTagClick,
  onSendCard,
  onCursor,
  onCursorStats,
  onRename,
  editorRef,
  visualRef,
  onVisualEditorReady,
  onExport,
  onTestHypothesis,
  onSummarize,
  onCreateCitation,
  onOpenHistory,
  onRestore,
  settings,
  onDismissVisualNotice,
}) {
  const { t, locale } = useI18n();
  const metadata = useMemo(() => isFlow(path) ? null : readFrontmatter(content), [path, content]);
  const localRef = useRef(null);
  const viewRef = editorRef || localRef;
  const blocker = mode === 'visual' ? visualBlocker(content) : null;
  const sourceMode = mode === 'edit' || !!blocker;
  const sendCurrent = () => {
    if (!sourceMode) return onSendCard(0, visualRef.current ? visualSelection(visualRef.current) : '');
    const view = viewRef.current;
    const selection = view?.state.selection.main;
    return onSendCard(selection?.head ?? cursor, view ? view.state.sliceDoc(selection.from, selection.to) : '');
  };
  const [cursor, setCursorState] = useState(0);
  const [visualSection, setVisualSection] = useState('');
  const setCursor = (pos) => {
    setCursorState(pos);
    onCursor?.(pos);
  };
  const [title, setTitle] = useState(baseName(path));
  useEffect(() => setTitle(baseName(path)), [path]);

  // Status-bar stats: whole document plus the card under the cursor.
  const docStats = useMemo(() => (isFlow(path) ? null : cardStats(content)), [content, path]);
  const section = useMemo(
    () => isFlow(path) || mode === 'read' ? null : sourceMode
      ? getSectionAt(content, cursor) : getSectionAt(visualSection, 0),
    [content, cursor, mode, path, sourceMode, visualSection],
  );
  const sectionStats = useMemo(() => (section ? cardStats(section.text) : null), [section]);
  const calibration = useMemo(() => {
    try { return { profile: calibrateReading(settings.readingSamples), error: '' }; }
    catch (error) { return { profile: null, error: error.message }; }
  }, [settings.readingSamples]);

  useEffect(() => {
    if (!docStats) return onCursorStats(null);
    const wpm = settings.wpm || 250;
    const profile = calibration.profile;
    const assessment = readingAssessment(docStats, wpm, profile);
    const parts = {
      cards: t('{count} cards', { count: docStats.cards }),
      words: t('{count} words', { count: docStats.words }),
      highlighted: t('{count} highlighted (~{time} read)', { count: docStats.highlighted, time: formatDuration(assessment.seconds) }),
      estimate: t(profile ? 'Personal speech estimate' : 'Default speech estimate'),
    };
    if (assessment.readingEase !== null) parts.readability = t('Readability {score} / effort {effort}', {
      score: assessment.readingEase.toFixed(0), effort: assessment.effort.toFixed(0),
    });
    if (calibration.error) parts.error = calibration.error;
    if (section && sectionStats) {
      parts.section = t('“{title}”: {count} hl / ~{time}', {
        title: section.title.slice(0, 30), count: sectionStats.highlighted,
        time: formatDuration(readingSeconds(sectionStats, wpm, profile)),
      });
    }
    onCursorStats(parts);
  }, [docStats, sectionStats, section, settings.wpm, calibration, onCursorStats, locale]);

  const commitTitle = () => {
    const t = title.trim();
    if (t && t !== baseName(path)) onRename(path, t);
    else setTitle(baseName(path));
  };

  if (isFlow(path)) {
    return (
      <div className="note-view">
        <div className="note-header">
          <input className="note-title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={commitTitle}
            onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
          <div className="note-actions">
            <button onClick={onOpenHistory}>{t('History')}</button>
            <select aria-label={t('Flow mode')} value={mode === 'edit' ? 'source' : 'visual'}
              onChange={(event) => setMode(event.target.value === 'source' ? 'edit' : 'visual')}>
              <option value="visual">{t('Visual')}</option>
              <option value="source">{t('JSON source')}</option>
            </select>
          </div>
        </div>
        <FlowEditor path={path} mode={mode} content={content} onChange={onChange} onRestore={onRestore}
          focusNewFlowRow={settings.focusNewFlowRow} keybindings={settings.keybindings} />
      </div>
    );
  }

  return (
    <div className="note-view">
      <div className="note-header">
        <input
          className="note-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
        />
        <div className="note-actions">
          <button onClick={onOpenHistory}>{t('History')}</button>
          <select aria-label={t('Editor mode')} value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="visual">{t('Visual')}</option>
            <option value="edit">{t('Source')}</option>
            <option value="read">{t('Read')}</option>
          </select>
          <button onClick={onExport}>{t('Export')}</button>
          {onTestHypothesis && <button title={t('Test a hypothesis against this note (Political DEBATE)')}
            onClick={onTestHypothesis}>{t('Hypothesis')}</button>}
          {onSummarize && <button onClick={onSummarize}>{t('Summarize')}</button>}
          {mode !== 'read' && <button onClick={onCreateCitation}>
            {t('Create citation')}
          </button>}
          {mode === 'read' && (
            <button
              className={`icon-btn${highlightOnly ? ' active' : ''}`}
              title={t('Show highlighted text only')}
              onClick={() => setHighlightOnly(!highlightOnly)}
            >
              <Icon name="highlighter" />
            </button>
          )}
          {mode !== 'read' && (
            <button className="icon-btn" title={`${t('Send card')} ${displayBinding(binding('send-card', settings.keybindings))}`} onClick={sendCurrent}>
              <Icon name="send" />
            </button>
          )}
          <button
            className="icon-btn"
            title={`${t(mode !== 'read' ? 'Read' : 'Edit')} ${displayBinding(binding('toggle-mode', settings.keybindings))}`}
            onClick={() => setMode(mode !== 'read' ? 'read' : settings.editorMode)}
          >
            <Icon name={mode !== 'read' ? 'eye' : 'edit'} />
          </button>
        </div>
      </div>
      {mode === 'visual' && !blocker && !settings.internalFlags?.visualNoticeDismissed && <div className="editor-notice dismissible-notice">
        <span>{t('Visual edits normalize Markdown formatting. Source mode preserves exact syntax. Ctrl+click a wiki link to follow it.')}</span>
        <button className="icon-btn" aria-label={t('Dismiss visual editor notice')} onClick={onDismissVisualNotice}>&times;</button>
      </div>}
      {blocker && <div className="editor-notice source-fallback" role="status">
        {t('This note contains {kind}. Showing source to preserve it; visual mode will not rewrite this note.', { kind: t(blocker) })}
      </div>}
      {metadata?.error && <div className="editor-notice error-text" role="alert">
        {t('Invalid YAML frontmatter: {error}', { error: metadata.error })}
      </div>}
      {!sourceMode && metadata?.raw !== null && metadata?.prefix && <details className="note-properties">
        <summary>{t('Properties')}</summary>
        <pre>{metadata.raw}</pre>
        <button onClick={() => setMode('edit')}>{t('Edit properties in Source')}</button>
      </details>}
      <div className={`note-body${settings.readableWidth ? ' readable' : ''}${settings.editorFocusOutline ? ' editor-focus-outline' : ''}`}>
        {sourceMode ? (
          <Editor
            jump={jump?.path === path ? jump : null}
            keybindings={settings.keybindings}
            settings={settings}
            value={content}
            onChange={onChange}
            noteNames={noteNames}
            onOpenLink={onOpenLink}
            onSendCard={onSendCard}
            onCursor={setCursor}
            viewRef={viewRef}
          />
        ) : mode === 'visual' ? (
          <VisualEditor value={content} onChange={onChange} onOpenLink={onOpenLink}
            spellcheck={settings.visualSpellcheck}
            onReady={onVisualEditorReady}
            keybindings={settings.keybindings}
            onSendCard={sendCurrent} onSection={setVisualSection} noteNames={noteNames} visualRef={visualRef}
            jump={jump?.path === path ? jump : null} toolbarVisible={settings.visualToolbar} />
        ) : (
          <Preview
            content={content}
            resolve={resolve}
            onOpenLink={onOpenLink}
            onTagClick={onTagClick}
            highlightOnly={highlightOnly}
            scrollTo={jump && jump.path === path ? jump : null}
          />
        )}
      </div>
    </div>
  );
}
