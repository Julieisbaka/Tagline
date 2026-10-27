import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import { splitFrontmatter } from './frontmatter.js';

/** 
 * Escape text for insertion into HTML markup.
 * This function replaces special characters in the input string with their corresponding HTML entities to prevent HTML injection and ensure safe rendering within HTML content.
 * @param {string} s - The input string to escape.
 * @returns {string} - The escaped string safe for HTML insertion.
 */
const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Create a link extension bound to the resolver for one Markdown render. @param {function} resolver @returns {object} */
const createWikilinkExtension = (resolver) => ({
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
});

/** 
 * Create a Marked inline extension for a paired debate-formatting delimiter.
 * This function generates a custom inline extension for the Marked parser that recognizes a specific paired delimiter (e.g., == for highlights) and wraps the enclosed content in the specified HTML tag with an optional CSS class.
 * @param {string} name - The name of the extension.
 * @param {string} delim - The delimiter string that marks the start and end of the inline content.
 * @param {string} tag - The HTML tag to wrap the content with.
 * @param {string} [cls] - An optional CSS class to apply to the wrapping tag.
 * @returns {object} - The Marked inline extension object.
 */
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

/** Create a parser configured with render-scoped internal-link resolution. @param {function} resolver @returns {Marked} */
export const createMarkdownParser = (resolver) => {
  const parser = new Marked({
    gfm: true,
    breaks: true,
    extensions: [
      createWikilinkExtension(resolver),
      makeWrap('highlight', '==', 'mark'),
      makeWrap('underline', '++', 'u'),
      tag,
    ],
  });
  // Headings get stable ids so outline / [[Note#Heading]] can scroll to them.
  parser.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const id = slugify(DOMPurify.sanitize(text, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }));
        return `<h${depth} id="${id}" class="debate-h${depth}">${text}</h${depth}>\n`;
      },
    },
  });
  return parser;
};

/** 
 * Create a stable lowercase Markdown heading anchor slug.
 * This function generates a URL-friendly slug from the given heading text by converting it to lowercase, removing HTML entities and non-word characters, trimming whitespace, and replacing spaces with hyphens. It is used to assign consistent IDs to Markdown headings for linking and navigation purposes.
 * @param {string} text - The heading text to convert into a slug.
 * @returns {string} - The generated slug suitable for use as an HTML ID.
 */
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/&[a-z]+;/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** 
 * Render Tagline Markdown to sanitized HTML, resolving internal links with an optional callback.
 * This function takes a Markdown string, parses it into HTML using the Marked parser with custom extensions, and then sanitizes the resulting HTML using DOMPurify to prevent XSS and other security issues. An optional resolver callback can be provided to handle internal link resolution.
 * @param {string} src - The Markdown source string to render.
 * @param {function} [resolve] - An optional callback function to resolve internal links.
 * @returns {string} - The sanitized HTML output.
 */
export function renderMarkdown(src, resolve) {
  const parser = createMarkdownParser(resolve || (() => null));
  const html = parser.parse(splitFrontmatter(src || '').body);
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'],
    FORBID_ATTR: ['style', 'srcset'],
    ADD_ATTR: ['target'],
  });
}
