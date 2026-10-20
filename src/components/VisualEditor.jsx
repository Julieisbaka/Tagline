import { useEditor, useEditorState, EditorContent } from '@tiptap/react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { visualExtensions, visualSelection } from '../lib/visualExtensions.js';
import { slugify } from '../lib/markdown.js';
import { cachedDocument, cacheDocument } from '../lib/visualCache.js';
import { useI18n } from '../lib/i18n.js';

export default function VisualEditor({ value, onChange, onOpenLink, onSendCard, onSection, noteNames, visualRef, jump }) {
  const live = useRef({});
  live.current = { onChange, onOpenLink, onSendCard, onSection };
  return <MemoizedDocument value={value} noteNames={noteNames} visualRef={visualRef} jump={jump} live={live} />;
}

function VisualDocument({ value, noteNames, visualRef, jump, live }) {
  const { t } = useI18n();
  const lastMarkdown = useRef(value);
  const lastProp = useRef(value);
  const initialContent = useRef(null);
  if (!initialContent.current) {
    const cached = cachedDocument(value);
    initialContent.current = { content: cached || value, contentType: cached ? 'json' : 'markdown' };
  }
  const extensions = useMemo(visualExtensions, []);
  const [error, setError] = useState('');
  const [linkTarget, setLinkTarget] = useState(null);
  const editor = useEditor({
    shouldRerenderOnTransaction: false,
    extensions,
    ...initialContent.current,
    onCreate({ editor: ed }) {
      cacheDocument(value, ed.getJSON());
      live.current.onSection(visualSelection(ed, true));
    },
    onSelectionUpdate({ editor: ed }) { live.current.onSection(visualSelection(ed, true)); },
    onUpdate({ editor: ed }) {
      const text = ed.getMarkdown();
      lastMarkdown.current = text;
      cacheDocument(text, ed.getJSON());
      live.current.onChange(text);
      live.current.onSection(visualSelection(ed, true));
    },
    editorProps: {
      attributes: { class: 'markdown-body visual-document', 'aria-label': t('Visual note editor') },
      handleClick(view, pos, event) {
        const link = event.target.closest('[data-wiki-link]');
        if (link && (event.ctrlKey || event.metaKey)) {
          live.current.onOpenLink(link.dataset.target, link.dataset.heading, event.shiftKey);
          return true;
        }
        return false;
      },
      handleKeyDown(view, event) {
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 's') {
          event.preventDefault();
          live.current.onSendCard();
          return true;
        }
        return false;
      },
    },
  });
  useEditorState({
    editor,
    selector: ({ editor: ed }) => ed ? [
      ...[1, 2, 3, 4].map((level) => ed.isActive('heading', { level })),
      ed.isActive('bold'), ed.isActive('underline'), ed.isActive('highlight'),
    ] : [],
  });

  useEffect(() => {
    visualRef.current = editor;
    return () => { if (visualRef.current === editor) visualRef.current = null; };
  }, [editor, visualRef]);

  useEffect(() => {
    if (!editor || value === lastProp.current) return;
    lastProp.current = value;
    if (value !== lastMarkdown.current) {
      const cached = cachedDocument(value);
      editor.commands.setContent(cached || value, { contentType: cached ? 'json' : 'markdown', emitUpdate: false });
      cacheDocument(value, editor.getJSON());
      lastMarkdown.current = value;
      live.current.onSection(visualSelection(editor, true));
    }
  }, [value, editor]);

  useEffect(() => {
    if (!editor || !jump) return;
    const heading = jump.heading;
    if (!heading) return;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading' && slugify(node.textContent) === slugify(heading)) {
        editor.chain().setTextSelection(pos + 1).scrollIntoView().run();
        return false;
      }
      return undefined;
    });
  }, [jump, editor]);

  if (!editor) return null;
  const button = (label, command, active = false, title = label) => (
    <button type="button" title={t(title)} className={active ? 'active' : ''}
      onMouseDown={(e) => e.preventDefault()} onClick={command}>{t(label)}</button>
  );
  const insertLink = () => {
    setError('');
    if (!linkTarget?.trim()) return;
    const m = /^([^\]|#]+)(?:#([^\]|]*))?(?:\|([^\]]*))?$/.exec(linkTarget.trim());
    if (!m) return setError(t('Use Note, Note#Heading, or Note|Label for a wiki link.'));
    editor.chain().focus().insertContent({ type: 'wikiLink', attrs: {
      target: m[1], heading: m[2] || '', alias: m[3] || '', embed: false,
    } }).run();
    setLinkTarget(null);
  };
  return (
    <div className="visual-editor">
      <div className="visual-toolbar" role="toolbar" aria-label={t('Card formatting')}>
        {[['Pocket', 1], ['Hat', 2], ['Block', 3], ['Tag', 4]].map(([label, level]) => (
          <span key={level}>{button(label, () => editor.chain().focus().toggleHeading({ level }).run(),
            editor.isActive('heading', { level }), `${t(label)} (F${level + 3})`)}</span>
        ))}
        {button('Cite / Bold', () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'), 'Cite (F8)')}
        {button('Underline', () => editor.chain().focus().toggleUnderline().run(), editor.isActive('underline'), 'Underline (F9)')}
        {button('Emphasis', () => editor.chain().focus().toggleBold().toggleUnderline().run(), false, 'Emphasis (F10)')}
        {button('Highlight', () => editor.chain().focus().toggleHighlight().run(), editor.isActive('highlight'), 'Highlight (F11)')}
        {button('Link', () => setLinkTarget(''))}
        {button('Send card', () => live.current.onSendCard())}
      </div>
      {linkTarget !== null && <form className="visual-link-form" onSubmit={(e) => { e.preventDefault(); insertLink(); }}>
        <input autoFocus aria-label={t('Wiki link target')} placeholder="Note#Heading|Label" list="visual-note-targets"
          value={linkTarget} onChange={(e) => setLinkTarget(e.target.value)} />
        <datalist id="visual-note-targets">
          {noteNames.map((name, i) => <option key={`${name}-${i}`} value={name} />)}
        </datalist>
        <button type="submit">{t('Insert link')}</button>
        <button type="button" onClick={() => setLinkTarget(null)}>{t('Cancel')}</button>
      </form>}
      {error && <div className="error-text" role="alert">{error}</div>}
      <EditorContent editor={editor} />
    </div>
  );
}

const MemoizedDocument = memo(VisualDocument);
