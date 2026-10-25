import { json } from '@codemirror/lang-json';
import { codeFolding, HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
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

export default function JsonEditor({ label, settings, ...props }) {
  const labeled = useMemo(() => [...extensions,
  ...(settings ? [
    EditorState.tabSize.of(settings.sourceTabSize),
    indentUnit.of(settings.sourceIndentWithTabs ? '\t' : ' '.repeat(settings.sourceTabSize)),
    ...(settings.sourceCodeFolding ? [codeFolding()] : []),
  ] : []),
  EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'true' }),
  ], [label, settings?.sourceTabSize, settings?.sourceIndentWithTabs, settings?.sourceCodeFolding]);
  return <CodeMirror {...props} extensions={labeled} theme="none"
    basicSetup={{ highlightActiveLine: false, highlightActiveLineGutter: false,
      ...(settings ? {
        bracketMatching: settings.sourceBracketMatching, closeBrackets: settings.sourceCloseBrackets,
        closeBracketsKeymap: settings.sourceCloseBrackets,
        foldGutter: settings.sourceCodeFolding, foldKeymap: settings.sourceCodeFolding,
      } : {}),
    }} />;
}
