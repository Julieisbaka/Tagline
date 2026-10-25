import { json } from '@codemirror/lang-json';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import CodeMirror from '@uiw/react-codemirror';
import { useMemo } from 'react';
import { settingsCodeMirrorTheme } from '../lib/editorExtensions.js';

const extensions = [json(), syntaxHighlighting(HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--accent)' },
  { tag: tags.string, color: 'var(--text-strong)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--code)' },
  { tag: tags.punctuation, color: 'var(--text-muted)' },
])), settingsCodeMirrorTheme, EditorView.lineWrapping];

export default function JsonEditor({ label, ...props }) {
  const labeled = useMemo(() => [...extensions,
  EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'true' }),
  ], [label]);
  return <CodeMirror {...props} extensions={labeled} theme="none"
    basicSetup={{ highlightActiveLine: false, highlightActiveLineGutter: false }} />;
}
