const { Parser } = require('htmlparser2');
const { download, validateUrl } = require('./citationMetadata.cjs');

const OMIT = new Set(['head', 'script', 'style', 'noscript', 'template', 'svg', 'iframe']);
const BREAKS = new Set([
  'p',
  'div',
  'br',
  'li',
  'section',
  'article',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'tr',
]);

// Parse without loading the page in a browser or executing any of its content.
function articleText(html) {
  const parts = [];
  let hidden = 0;
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (hidden) {
          hidden++;
        } else if (
          OMIT.has(name) ||
          Object.hasOwn(attrs, 'hidden') ||
          /display\s*:\s*none|visibility\s*:\s*hidden/i.test(attrs.style || '')
        ) {
          hidden = 1;
        } else if (BREAKS.has(name)) {
          parts.push('\n');
        }
      },
      ontext(text) {
        if (!hidden) {
          parts.push(text);
        }
      },
      onclosetag(name) {
        if (hidden) {
          hidden--;
        } else if (name !== 'br' && BREAKS.has(name)) {
          parts.push('\n');
        }
      },
    },
    { decodeEntities: true }
  );
  parser.end(html);
  return parts
    .join('')
    .replace(/[\t\r ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchQuoteSource(address) {
  if (typeof address !== 'string' || address.length > 2048) {
    throw new Error('Enter a valid source URL.');
  }
  const result = await download(validateUrl(address), 0, 'article');
  const text = /^text\/plain\b/i.test(result.contentType)
    ? result.html.trim()
    : articleText(result.html);
  if (!text) {
    throw new Error('The source did not contain readable text.');
  }
  return { text, url: result.url };
}

module.exports = { articleText, fetchQuoteSource };
