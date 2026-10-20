import { autocompletion } from '@codemirror/autocomplete';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { useMemo, useRef } from 'react';
import {
  clearFormatting,
  debateDecorations,
  editorTheme,
  linkAt,
  setHeading,
  toggleWrap,
} from '../lib/editorExtensions.js';

export default function Editor({ value, onChange, noteNames, onOpenLink, onSendCard, onCursor, viewRef }) {
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

    const sendCard = (view) => {
      cb.current.onSendCard?.(view.state.selection.main.head, view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to,
      ));
      return true;
    };

    const debateKeys = Prec.highest(
      keymap.of([
        { key: 'F4', run: setHeading(1) },
        { key: 'F5', run: setHeading(2) },
        { key: 'F6', run: setHeading(3) },
        { key: 'F7', run: setHeading(4) },
        { key: 'F8', run: toggleWrap('**') },
        { key: 'F9', run: toggleWrap('++') },
        { key: 'F10', run: toggleWrap('**++', '++**') },
        { key: 'F11', run: toggleWrap('==') },
        { key: 'F12', run: clearFormatting },
        { key: 'Mod-b', run: toggleWrap('**') },
        { key: 'Mod-i', run: toggleWrap('*') },
        { key: 'Mod-u', run: toggleWrap('++') },
        { key: 'Mod-Shift-h', run: toggleWrap('==') },
        { key: 'Mod-Shift-s', run: sendCard },
      ]),
    );

    return [
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      EditorView.lineWrapping,
      autocompletion({ override: [wikiComplete] }),
      debateKeys,
      ...debateDecorations,
      ...editorTheme,
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
      }),
    ];
  }, []);

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
        searchKeymap: true,
      }}
      onCreateEditor={(view) => {
        if (viewRef) viewRef.current = view;
      }}
      height="100%"
      autoFocus
    />
  );
}
