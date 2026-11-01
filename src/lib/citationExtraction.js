import { Marked } from 'marked';
import { parseDate } from './calendar.js';

const markdown = new Marked({ gfm: true, breaks: true });
const BOLD_LEAD = /^ {0,3}(\*\*|__)(?=\S)(.+?)\1(.*)$/;
const YEAR_LEAD = /^(.+?)[,\s]+(?:\((\d{2}|\d{4})\)|(\d{2}|\d{4}))(?=$|[ \t]*[,.;:–—"(-])/u;
const FULL_YEAR = /\b(?:19|20)\d{2}\b/;
const URL = /https?:\/\/[^\s<>()]+(?:\([^\s()]*\)[^\s<>()]*)*/i;
const MARKDOWN_LINK = /\[[^\]]*\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+)\)/i;
const DOI = /\bdoi:\s*(10\.\d{4,9}\/[-._;()/:+a-z0-9]+)/i;
const TITLE = /"((?:[^"\\]|\\.)+)"/;
const ACCESS = /\bAccessed\s+(\d{4}-\d{2}-\d{2}|[A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4}|[^,\n]+)/i;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DATE_LEAD = new RegExp(`^(.+?)[,\\s]+((?:${MONTH}\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+${MONTH}\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2}))(?=$|[ \\t]*[,.;:–—"(-])`, 'i');
const CONTINUATION = /^(?:["“]|(?:title|publication|source)\s*:|accessed\b|doi:|https?:\/\/|\[[^\]]+\](?:\[[^\]]*\]|\())/i;
const unescape = (value) => value.replace(/\\(.)/g, '$1').trim();

function dateValue(value) {
  if (parseDate(value)) return value;
  const monthFirst = new RegExp(`^(${MONTH})\\s+(\\d{1,2}),?\\s+(\\d{4})$`, 'i').exec(value);
  const dayFirst = new RegExp(`^(\\d{1,2})\\s+(${MONTH})\\s+(\\d{4})$`, 'i').exec(value);
  if (!monthFirst && !dayFirst) return '';
  const name = (monthFirst ? monthFirst[1] : dayFirst[2]).toLowerCase();
  const month = MONTHS.findIndex((item) => item.startsWith(name.slice(0, 3))) + 1;
  const day = monthFirst ? monthFirst[2] : dayFirst[1];
  const year = monthFirst ? monthFirst[3] : dayFirst[3];
  const result = `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
  return parseDate(result) ? result : '';
}

function resolveReferences(value, references) {
  const resolved = value.replace(/\[([^\]\n]+)\]\[([^\]\n]*)\]/g, (original, text, label) => {
    const key = (label || text).trim().replace(/\s+/g, ' ').toLowerCase();
    const href = references?.[key]?.href;
    return typeof href === 'string' && /^https?:\/\//i.test(href) ? `[${text}](${href})` : original;
  });
  return resolved.replace(/\[([^\]\n]+)\](?![\[(])/g, (original, text) => {
    const key = text.trim().replace(/\s+/g, ' ').toLowerCase();
    const href = references?.[key]?.href;
    return typeof href === 'string' && /^https?:\/\//i.test(href) ? `[${text}](${href})` : original;
  });
}

function findYearLead(value) {
  const date = value.match(DATE_LEAD);
  const year = value.match(YEAR_LEAD);
  if (date && (!year || date[1].length <= year[1].length)) return { match: date, date: true };
  return year ? { match: year, date: false } : null;
}

/**
 * Extract a citation candidate from a card body, ignoring Markdown code,
 * blockquotes, lists and HTML blocks. Explicit source text is retained; fields
 * whose meaning cannot be determined confidently are listed as uncertain.
 *
 * @param {string} body Markdown after a card heading.
 * @param {object} [references] Markdown reference definitions from the note.
 * @returns {{citation: object|null, uncertainFields: string[]}}
 */
export function extractCardCitation(body, references = {}) {
  let firstContent = true;
  for (const token of markdown.lexer(body.replace(/\r\n?/g, '\n'))) {
    if (token.type === 'space' || (token.type === 'html' && /^ {0,3}<!--/.test(token.raw))) continue;
    if (token.type === 'heading') continue;
    if (token.type !== 'paragraph' && token.type !== 'text') {
      firstContent = false;
      continue;
    }
    const lines = token.raw.split('\n');
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!line.trim()) continue;
      const bold = line.match(BOLD_LEAD);
      const plain = line.trim();
      const lead = bold ? bold[2] : plain;
      const year = findYearLead(lead);
      const remainder = bold ? bold[3].trim() : '';
      const signal = !!year || FULL_YEAR.test(lead + ' ' + remainder) ||
        URL.test(lead + ' ' + remainder) || DOI.test(lead + ' ' + remainder) || /\bAccessed\b/i.test(remainder);
      const continuation = [];
      for (let next = index + 1; next < lines.length && continuation.length < 5; next++) {
        const value = lines[next].trim();
        if (!value || !CONTINUATION.test(value)) break;
        continuation.push(value);
      }
      const unformatted = !bold && !!year && (TITLE.test(plain) || URL.test(plain) || DOI.test(plain) || continuation.length > 0);
      if ((bold && (signal || (firstContent && !remainder))) || unformatted) {
        return parseCitation(resolveReferences(lead, references),
          resolveReferences([remainder, ...continuation].filter(Boolean).join(', '), references));
      }
      firstContent = false;
    }
  }
  return { citation: null, uncertainFields: [] };
}

function parseCitation(lead, suffix) {
  const citation = { author: '', year: '', title: '', publication: '', url: '', accessed: '' };
  const uncertain = new Set();
  const parsed = findYearLead(lead);
  const match = parsed?.match;
  let details = suffix;
  if (match) {
    citation.author = unescape(match[1]);
    const year = parsed.date ? dateValue(match[2]).slice(0, 4) : (match[2] || match[3]);
    if (/^(?:19|20)\d{2}$/.test(year)) citation.year = year;
    else uncertain.add('year');
    details = `${lead.slice(match[0].length)} ${suffix}`.trim();
  } else {
    citation.author = unescape(lead);
    if (citation.author) uncertain.add('author');
    if (/\b\d{2,4}\b/.test(lead)) uncertain.add('year');
  }

  const labeledTitle = details.match(/\bTitle:\s*([^,\n]+)/i);
  const title = details.match(TITLE);
  const ambiguousTitle = title && details.replace(title[0], '').includes('"');
  if (ambiguousTitle) uncertain.add('title');
  else if (title || labeledTitle) citation.title = unescape((title || labeledTitle)[1]);
  const link = details.match(MARKDOWN_LINK);
  const bareUrl = details.match(URL);
  const doi = details.match(DOI);
  if (link || bareUrl) citation.url = (link ? link[1] : bareUrl[0]).replace(/[.,;]+$/, '');
  else if (doi) citation.url = `https://doi.org/${doi[1].replace(/[.,;]+$/, '')}`;
  else if (/\[[^\]]+\](?:\[[^\]]*\]|\([^)]+\))/.test(details)) uncertain.add('url');
  const access = details.match(ACCESS);
  if (access) {
    const value = unescape(access[1]);
    const normalized = dateValue(value);
    if (normalized) citation.accessed = normalized;
    else uncertain.add('accessed');
  }
  let remaining = details;
  const labeledPublication = /\b(?:Publication|Source):\s*/i.test(details);
  if (title) remaining = remaining.replace(title[0], '');
  else if (labeledTitle) remaining = remaining.replace(labeledTitle[0], '');
  if (link) remaining = remaining.replace(link[0], '');
  else if (bareUrl) remaining = remaining.replace(bareUrl[0], '');
  if (doi) remaining = remaining.replace(doi[0], '');
  if (access) remaining = remaining.replace(access[0], '');
  remaining = remaining.replace(/^[\s,.;:–—-]+|[\s,.;:–—-]+$/g, '').trim().replace(/^(?:Publication|Source):\s*/i, '');
  if (remaining) {
    if ((title || labeledTitle || labeledPublication) && !ambiguousTitle && !/\b(?:19|20)\d{2}\b/.test(remaining)) citation.publication = unescape(remaining);
    else uncertain.add('publication');
  }
  return { citation, uncertainFields: [...uncertain] };
}
