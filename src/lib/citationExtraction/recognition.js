import { parseDate } from '../calendar.js';
import { matchIndices } from './sourceText.js';

const YEAR_TOKEN = '(?:\\((\\d{2}|\\d{4})\\)|(\\d{2}|\\d{4}))';
const SEP = '[,\\s.\\u2013\\u2014-]+';
const YEAR_LEAD = new RegExp(
  `^(.+?)${SEP}${YEAR_TOKEN}(?=$|[ \\t]*[,.;:\u2013\u2014"'\u201c\u201d()\\-])`,
  'u'
);
const ND_LEAD = /^(.+?)[,\s.\u2013\u2014-]+(n\.?\s*d\.?|no\s+date)(?=$|[\s,.;:–—-])/iu;
const BCE_LEAD = /^(.+?)[,\s.\u2013\u2014-]+(\d{1,4})\s*(?:BCE|BC)\b/iu;
const RANGE_LEAD =
  /^(.+?)[,\s.\u2013\u2014-]+(\d{2}|\d{4})[–-](\d{2}|\d{4})(?=$|[ \t]*[,.;:\u2013\u2014"'\u201c\u201d()\-])/u;
export const FULL_YEAR = /\b(?:1[0-9]{3}|20\d{2})\b/;
const URL_BODY = "[^\\s<>\"'`]*";
export const URL = new RegExp(`https?:\\/\\/${URL_BODY}`, 'i');
export const MARKDOWN_LINK = /\[[^\]]*\]\((https?:\/\/[^)\s]+(?:\)[^)\s]*)*)\)/i;
export const DOI =
  /\b(?:doi\s*:\s*|(?:https?:\/\/)?(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/[^\s"'`<>]*)/i;
export const ARXIV = /\barxiv:?\s*(\d{4}\.\d{4,5}(?:v\d+)?|[a-z][a-z.-]*\/\d{7}(?:v\d+)?)/i;
export const ISBN =
  /\b(?:ISBN(?:-1[03])?:?\s*[0-9][0-9Xx\-\s]{8,22}[0-9Xx]|97[89](?:[-\s]?\d){10})\b/i;
export const ISBN_LABELED = /\bISBN(?:-1[03])?:?\s*([0-9][0-9Xx\-\s]{8,22}[0-9Xx])\b/i;
export const ISBN_13 = /\b(97[89](?:[-\s]?\d){10})\b/;
export const TITLE = /["\u201c]((?:[^"\u201c\u201d\\]|\\.)+)["\u201d]/;
export const ACCESS =
  /\bAccessed\s+(\d{4}-\d{2}-\d{2}|[A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4}|[^,\n]+)/i;
export const DEBATE_FORM =
  /\b(?:ibid\.?|interview|podcast|congressional\s+record|op\.?\s*cit\.?)\b/iu;
const IBID = /^ibid\.?(?=$|[\s,;:–—-])/iu;
export const COURT_FORM = /\bv\.\s+[A-Z]/;
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const MONTH =
  '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DATE_LEAD = new RegExp(
  `^(.+?)${SEP}((?:${MONTH}\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+${MONTH}\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2}))(?=$|[ \\t]*[,.;:\u2013\u2014"'\u201c\u201d()\\-])`,
  'i'
);
export const unescape = (value) => value.replace(/\\(.)/g, '$1').trim();

export function dateValue(value) {
  if (parseDate(value)) {
    return value;
  }
  const monthFirst = new RegExp(`^(${MONTH})\\s+(\\d{1,2}),?\\s+(\\d{4})$`, 'i').exec(value);
  const dayFirst = new RegExp(`^(\\d{1,2})\\s+(${MONTH})\\s+(\\d{4})$`, 'i').exec(value);
  if (!monthFirst && !dayFirst) {
    return '';
  }
  const name = (monthFirst ? monthFirst[1] : dayFirst[2]).toLowerCase();
  const month = MONTHS.findIndex((item) => item.startsWith(name.slice(0, 3))) + 1;
  const day = monthFirst ? monthFirst[2] : dayFirst[1];
  const year = monthFirst ? monthFirst[3] : dayFirst[3];
  const result = `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
  return parseDate(result) ? result : '';
}

/** Assume 20xx unless that year is still in the future, then assume 19xx. */
export function expandTwoDigitYear(yearNum, currentYear = new Date().getFullYear()) {
  const assumed = Math.floor(currentYear / 100) * 100 + Number(yearNum);
  return assumed > currentYear ? assumed - 100 : assumed;
}

/**
 * Validate an ISBN-10 or ISBN-13 check digit so typo'd identifiers are not
 * turned into links that will fail when fetched.
 *
 * @param {string} value ISBN digits, optionally with separators or a trailing X.
 * @returns {boolean} Whether the value is a well-formed ISBN with a valid check digit.
 */
export function isValidIsbn(value) {
  const digits = String(value).replace(/[-\s]/g, '').toUpperCase();
  if (/^\d{9}[\dX]$/.test(digits)) {
    const sum = [...digits].reduce(
      (total, char, index) => total + (char === 'X' ? 10 : Number(char)) * (10 - index),
      0
    );
    return sum % 11 === 0;
  }
  if (/^\d{13}$/.test(digits)) {
    const sum = [...digits].reduce(
      (total, char, index) => total + Number(char) * (index % 2 ? 3 : 1),
      0
    );
    return sum % 10 === 0;
  }
  return false;
}

export function expandYear(token, currentYear = new Date().getFullYear()) {
  if (/^(?:19|20)\d{2}$/.test(token)) {
    return token;
  }
  if (/^\d{2}$/.test(token)) {
    return String(expandTwoDigitYear(token, currentYear));
  }
  return '';
}

export function authorKind(author) {
  const value = author.trim();
  if (!value) {
    return 'unknown';
  }
  const corporate =
    /\b(?:United States|United Nations|Congress|Department|Administration|Government|Office|Committee|Court|Commission|Council|University|Institute|Association|Organization|Foundation|Bureau|Agency|Service|Ministry|Corporation|Center|Centre|Laboratory|Bank)\b/i;
  if (/\bet\s+al\b|;/i.test(value)) {
    return 'multi';
  }
  if (corporate.test(value)) {
    const groups = value.split(/\s+(?:and|&)\s+/i);
    const authorGroup = (group) =>
      corporate.test(group) ||
      /^(?:\p{Lu}[\p{L}.'-]*\s+){1,}\p{Lu}[\p{L}.'-]*$/u.test(group.trim());
    return groups.length > 1 && groups.every(authorGroup) ? 'multi' : 'corporate';
  }
  if (/^(?:UN|WHO|NATO|IMF|CDC|NASA|RAND|UNICEF|UNESCO)$/u.test(value)) {
    return 'corporate';
  }
  if (/\s+(?:and|&)\s+/i.test(value) || /,\s*[^,]+,/.test(value)) {
    return 'multi';
  }
  const parts = value
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 2 && /^\p{Lu}/u.test(parts[1])) {
    return 'last-first';
  }
  if (parts.length === 1 && value.split(/\s+/).length >= 2) {
    return 'first-last';
  }
  return parts.length > 1 ? 'unknown' : 'name';
}

export function findYearLead(value) {
  const nd = matchIndices(value, ND_LEAD);
  const date = matchIndices(value, DATE_LEAD);
  const bce = matchIndices(value, BCE_LEAD);
  const range = matchIndices(value, RANGE_LEAD);
  const year = matchIndices(value, YEAR_LEAD);
  const candidates = [
    nd && { match: nd, nd: true, author: nd[1] },
    date && { match: date, date: true, author: date[1] },
    bce && { match: bce, bce: true, author: bce[1] },
    range && { match: range, range: true, author: range[1] },
    year && { match: year, date: false, author: year[1] },
  ].filter((item) => item && item.author.trim());
  if (!candidates.length) {
    return null;
  }
  // Prefer specific anchors (full date/BCE/range/nd) over bare year when same author span makes sense.
  // Avoid shortest-prefix trap for corporate authors with commas by preferring candidates whose
  // author boundary looks plausible and, among equals, the one consuming more of a corporate prefix.
  const scored = candidates.map((item) => {
    const kind = authorKind(item.author);
    const specificity = item.date ? 4 : item.bce ? 3 : item.range ? 3 : item.nd ? 2 : 1;
    const corporateBonus = kind === 'corporate' || kind === 'multi' ? 2 : 0;
    return { ...item, kind, specificity, corporateBonus };
  });
  scored.sort(
    (a, b) =>
      a.author.length - b.author.length ||
      b.specificity - a.specificity ||
      b.corporateBonus - a.corporateBonus
  );
  return scored[0];
}

export function ibidLead(value) {
  const marker = matchIndices(value, IBID);
  if (!marker) {
    return null;
  }
  const rest = value.slice(marker[0].length);
  return /^(?:\s*$|\s*[,;:–—-]|\s+(?:(?:p{1,2}\.?|pages?)\s*\d|(?:at\s+)?\d))/i.test(rest)
    ? marker
    : null;
}
