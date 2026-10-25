import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import { splitFrontmatter } from './frontmatter.js';

let resolver = () => null;

const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const wikilink = {
  name: 'wikilink',
  level: 'inline',
  start: (src) => src.match(/!?\[\[/)?.index,
  tokenizer(src) {
    const m = /^(!?)\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/.exec(src);
    if (!m) return undefined;
    return { type: 'wikilink', raw: m[0], embed: !!m[1], target: m[2].trim(), heading: m[3] || '', alias: m[4] };
  },
  renderer(tok) {
    const resolved = resolver(tok.target);
    const label = escapeHtml(tok.alias || tok.target + tok.heading.replace('#', ' › '));
    const cls = resolved ? 'internal-link' : 'internal-link unresolved';
    return `<a class="${cls}" data-href="${escapeHtml(tok.target)}" data-heading="${escapeHtml(tok.heading.slice(1))}">${label}</a>`;
  },
};

const makeWrap = (name, delim, tag, cls = '') => {
  const d = delim.replace(/[+=]/g, '\\$&');
  const re = new RegExp(`^${d}(?=\\S)([\\s\\S]*?\\S)${d}`);
  return {
    name,
    level: 'inline',
    start: (src) => {
      const i = src.indexOf(delim);
      return i === -1 ? undefined : i;
    },
    tokenizer(src) {
      const m = re.exec(src);
      if (!m) return undefined;
      return { type: name, raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
    },
    renderer(tok) {
      return `<${tag}${cls ? ` class="${cls}"` : ''}>${this.parser.parseInline(tok.tokens)}</${tag}>`;
    },
  };
};

const tag = {
  name: 'tag',
  level: 'inline',
  start: (src) => src.match(/(^|\s)#[A-Za-z]/)?.index,
  tokenizer(src) {
    const m = /^(\s?)#([A-Za-z][\w/-]*)/.exec(src);
    if (!m) return undefined;
    return { type: 'tag', raw: m[0], lead: m[1], tag: m[2] };
  },
  renderer(tok) {
    return `${tok.lead}<a class="tag" data-tag="${escapeHtml(tok.tag.toLowerCase())}">#${escapeHtml(tok.tag)}</a>`;
  },
};

const marked = new Marked({
  gfm: true,
  breaks: true,
  extensions: [wikilink, makeWrap('highlight', '==', 'mark'), makeWrap('underline', '++', 'u'), tag],
});

// Headings get stable ids so outline / [[Note#Heading]] can scroll to them.
marked.use({
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      const id = slugify(DOMPurify.sanitize(text, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }));
      return `<h${depth} id="${id}" class="debate-h${depth}">${text}</h${depth}>\n`;
    },
  },
});

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/&[a-z]+;/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

export function renderMarkdown(src, resolve) {
  resolver = resolve || (() => null);
  const html = marked.parse(splitFrontmatter(src || '').body);
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'],
    FORBID_ATTR: ['style', 'srcset'],
    ADD_ATTR: ['target'],
  });
}
