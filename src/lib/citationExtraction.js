import { Marked } from 'marked';
import { parseDate } from './calendar.js';

const markdown = new Marked({ gfm: true, breaks: true });
const BOLD_LEAD = /^ {0,3}(\*\*|__)(?=\S)(.+?)\1(.*)$/;
const YEAR_LEAD = /^(.+?)[,\s]+(?:\((\d{2}|\d{4})\)|(\d{2}|\d{4}))(?=$|[ \t]*[,.;:–—"(-])/u;
const FULL_YEAR = /\b(?:19|20)\d{2}\b/;
const URL = /https?:\/\/[^\s<>()]+(?:\([^\s()]*\)[^\s<>()]*)*/i;
const MARKDOWN_LINK = /\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/i;
const TITLE = /"((?:[^"\\]|\\.)+)"/;
const ACCESS = /\bAccessed\s+([^,\n]+)/i;
const unescape = (value) => value.replace(/\\(.)/g, '$1').trim();

/**
 * Extract a citation candidate from a card body, ignoring Markdown code,
 * blockquotes, lists and HTML blocks. Explicit source text is retained; fields
 * whose meaning cannot be determined confidently are listed as uncertain.
 *
 * @param {string} body Markdown after a card heading.
 * @returns {{citation: object|null, uncertainFields: string[]}}
 */
export function extractCardCitation(body) {
  let firstContent = true;
  for (const token of markdown.lexer(body.replace(/\r\n?/g, '\n'))) {
    if (token.type === 'space' || (token.type === 'html' && /^ {0,3}<!--/.test(token.raw))) continue;
    if (token.type === 'heading') continue;
    if (token.type !== 'paragraph' && token.type !== 'text') {
      firstContent = false;
      continue;
    }
    for (const line of token.raw.split('\n')) {
      if (!line.trim()) continue;
      const bold = line.match(BOLD_LEAD);
      const plain = line.trim();
      const lead = bold ? bold[2] : plain;
      const year = lead.match(YEAR_LEAD);
      const remainder = bold ? bold[3].trim() : '';
      const signal = !!year || FULL_YEAR.test(lead + ' ' + remainder) ||
        URL.test(lead + ' ' + remainder) || /\bAccessed\b/i.test(remainder);
      const unformatted = !bold && !!year && (TITLE.test(plain) || URL.test(plain));
      if ((bold && (signal || (firstContent && !remainder))) || unformatted) {
        return parseCitation(lead, remainder);
      }
      firstContent = false;
    }
  }
  return { citation: null, uncertainFields: [] };
}

function parseCitation(lead, suffix) {
  const citation = { author: '', year: '', title: '', publication: '', url: '', accessed: '' };
  const uncertain = new Set();
  const match = lead.match(YEAR_LEAD);
  let details = suffix;
  if (match) {
    citation.author = unescape(match[1]);
    const year = match[2] || match[3];
    if (/^(?:19|20)\d{2}$/.test(year)) citation.year = year;
    else uncertain.add('year');
    details = `${lead.slice(match[0].length)} ${suffix}`.trim();
  } else {
    citation.author = unescape(lead);
    if (citation.author) uncertain.add('author');
    if (/\b\d{2,4}\b/.test(lead)) uncertain.add('year');
  }

  const title = details.match(TITLE);
  const ambiguousTitle = title && details.replace(title[0], '').includes('"');
  if (ambiguousTitle) uncertain.add('title');
  else if (title) citation.title = unescape(title[1]);
  const link = details.match(MARKDOWN_LINK);
  const bareUrl = details.match(URL);
  if (link || bareUrl) citation.url = (link ? link[1] : bareUrl[0]).replace(/[.,;]+$/, '');
  else if (/\[[^\]]+\](?:\[[^\]]*\]|\([^)]+\))/.test(details)) uncertain.add('url');
  const access = details.match(ACCESS);
  if (access) {
    const value = unescape(access[1]);
    if (parseDate(value)) citation.accessed = value;
    else uncertain.add('accessed');
  }
  let remaining = details;
  if (title) remaining = remaining.replace(title[0], '');
  if (link) remaining = remaining.replace(link[0], '');
  else if (bareUrl) remaining = remaining.replace(bareUrl[0], '');
  if (access) remaining = remaining.replace(access[0], '');
  remaining = remaining.replace(/^[\s,.;:–—-]+|[\s,.;:–—-]+$/g, '').trim();
  if (remaining) {
    if (title && !ambiguousTitle && !/\b(?:19|20)\d{2}\b/.test(remaining)) citation.publication = unescape(remaining);
    else uncertain.add('publication');
  }
  return { citation, uncertainFields: [...uncertain] };
}
