import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core';
import FindAndReplace from '@tiptap/extension-find-and-replace';
import Highlight from '@tiptap/extension-highlight';
import { TableKit } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';

/** 
 * Tiptap inline atom node representing a parsed internal wiki link.
 * @type {import('@tiptap/core').Node}
 */
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

export const EvidenceCheckupComment = Node.create({
  name: 'evidenceCheckupComment',
  group: 'block',
  atom: true,
  addAttributes() {
    return { category: { default: 'citation' }, text: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-evidence-checkup-comment]', getAttrs: (element) => ({
      category: element.dataset.category, text: element.dataset.text,
    }) }];
  },
  renderHTML({ node }) {
    return ['div', {
      'data-evidence-checkup-comment': '',
      'data-category': node.attrs.category,
      'data-text': node.attrs.text,
      class: 'evidence-editor-comment',
      contenteditable: 'false',
    }, `Evidence checkup: ${node.attrs.text}`];
  },
  markdownTokenizer: {
    name: 'evidenceCheckupComment',
    level: 'block',
    start: (src) => src.indexOf('<!-- Evidence checkup ('),
    tokenize(src) {
      const match = /^<!-- Evidence checkup \((citation|link)\): ([^\r\n]*?) -->(?:\r?\n|$)/.exec(src);
      if (!match) return undefined;
      return { type: 'evidenceCheckupComment', raw: match[0], category: match[1], text: match[2] };
    },
  },
  parseMarkdown: (token) => ({
    type: 'evidenceCheckupComment', attrs: { category: token.category, text: token.text },
  }),
  renderMarkdown: (node) => `<!-- Evidence checkup (${node.attrs.category}): ${node.attrs.text} -->`,
});

/** 
 * Create the Markdown visual-editor extensions used by the app.
 * @returns {object[]} - An array of configured Tiptap extensions.
 */
export function visualExtensions() {
  return [
    StarterKit.configure({ link: { openOnClick: false }, trailingNode: false }),
    Highlight, TableKit, TaskList, TaskItem.configure({ nested: true }), WikiLink, EvidenceCheckupComment,
    FindAndReplace.configure({ injectCSS: false, searchDebounceMs: 0 }),
    Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
  ];
}
