import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core';
import Highlight from '@tiptap/extension-highlight';
import { TableKit } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';

export const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return { target: { default: '' }, heading: { default: '' }, alias: { default: '' }, embed: { default: false } };
  },
  parseHTML() {
    return [{
      tag: 'span[data-wiki-link]', getAttrs: (el) => ({
        target: el.dataset.target, heading: el.dataset.heading,
        alias: el.dataset.alias, embed: el.dataset.embed === 'true',
      })
    }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs;
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-wiki-link': '', 'data-target': a.target, 'data-heading': a.heading,
      'data-alias': a.alias, 'data-embed': String(a.embed), class: 'internal-link',
    }), a.alias || a.target + (a.heading ? ` > ${a.heading}` : '')];
  },
  addInputRules() {
    return [nodeInputRule({
      find: /(!?)\[\[([^\]|#\n]+)(?:#([^\]|\n]*))?(?:\|([^\]\n]*))?\]\]$/,
      type: this.type,
      getAttributes: (m) => ({ target: m[2], heading: m[3] || '', alias: m[4] || '', embed: !!m[1] }),
    })];
  },
  markdownTokenizer: {
    name: 'wikiLink',
    level: 'inline',
    start: (src) => src.search(/!?\[\[/),
    tokenize(src) {
      const m = /^(!?)\[\[([^\]|#]+)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/.exec(src);
      if (m) return { type: 'wikiLink', raw: m[0], target: m[2], heading: m[3] || '', alias: m[4] || '', embed: !!m[1] };
      return undefined;
    },
  },
  parseMarkdown: (token) => ({
    type: 'wikiLink', attrs: {
      target: token.target, heading: token.heading, alias: token.alias, embed: token.embed,
    }
  }),
  renderMarkdown: (node) => {
    const a = node.attrs;
    return `${a.embed ? '!' : ''}[[${a.target}${a.heading ? '#' + a.heading : ''}${a.alias ? '|' + a.alias : ''}]]`;
  },
});

export function visualExtensions() {
  return [
    StarterKit.configure({ link: { openOnClick: false }, trailingNode: false }),
    Highlight, TableKit, TaskList, TaskItem.configure({ nested: true }), WikiLink,
    Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
  ];
}

// Keep unsupported structures in source mode rather than silently deleting them.
export function visualBlocker(content) {
  if (/^---\r?\n[\s\S]*?\r?\n---/.test(content)) return 'YAML frontmatter';
  if (/<!--|<\/?[a-z][^>]*>/i.test(content.replace(/```[\s\S]*?```/g, ''))) return 'embedded HTML';
  if (/^\[\^[^\]]+\]:/m.test(content)) return 'footnotes';
  if (/!\[[^\]]*\]\(/.test(content)) return 'Markdown images';
  if (/^(?:\$\$|:::)/m.test(content)) return 'math or custom fenced blocks';
  return null;
}

const serializeSlice = (editor, from, to) =>
  editor.markdown.serialize({ type: 'doc', content: editor.state.doc.slice(from, to).content.toJSON() || [] });

export function visualSelection(editor, ignoreSelection = false) {
  const { from, to, $from } = editor.state.selection;
  if (!ignoreSelection && from !== to) {
    return serializeSlice(editor, from, to);
  }
  let start = 0;
  let end = editor.state.doc.content.size;
  let level = 7;
  editor.state.doc.forEach((node, offset) => {
    if (offset <= $from.pos && node.type.name === 'heading') {
      start = offset;
      level = node.attrs.level;
    }
  });
  if (level === 7) return '';
  editor.state.doc.forEach((node, offset) => {
    if (offset > start && offset < end && node.type.name === 'heading' && node.attrs.level <= level) end = offset;
  });
  return serializeSlice(editor, start, end);
}
