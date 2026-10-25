import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.js';
import { splitFrontmatter } from '../lib/frontmatter.js';
import { binding, KEYBINDINGS, matchesBinding } from '../lib/keybindings.js';
import { slugify } from '../lib/markdown.js';
import { cachedDocument, cacheDocument } from '../lib/visualCache.js';
import { visualExtensions } from '../lib/visualExtensions.js';
import { visualSelection } from '../lib/visualHelpers.js';
import VisualFindReplace from './VisualFindReplace.jsx';
import EditorToolbar from './EditorToolbar.jsx';
import EditorLinkForm from './EditorLinkForm.jsx';

export default function VisualEditor({
  value, onChange, onOpenLink, onSendCard, onSection, noteNames, visualRef, jump, keybindings,
  toolbarVisible = true, onReady,
}) {
  const metadata = useMemo(() => splitFrontmatter(value), [value]);
  const live = useRef({});
  live.current = {
    onChange: (body) => onChange(metadata.prefix +
      (metadata.prefix && !metadata.prefix.endsWith('\n') && body ? '\n' : '') + body),
    onOpenLink, onSendCard, onSection, keybindings,
  };
  return <MemoizedDocument value={metadata.body} noteNames={noteNames} visualRef={visualRef} jump={jump}
    live={live} keybindings={keybindings} toolbarVisible={toolbarVisible} onReady={onReady} />;
}

function VisualDocument({ value, noteNames, visualRef, jump, live, keybindings, toolbarVisible, onReady }) {
  const { t } = useI18n();
  const lastMarkdown = useRef(value);
  const lastProp = useRef(value);
  const initialContent = useRef(null);
  if (!initialContent.current) {
    const cached = cachedDocument(value);
    initialContent.current = { content: cached || value, contentType: cached ? 'json' : 'markdown' };
  }
  const extensions = useMemo(visualExtensions, []);
  const [linkOpen, setLinkOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
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
      attributes: {
        class: 'markdown-body visual-document', role: 'textbox',
        'aria-multiline': 'true', 'aria-label': t('Visual note editor')
      },
      handleClick(view, pos, event) {
        const link = event.target.closest('[data-wiki-link]');
        if (link && (event.ctrlKey || event.metaKey)) {
          live.current.onOpenLink(link.dataset.target, link.dataset.heading, event.shiftKey);
          return true;
        }
        return false;
      },
      handleKeyDown(view, event) {
        if (event.isComposing) return false;
        const command = KEYBINDINGS.find((item) => item.scope === 'editor' &&
          matchesBinding(event, binding(item.id, live.current.keybindings)));
        if (command) {
          event.preventDefault();
          const ed = visualRef.current;
          const cmd = ed.commands;
          const heading = ['pocket', 'hat', 'block', 'tag'].indexOf(command.id);
          if (command.id === 'find') setFindOpen(true);
          else if (heading >= 0) cmd.toggleHeading({ level: heading + 1 });
          else if (['bold', 'cite'].includes(command.id)) cmd.toggleBold();
          else if (command.id === 'italic') cmd.toggleItalic();
          else if (['underline', 'underline-alt'].includes(command.id)) cmd.toggleUnderline();
          else if (command.id === 'emphasis') ed.chain().toggleBold().toggleUnderline().run();
          else if (command.id === 'highlight') cmd.toggleHighlight();
          else if (command.id === 'clear-format') cmd.unsetAllMarks();
          return true;
        }
        // Suppress old primary bindings after remapping or removing them.
        if (KEYBINDINGS.some((item) => item.scope === 'editor' && matchesBinding(event, item.key))) return true;
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
    onReady?.(editor);
    return () => {
      if (visualRef.current === editor) visualRef.current = null;
      onReady?.(null);
    };
  }, [editor, visualRef, onReady]);

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
  const insertLink = (target) => {
    const m = /^([^\]|#]+)(?:#([^\]|]*))?(?:\|([^\]]*))?$/.exec(target);
    editor.chain().focus().insertContent({
      type: 'wikiLink', attrs: {
        target: m[1], heading: m[2] || '', alias: m[3] || '', embed: false,
      }
    }).run();
    setLinkOpen(false);
  };
  return (
    <div className="visual-editor">
      {toolbarVisible && <EditorToolbar keybindings={keybindings} active={{
        ...Object.fromEntries(['pocket', 'hat', 'block', 'tag'].map((id, index) =>
          [id, editor.isActive('heading', { level: index + 1 })])),
        cite: editor.isActive('bold'), underline: editor.isActive('underline'),
        highlight: editor.isActive('highlight'), find: findOpen, link: linkOpen,
      }} actions={{
        ...Object.fromEntries(['pocket', 'hat', 'block', 'tag'].map((id, index) =>
          [id, () => editor.chain().focus().toggleHeading({ level: index + 1 }).run()])),
        cite: () => editor.chain().focus().toggleBold().run(),
        underline: () => editor.chain().focus().toggleUnderline().run(),
        emphasis: () => editor.chain().focus().toggleBold().toggleUnderline().run(),
        highlight: () => editor.chain().focus().toggleHighlight().run(),
        'clear-format': () => editor.chain().focus().unsetAllMarks().run(),
        link: () => setLinkOpen((open) => !open),
        find: () => setFindOpen((open) => !open),
        'send-card': () => live.current.onSendCard(),
      }} />}
      {findOpen && <VisualFindReplace editor={editor} onClose={() => setFindOpen(false)} />}
      {linkOpen && <EditorLinkForm noteNames={noteNames} onInsert={insertLink}
        onClose={() => { setLinkOpen(false); editor.view.focus(); }} />}
      <EditorContent editor={editor} />
    </div>
  );
}

const MemoizedDocument = memo(VisualDocument);
