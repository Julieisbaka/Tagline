import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import Editor from './Editor.jsx';
import Preview from './Preview.jsx';
import FlowEditor from './FlowEditor.jsx';
import VisualEditor from './VisualEditor.jsx';
import { visualBlocker, visualSelection } from '../lib/visualExtensions.js';
import Icon from './Icon.jsx';
import { baseName, isFlow } from '../lib/vault.js';
import { cardStats, formatDuration, getSectionAt } from '../lib/card.js';
import { readingSeconds } from '../lib/readTime.js';
import { useI18n } from '../lib/i18n.js';
import { binding, displayBinding } from '../lib/keybindings.js';

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
  onExport,
  onCreateCitation,
  settings,
  onDismissVisualNotice,
}) {
  const { t, locale } = useI18n();
  const localRef = useRef(null);
  const viewRef = editorRef || localRef;
  const blocker = mode === 'visual' ? visualBlocker(content) : null;
  const sourceMode = mode === 'edit' || !!blocker;
  const sendCurrent = () => sourceMode
    ? onSendCard(cursor, '')
    : onSendCard(0, visualRef.current ? visualSelection(visualRef.current) : '');
  const [cursor, setCursorState] = useState(0);
  const [visualSection, setVisualSection] = useState('');
  const setCursor = (pos) => {
    setCursorState(pos);
    onCursor?.(pos);
  };
  const [title, setTitle] = useState(baseName(path));
  useEffect(() => setTitle(baseName(path)), [path]);

  // Jump to a line (edit mode) or heading (read mode) when requested.
  useEffect(() => {
    if (!jump || jump.path !== path) return;
    const view = viewRef.current;
    if ((mode === 'edit' || blocker) && view && jump.line != null) {
      const line = view.state.doc.line(Math.min(jump.line + 1, view.state.doc.lines));
      view.dispatch({
        selection: EditorSelection.cursor(line.from),
        effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 40 }),
      });
      view.focus();
    }
  }, [jump, path, mode, blocker]);

  // Status-bar stats: whole document plus the card under the cursor.
  const docStats = useMemo(() => (isFlow(path) ? null : cardStats(content)), [content, path]);
  const section = useMemo(
    () => isFlow(path) || mode === 'read' ? null : sourceMode
      ? getSectionAt(content, cursor) : getSectionAt(visualSection, 0),
    [content, cursor, mode, path, sourceMode, visualSection],
  );
  const sectionStats = useMemo(() => (section ? cardStats(section.text) : null), [section]);

  useEffect(() => {
    if (!docStats) return onCursorStats(null);
    const wpm = settings.wpm || 250;
    const parts = [
      t('{count} cards', { count: docStats.cards }),
      t('{count} words', { count: docStats.words }),
      t('{count} highlighted (~{time} read)', { count: docStats.highlighted, time: formatDuration(readingSeconds(docStats, wpm)) }),
    ];
    if (section && sectionStats) {
      parts.unshift(t('“{title}”: {count} hl / ~{time}', {
        title: section.title.slice(0, 30), count: sectionStats.highlighted,
        time: formatDuration(readingSeconds(sectionStats, wpm)),
      }));
    }
    onCursorStats(parts);
  }, [docStats, sectionStats, section, settings.wpm, onCursorStats, locale]);

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
        </div>
        <FlowEditor content={content} onChange={onChange} focusNewFlowRow={settings.focusNewFlowRow} keybindings={settings.keybindings} />
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
          <select aria-label={t('Editor mode')} value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="visual">{t('Visual')}</option>
            <option value="edit">{t('Source')}</option>
            <option value="read">{t('Read')}</option>
          </select>
          <button onClick={onExport}>{t('Export')}</button>
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
      <div className={`note-body${settings.readableWidth ? ' readable' : ''}`}>
        {sourceMode ? (
          <Editor
            keybindings={settings.keybindings}
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
            keybindings={settings.keybindings}
            onSendCard={sendCurrent} onSection={setVisualSection} noteNames={noteNames} visualRef={visualRef}
            jump={jump?.path === path ? jump : null} />
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
