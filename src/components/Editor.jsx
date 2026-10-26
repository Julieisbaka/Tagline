import { autocompletion } from '@codemirror/autocomplete';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { codeFolding, indentUnit } from '@codemirror/language';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { EditorSelection, EditorState, Prec } from '@codemirror/state';
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createCodeMirrorFindReplacePanel } from '../lib/codeMirrorFindReplace.js';
import {
  clearFormatting,
  debateDecorations,
  editorTheme,
  linkAt,
  setHeading,
  toggleWrap,
} from '../lib/editorExtensions.js';
import { applicationEvents } from '../lib/extensionCapabilities.js';
import { useI18n } from '../lib/i18n.js';
import { binding, editorBinding, KEYBINDINGS } from '../lib/keybindings.js';
import EditorLinkForm from './EditorLinkForm.jsx';
import EditorToolbar from './EditorToolbar.jsx';

const SOURCE_ACTIONS = {
  pocket: setHeading(1), hat: setHeading(2), block: setHeading(3), tag: setHeading(4),
  cite: toggleWrap('**'), bold: toggleWrap('**'), italic: toggleWrap('*'),
  underline: toggleWrap('++'), 'underline-alt': toggleWrap('++'),
  emphasis: toggleWrap('**++', '++**'), highlight: toggleWrap('=='), 'clear-format': clearFormatting,
};

export default function Editor({
  value, onChange, noteNames, onOpenLink, onSendCard, onCursor, viewRef, keybindings, settings, jump,
}) {
  const { t, locale } = useI18n();
  const ownViewRef = useRef(null);
  const [view, setView] = useState(null);
  const [linkOpen, setLinkOpen] = useState(false);
  // Keep callbacks in a ref so extensions stay stable across renders.
  const cb = useRef({});
  cb.current = { noteNames, onOpenLink, onSendCard, onCursor };
  useEffect(() => {
    if (!view || jump?.line == null) return;
    const line = view.state.doc.line(Math.min(jump.line + 1, view.state.doc.lines));
    view.dispatch({
      selection: EditorSelection.cursor(line.from),
      effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 40 }),
    });
    view.focus();
  }, [jump, view]);

  const extensions = useMemo(() => {
    const wikiComplete = (ctx) => {
      const m = ctx.matchBefore(/\[\[[^\]\n]*/);
      if (!m) return null;
      return {
        from: m.from + 2,
        options: cb.current.noteNames.map((n) => ({ label: n, apply: `${n}]]`, type: 'text' })),
        validFor: /^[^\]\n]*$/,
      };
    };

    const actions = {
      find: openSearchPanel,
      ...SOURCE_ACTIONS,
    };
    const debateKeys = Prec.highest(keymap.of(KEYBINDINGS.filter((item) =>
      item.scope === 'editor' && binding(item.id, keybindings)).map((item) => ({
        key: editorBinding(binding(item.id, keybindings)), run: actions[item.id],
      }))));

    return [
      search({ top: true, createPanel: createCodeMirrorFindReplacePanel }),
      keymap.of(searchKeymap.filter((item) => item.key !== 'Mod-f')),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      EditorState.tabSize.of(settings.sourceTabSize),
      indentUnit.of(settings.sourceIndentWithTabs ? '\t' : ' '.repeat(settings.sourceTabSize)),
      ...(settings.sourceCodeFolding ? [codeFolding()] : []),
      ...(settings.sourceLineNumbers ? [lineNumbers()] : []),
      ...(settings.sourceLineWrapping ? [EditorView.lineWrapping] : []),
      ...(settings.sourceActiveLine ? [highlightActiveLine()] : []),
      ...(settings.sourceActiveLine && settings.sourceLineNumbers ? [highlightActiveLineGutter()] : []),
      ...(settings.sourceAutocomplete ? [autocompletion({ override: [wikiComplete] })] : []),
      debateKeys,
      ...debateDecorations,
      ...editorTheme,
      EditorView.contentAttributes.of({ 'aria-label': t('Source note editor'), 'aria-multiline': 'true' }),
      ...(settings.sourceActiveLine ? [EditorView.theme({ '.cm-activeLine': { backgroundColor: 'var(--bg-hover)' } })] : []),
      EditorView.domEventHandlers({
        mousedown(e, view) {
          if (!(e.ctrlKey || e.metaKey)) return false;
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
          const link = pos != null && linkAt(view.state, pos);
          if (!link) return false;
          e.preventDefault();
          cb.current.onOpenLink?.(link.target, link.heading, e.shiftKey);
          return true;
        },
      }),
      EditorView.updateListener.of((u) => {
        if (u.selectionSet || u.docChanged) cb.current.onCursor?.(u.state.selection.main.head);
        if (u.selectionSet) {
          const { from, to } = u.state.selection.main;
          applicationEvents.emit('editor.selectionChanged', { mode: 'edit', selection: { from, to } });
        }
      }),
    ];
  }, [keybindings, settings.sourceActiveLine, settings.sourceAutocomplete, settings.sourceLineNumbers, settings.sourceLineWrapping,
    settings.sourceTabSize, settings.sourceIndentWithTabs, settings.sourceCodeFolding, locale]);

  const run = (command) => () => {
    const view = ownViewRef.current;
    if (!view || view.destroyed) return;
    command(view);
    view.focus();
  };
  return (
    <div className="source-editor">
      {settings.visualToolbar && <EditorToolbar keybindings={keybindings} active={{ link: linkOpen }} actions={{
        ...Object.fromEntries(Object.entries(SOURCE_ACTIONS).map(([id, action]) => [id, run(action)])),
        link: () => setLinkOpen((open) => !open),
        find: () => openSearchPanel(ownViewRef.current),
        'send-card': () => {
          const view = ownViewRef.current;
          const { from, to, head } = view.state.selection.main;
          onSendCard(head, view.state.sliceDoc(from, to));
        },
      }} />}
      {linkOpen && <EditorLinkForm noteNames={noteNames} onClose={() => {
        setLinkOpen(false); ownViewRef.current?.focus();
      }} onInsert={(target) => {
        const view = ownViewRef.current;
        const { from, to } = view.state.selection.main;
        const text = `[[${target}]]`;
        view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
        setLinkOpen(false);
        view.focus();
      }} />}
      <CodeMirror
        className="editor"
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme="none"
        basicSetup={{
          highlightSelectionMatches: settings.sourceSelectionMatches,
          lineNumbers: false,
          foldGutter: settings.sourceCodeFolding,
          foldKeymap: settings.sourceCodeFolding,
          bracketMatching: settings.sourceBracketMatching,
          closeBrackets: settings.sourceCloseBrackets,
          closeBracketsKeymap: settings.sourceCloseBrackets,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          autocompletion: false,
          searchKeymap: false,
        }}
        onCreateEditor={(view) => {
          ownViewRef.current = view;
          setView(view);
          if (viewRef) viewRef.current = view;
          applicationEvents.emit('editor.ready', { mode: 'edit' });
        }}
        height="100%"
        autoFocus
      />
    </div>
  );
}
