import { autocompletion } from '@codemirror/autocomplete';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { Prec } from '@codemirror/state';
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { useMemo, useRef } from 'react';
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
import { binding, editorBinding, KEYBINDINGS } from '../lib/keybindings.js';

export default function Editor({
  value, onChange, noteNames, onOpenLink, onSendCard, onCursor, viewRef, keybindings, settings,
}) {
  // Keep callbacks in a ref so extensions stay stable across renders.
  const cb = useRef({});
  cb.current = { noteNames, onOpenLink, onSendCard, onCursor };

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
      pocket: setHeading(1), hat: setHeading(2), block: setHeading(3), tag: setHeading(4),
      cite: toggleWrap('**'), bold: toggleWrap('**'), italic: toggleWrap('*'),
      underline: toggleWrap('++'), 'underline-alt': toggleWrap('++'),
      emphasis: toggleWrap('**++', '++**'), highlight: toggleWrap('=='), 'clear-format': clearFormatting,
    };
    const debateKeys = Prec.highest(keymap.of(KEYBINDINGS.filter((item) =>
      item.scope === 'editor' && binding(item.id, keybindings)).map((item) => ({
        key: editorBinding(binding(item.id, keybindings)), run: actions[item.id],
      }))));

    return [
      search({ top: true, createPanel: createCodeMirrorFindReplacePanel }),
      keymap.of(searchKeymap.filter((item) => item.key !== 'Mod-f')),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      ...(settings.sourceLineNumbers ? [lineNumbers()] : []),
      ...(settings.sourceLineWrapping ? [EditorView.lineWrapping] : []),
      ...(settings.sourceActiveLine ? [highlightActiveLine()] : []),
      ...(settings.sourceActiveLine && settings.sourceLineNumbers ? [highlightActiveLineGutter()] : []),
      ...(settings.sourceAutocomplete ? [autocompletion({ override: [wikiComplete] })] : []),
      debateKeys,
      ...debateDecorations,
      ...editorTheme,
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
  }, [keybindings, settings.sourceActiveLine, settings.sourceAutocomplete, settings.sourceLineNumbers, settings.sourceLineWrapping]);

  return (
    <CodeMirror
      className="editor"
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme="none"
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        autocompletion: false,
        searchKeymap: false,
      }}
      onCreateEditor={(view) => {
        if (viewRef) viewRef.current = view;
        applicationEvents.emit('editor.ready', { mode: 'edit' });
      }}
      height="100%"
      autoFocus
    />
  );
}
