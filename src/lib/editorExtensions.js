// CodeMirror extensions: debate formatting commands, inline decorations, theme.
import { EditorView, Decoration, ViewPlugin, MatchDecorator } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

export function setHeading(level) {
  return (view) => {
    const { state } = view;
    const changes = [];
    const seen = new Set();
    for (const range of state.selection.ranges) {
      for (let pos = range.from; pos <= range.to; ) {
        const line = state.doc.lineAt(pos);
        if (!seen.has(line.number)) {
          seen.add(line.number);
          const m = line.text.match(/^#{1,6}\s+/);
          const current = m ? m[0].trim().length : 0;
          const prefix = current === level ? '' : '#'.repeat(level) + ' ';
          changes.push({ from: line.from, to: line.from + (m ? m[0].length : 0), insert: prefix });
        }
        pos = line.to + 1;
      }
    }
    view.dispatch({ changes });
    return true;
  };
}

// Toggle wrapping the selection in open/close markers (e.g. "==" for highlight).
export function toggleWrap(open, close = open) {
  return (view) => {
    const { state } = view;
    const tr = state.changeByRange((range) => {
      const text = state.sliceDoc(range.from, range.to);
      const before = state.sliceDoc(range.from - open.length, range.from);
      const after = state.sliceDoc(range.to, range.to + close.length);
      if (before === open && after === close) {
        return {
          changes: [
            { from: range.from - open.length, to: range.from },
            { from: range.to, to: range.to + close.length },
          ],
          range: EditorSelection.range(range.from - open.length, range.to - open.length),
        };
      }
      if (text.startsWith(open) && text.endsWith(close) && text.length >= open.length + close.length) {
        const inner = text.slice(open.length, text.length - close.length);
        return {
          changes: { from: range.from, to: range.to, insert: inner },
          range: EditorSelection.range(range.from, range.from + inner.length),
        };
      }
      return {
        changes: { from: range.from, to: range.to, insert: open + text + close },
        range: EditorSelection.range(range.from + open.length, range.to + open.length),
      };
    });
    view.dispatch(tr);
    return true;
  };
}

export function clearFormatting(view) {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    const cleaned = text.replace(/==|\+\+|\*\*/g, '');
    return {
      changes: { from: range.from, to: range.to, insert: cleaned },
      range: EditorSelection.range(range.from, range.from + cleaned.length),
    };
  });
  view.dispatch(tr);
  return true;
}

function markPlugin(regexp, cls) {
  const decorator = new MatchDecorator({ regexp, decoration: Decoration.mark({ class: cls }) });
  return ViewPlugin.define(
    (view) => ({
      decorations: decorator.createDeco(view),
      update(u) {
        this.decorations = decorator.updateDeco(u, this.decorations);
      },
    }),
    { decorations: (v) => v.decorations },
  );
}

export const debateDecorations = [
  markPlugin(/==(?=\S)[^\n]*?\S==/g, 'cm-debate-highlight'),
  markPlugin(/\+\+(?=\S)[^\n]*?\S\+\+/g, 'cm-debate-underline'),
  markPlugin(/!?\[\[[^\]\n]+\]\]/g, 'cm-wikilink'),
  markPlugin(/(?<=^|\s)#[A-Za-z][\w/-]*/g, 'cm-hashtag'),
];

// Return the [[link]] target under a document position, if any.
export function linkAt(state, pos) {
  const line = state.doc.lineAt(pos);
  const re = /\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?\]\]/g;
  for (const m of line.text.matchAll(re)) {
    const from = line.from + m.index;
    if (pos >= from && pos <= from + m[0].length) return { target: m[1].trim(), heading: (m[2] || '').slice(1) };
  }
  return null;
}

const highlightStyle = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.7em', fontWeight: '700', color: 'var(--h1)' },
  { tag: t.heading2, fontSize: '1.45em', fontWeight: '700', color: 'var(--h2)' },
  { tag: t.heading3, fontSize: '1.25em', fontWeight: '700', color: 'var(--h3)' },
  { tag: t.heading4, fontSize: '1.1em', fontWeight: '700', color: 'var(--h4)' },
  { tag: [t.heading5, t.heading6], fontWeight: '700' },
  { tag: t.strong, fontWeight: '700', color: 'var(--text-strong)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--text-muted)' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)', color: 'var(--code)' },
  { tag: t.quote, color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--text-faint)' },
  { tag: t.list, color: 'var(--accent)' },
]);

export const editorTheme = [
  EditorView.theme(
    {
      '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--text)' },
      '.cm-scroller': { fontFamily: 'var(--font-text)', fontSize: 'var(--editor-font-size)', lineHeight: '1.6' },
      '.cm-content': { padding: '24px 0 40vh', caretColor: 'var(--accent)' },
      '.cm-line': { padding: '0 4px' },
      '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
        backgroundColor: 'var(--selection) !important',
      },
      '.cm-activeLine': { backgroundColor: 'transparent' },
      '.cm-gutters': { display: 'none' },
      '.cm-tooltip': { background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text)' },
      '.cm-tooltip-autocomplete ul li[aria-selected]': { background: 'var(--accent-dim)', color: 'var(--text)' },
    },
    { dark: true },
  ),
  syntaxHighlighting(highlightStyle),
];
