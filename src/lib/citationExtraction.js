import { Marked } from 'marked';
import { parseDate } from './calendar.js';

const markdown = new Marked({ gfm: true, breaks: true });
const BOLD_LEAD = /^ {0,3}(\*\*|__)(?=\S)([\s\S]+?)\1([\s\S]*)$/;
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
const FULL_YEAR = /\b(?:1[0-9]{3}|20\d{2})\b/;
const URL = /https?:\/\/[^\s<>()]+(?:\([^\s()]*\)[^\s<>()]*)*/i;
const MARKDOWN_LINK = /\[[^\]]*\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+)\)/i;
const DOI = /\bdoi:\s*(10\.\d{4,9}\/[-._;()/:+a-z0-9]+)/i;
const ARXIV = /\barxiv:?\s*(\d{4}\.\d{4,5}(?:v\d+)?|[a-z][a-z.-]*\/\d{7}(?:v\d+)?)/i;
const ISBN = /\b(?:ISBN(?:-1[03])?:?\s*[0-9][0-9Xx\-\s]{8,22}[0-9Xx]|97[89](?:[-\s]?\d){10})\b/i;
const ISBN_LABELED = /\bISBN(?:-1[03])?:?\s*([0-9][0-9Xx\-\s]{8,22}[0-9Xx])\b/i;
const ISBN_13 = /\b(97[89](?:[-\s]?\d){10})\b/;
const TITLE = /["\u201c]((?:[^"\u201c\u201d\\]|\\.)+)["\u201d]/;
const ACCESS =
  /\bAccessed\s+(\d{4}-\d{2}-\d{2}|[A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4}|[^,\n]+)/i;
const DEBATE_FORM = /\b(?:ibid\.?|interview|podcast|congressional\s+record|op\.?\s*cit\.?)\b/iu;
const IBID = /^ibid\.?(?=$|[\s,;:–—-])/iu;
const COURT_FORM = /\bv\.\s+[A-Z]/;
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
const CONTINUATION =
  /^(?:["\u201c]|(?:title|publication|source|volume|vol\.?|issue|no\.?|p{1,2}\.?|pages?)\s*:|accessed\b|doi:|arxiv:|isbn(?:-1[03])?:|https?:\/\/|\[[^\]]+\](?:\[[^\]]*\]|\())/i;
const unescape = (value) => value.replace(/\\(.)/g, '$1').trim();

function dateValue(value) {
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

// Original ranges use encoded offsets (including CRLF width); generated characters have no range.
function sourceText(value) {
  const text = String(value ?? '');
  const normalized = text.replace(/\r\n?/g, '\n');
  const ranges = new Float64Array(normalized.length);
  let index = 0;
  for (let i = 0; i < text.length; i++) {
    const start = i;
    if (text[i] === '\r' && text[i + 1] === '\n') {
      i++;
    }
    ranges[index++] = start * 2 + (i - start);
  }
  return { text: normalized, ranges };
}

const sliceText = (value, start, end) => ({
  text: value.text.slice(start, end),
  ranges: value.ranges.slice(start, end),
});
const joinText = (parts, separator = '') => {
  const result = { text: '', ranges: [] };
  parts.forEach((part, i) => {
    if (i) {
      result.text += separator;
      result.ranges.push(...Array(separator.length).fill(null));
    }
    result.text += part.text;
    for (const range of part.ranges) {
      result.ranges.push(range);
    }
  });
  return result;
};
const spanOf = (value, start = 0, end = value.text.length) => {
  const segments = [];
  for (let i = start; i < end; i++) {
    let range = value.ranges[i];
    if (range == null) {
      continue;
    }
    if (typeof range === 'number') {
      const start = Math.floor(range / 2);
      range = { start, end: start + 1 + (range % 2) };
    }
    const last = segments[segments.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      segments.push({ ...range });
    }
  }
  if (!segments.length) {
    return undefined;
  }
  return {
    start: segments[0].start,
    end: segments[segments.length - 1].end,
    ...(segments.length > 1 ? { segments } : {}),
  };
};
const matchIndices = (value, regex) =>
  new RegExp(regex.source, regex.flags.includes('d') ? regex.flags : regex.flags + 'd').exec(value);

function replaceText(value, regex, replacement) {
  const parts = [];
  let last = 0;
  for (const match of value.text.matchAll(regex)) {
    parts.push(sliceText(value, last, match.index));
    const text = replacement(match);
    const span = spanOf(value, match.index, match.index + match[0].length);
    parts.push(
      text === match[0]
        ? sliceText(value, match.index, match.index + match[0].length)
        : { text, ranges: Array(text.length).fill(span || null) }
    );
    last = match.index + match[0].length;
  }
  parts.push(sliceText(value, last));
  return joinText(parts);
}

function collapseText(value) {
  const collapsed = replaceText(value, /\s+/g, () => ' ');
  const start = collapsed.text.length - collapsed.text.trimStart().length;
  return sliceText(collapsed, start, collapsed.text.trimEnd().length);
}

function resolveReferences(value, references) {
  const resolve = (match) => {
    const key = (match[2] || match[1]).trim().replace(/\s+/g, ' ').toLowerCase();
    const href = references?.[key]?.href;
    return typeof href === 'string' && /^https?:\/\//i.test(href)
      ? `[${match[1]}](${href})`
      : match[0];
  };
  const resolved = replaceText(value, /\[([^\]\n]+)\]\[([^\]\n]*)\]/g, resolve);
  return replaceText(resolved, /\[([^\]\n]+)\](?![\[(])/g, resolve);
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

function expandYear(token, currentYear = new Date().getFullYear()) {
  if (/^(?:19|20)\d{2}$/.test(token)) {
    return token;
  }
  if (/^\d{2}$/.test(token)) {
    return String(expandTwoDigitYear(token, currentYear));
  }
  return '';
}

function authorKind(author) {
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

function findYearLead(value) {
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

function collapse(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function ibidLead(value) {
  const marker = matchIndices(value, IBID);
  if (!marker) {
    return null;
  }
  const rest = value.slice(marker[0].length);
  return /^(?:\s*$|\s*[,;:–—-]|\s+(?:(?:p{1,2}\.?|pages?)\s*\d|(?:at\s+)?\d))/i.test(rest)
    ? marker
    : null;
}

/**
 * Extract a citation candidate from a card body, ignoring Markdown code,
 * blockquotes, lists and HTML blocks. Collects the leading paragraph and
 * continuation lines, collapsing wrapped text before parsing.
 *
 * @param {string} body Markdown after a card heading.
 * @param {object} [references] Markdown reference definitions from the note.
 * @param {object|null} [previous] Previous extraction result for resolving Ibid.
 * @returns {object} Field spans are body-relative UTF-16 offsets, end exclusive. Discontinuous
 *   fields include `segments`. Reference URLs point to their reference use; inherited fields
 *   have no local span and are listed separately. `authorKind` is a heuristic classification,
 *   not a normalized author name. `ibidResolved` is false when previous context is unavailable.
 */
export function extractCardCitation(body, references = {}, previous = null) {
  const source = sourceText(body);
  let cursor = 0;
  let firstContent = true;
  for (const token of markdown.lexer(source.text)) {
    const tokenStart = source.text.indexOf(token.raw, cursor);
    if (tokenStart < 0) {
      continue;
    }
    cursor = tokenStart + token.raw.length;
    if (token.type === 'space' || (token.type === 'html' && /^ {0,3}<!--/.test(token.raw))) {
      continue;
    }
    if (token.type === 'heading') {
      continue;
    }
    if (token.type !== 'paragraph' && token.type !== 'text') {
      firstContent = false;
      continue;
    }

    const rawLines = token.raw.split('\n');
    const lineStarts = [];
    let lineStart = tokenStart;
    for (const line of rawLines) {
      lineStarts.push(lineStart);
      lineStart += line.length + 1;
    }
    // Build logical lines but also keep full text for wrapped bold detection
    for (let index = 0; index < rawLines.length; index++) {
      const line = rawLines[index];
      if (!line.trim()) {
        continue;
      }

      // Try to match bold lead starting at this line; if closing ** is missing, join following lines
      let boldRegion = line;
      let consumed = 0;
      if (/^ {0,3}(\*\*|__)(?=\S)/.test(line) && !BOLD_LEAD.test(line)) {
        for (let j = index + 1; j < rawLines.length && consumed < 6; j++) {
          boldRegion += '\n' + rawLines[j];
          consumed = j - index;
          if (BOLD_LEAD.test(boldRegion)) {
            break;
          }
        }
      }
      const bold = matchIndices(boldRegion, BOLD_LEAD);
      const region = sliceText(source, lineStarts[index], lineStarts[index] + boldRegion.length);
      const lineText = sliceText(source, lineStarts[index], lineStarts[index] + line.length);
      const leadText = bold
        ? collapseText(sliceText(region, ...bold.indices[2]))
        : collapseText(lineText);
      const remainderText = bold
        ? collapseText(sliceText(region, ...bold.indices[3]))
        : sourceText('');
      const plainLine = collapse(line);
      const lead = leadText.text;
      const remainder = remainderText.text;
      const detailsText = bold ? remainder : '';
      const year = findYearLead(lead);
      const combined = `${lead} ${detailsText}`;
      const signal =
        !!year ||
        FULL_YEAR.test(combined) ||
        URL.test(combined) ||
        DOI.test(combined) ||
        ARXIV.test(combined) ||
        ISBN.test(combined) ||
        /\bAccessed\b/i.test(combined) ||
        DEBATE_FORM.test(combined) ||
        COURT_FORM.test(combined);

      // Continuation lines after the bold region / current line
      const continuation = [];
      const startCont = index + (bold ? consumed : 0) + 1;
      for (let next = startCont; next < rawLines.length && continuation.length < 6; next++) {
        const value = rawLines[next].trim();
        if (!value) {
          break;
        }
        if (!CONTINUATION.test(value)) {
          break;
        }
        continuation.push(
          collapseText(
            sliceText(source, lineStarts[next], lineStarts[next] + rawLines[next].length)
          )
        );
      }

      const unformatted =
        !bold &&
        (!!year || ibidLead(lead)) &&
        (TITLE.test(plainLine) ||
          URL.test(plainLine) ||
          DOI.test(plainLine) ||
          ARXIV.test(plainLine) ||
          ISBN.test(plainLine) ||
          continuation.length > 0);

      if (
        (bold && (signal || (firstContent && !remainder.trim() && continuation.length === 0))) ||
        unformatted ||
        (!bold && ibidLead(lead))
      ) {
        const resolvedLead = resolveReferences(leadText, references);
        const resolvedDetails = resolveReferences(
          joinText([...(bold && remainder ? [remainderText] : []), ...continuation], ', '),
          references
        );
        return parseCitation(resolvedLead, resolvedDetails, previous);
      }
      firstContent = false;
      if (bold && consumed > 0) {
        index += consumed;
      }
    }
  }
  return {
    citation: null,
    uncertainFields: [],
    fieldConfidence: {},
    fieldSpans: {},
    authorKind: 'unknown',
    inheritedFields: [],
  };
}

function parseCitation(leadText, suffixText, previous) {
  const lead = leadText.text;
  const citation = {
    author: '',
    year: '',
    title: '',
    publication: '',
    url: '',
    accessed: '',
    locator: '',
    form: '',
  };
  const uncertain = new Set();
  const confidence = {};
  const spans = {};
  const inherited = [];
  const ibid = ibidLead(lead);
  const parsed = ibid ? null : findYearLead(lead);
  const match = parsed?.match;
  let detailsText = suffixText;
  const note = (field, value, conf, text, bounds) => {
    citation[field] = value;
    if (conf != null) {
      confidence[field] = conf;
    }
    const span = text && bounds && spanOf(text, ...bounds);
    if (span) {
      spans[field] = span;
    }
  };
  const noteMatch = (field, value, conf, text, found, group = 0) => {
    if (!found?.indices[group]) {
      return;
    }
    const bounds = found.indices[group];
    const captured = found[group];
    note(field, value, conf, text, [
      bounds[0] + captured.length - captured.trimStart().length,
      bounds[1] - (captured.length - captured.trimEnd().length),
    ]);
  };
  const hasForm = (text) => {
    if (DEBATE_FORM.test(text)) {
      return text.match(DEBATE_FORM)[0].replace(/\.$/, '').toLowerCase();
    }
    if (COURT_FORM.test(text) && /\b\d{4}\b/.test(text)) {
      return 'court case';
    }
    return '';
  };
  if (ibid) {
    noteMatch('form', 'ibid', 1, leadText, ibid);
    detailsText = joinText([sliceText(leadText, ibid[0].length), suffixText], ' ');
  } else if (match) {
    const authorBounds = [...match.indices[1]];
    if (
      (/\bet\s+al$/iu.test(match[1]) || /\b\p{Lu}$/u.test(match[1])) &&
      lead[authorBounds[1]] === '.'
    ) {
      authorBounds[1]++;
    }
    note('author', unescape(lead.slice(...authorBounds)), 0.85, leadText, authorBounds);
    if (parsed.nd) {
      noteMatch('year', 'n.d.', 0.9, leadText, match, 2);
    } else if (parsed.date) {
      const year = dateValue(match[2]).slice(0, 4);
      if (/^(?:1[89]|20)\d{2}$/.test(year)) {
        noteMatch('year', year, 0.95, leadText, match, 2);
      } else {
        uncertain.add('year');
        confidence.year = 0.2;
        spans.year = spanOf(leadText, ...match.indices[2]);
      }
    } else if (parsed.bce) {
      const era = /BCE/i.test(match[0]) ? 'BCE' : 'BC';
      note('year', `${Number(match[2])} ${era}`, 0.95, leadText, [
        match.indices[2][0],
        match.indices[0][1],
      ]);
    } else if (parsed.range) {
      const start = expandYear(match[2]);
      const end = expandYear(match[3]);
      if (start && end) {
        note('year', String(Math.max(Number(start), Number(end))), 0.8, leadText, [
          match.indices[2][0],
          match.indices[3][1],
        ]);
      } else {
        uncertain.add('year');
        confidence.year = 0.2;
        spans.year = spanOf(leadText, match.indices[2][0], match.indices[3][1]);
      }
    } else {
      const year = expandYear(match[2] || match[3] || '');
      if (year) {
        noteMatch('year', year, 0.85, leadText, match, match[2] ? 2 : 3);
      } else {
        uncertain.add('year');
        confidence.year = 0.2;
        spans.year = spanOf(leadText, ...(match.indices[2] || match.indices[3]));
      }
    }
    detailsText = joinText([sliceText(leadText, match[0].length), suffixText], ' ');
  } else {
    note('author', unescape(lead), 0.35, leadText, [0, lead.length]);
    if (citation.author) {
      uncertain.add('author');
    }
    if (/\b\d{2,4}\b/.test(lead)) {
      uncertain.add('year');
      confidence.year = 0.15;
      spans.year = spanOf(leadText, ...matchIndices(lead, /\b\d{2,4}\b/).indices[0]);
    }
  }
  const details = detailsText.text;
  const form = hasForm(`${lead} ${details}`);
  if (form && !ibid) {
    const formMatch = matchIndices(lead, DEBATE_FORM) || matchIndices(details, DEBATE_FORM);
    const text = matchIndices(lead, DEBATE_FORM) ? leadText : detailsText;
    noteMatch('form', form, 0.8, text, formMatch);
    if (!formMatch) {
      note('form', form, 0.8, leadText, match?.indices[1]);
    }
  }

  const labeledTitle = matchIndices(details, /\bTitle:\s*([^,\n]+)/i);
  const title = matchIndices(details, TITLE);
  const titleQuoteCount = (details.match(/["\u201c\u201d]/g) || []).length;
  const ambiguousTitle = title && titleQuoteCount > 2;
  if (ambiguousTitle) {
    uncertain.add('title');
    confidence.title = 0.2;
    spans.title = spanOf(detailsText, ...title.indices[1]);
  } else if (title || labeledTitle) {
    noteMatch(
      'title',
      unescape((title || labeledTitle)[1]),
      0.9,
      detailsText,
      title || labeledTitle,
      1
    );
  }
  const link = matchIndices(details, MARKDOWN_LINK);
  const bareUrl = matchIndices(details, URL);
  const doi = matchIndices(details, DOI);
  const arxiv = matchIndices(details, ARXIV);
  const labeledIsbn = matchIndices(details, ISBN_LABELED);
  const bareIsbn = labeledIsbn ? null : matchIndices(details, ISBN_13);
  const isbn = (labeledIsbn?.[1] || bareIsbn?.[1] || '').replace(/[^0-9Xx]/gi, '');
  if (link || bareUrl) {
    const found = link || bareUrl;
    const bounds = found.indices[link ? 1 : 0];
    const value = (link ? link[1] : bareUrl[0]).replace(/[.,;]+$/, '');
    note('url', value, 0.95, detailsText, [bounds[0], bounds[0] + value.length]);
  } else if (doi) {
    const value = doi[1].replace(/[.,;]+$/, '');
    note('url', `https://doi.org/${value}`, 0.95, detailsText, [
      doi.indices[1][0],
      doi.indices[1][0] + value.length,
    ]);
  } else if (arxiv) {
    noteMatch('url', `https://arxiv.org/abs/${arxiv[1]}`, 0.95, detailsText, arxiv, 1);
  } else if (isbn) {
    if (isValidIsbn(isbn)) {
      noteMatch(
        'url',
        `https://openlibrary.org/isbn/${isbn}`,
        0.8,
        detailsText,
        labeledIsbn || bareIsbn,
        1
      );
    } else {
      uncertain.add('url');
      confidence.url = 0.1;
      spans.url = spanOf(detailsText, ...(labeledIsbn || bareIsbn).indices[1]);
    }
  } else if (/\[[^\]]+\](?:\[[^\]]*\]|\([^)]+\))/.test(details)) {
    uncertain.add('url');
    confidence.url = 0.1;
    const unresolved = matchIndices(details, /\[[^\]]+\](?:\[[^\]]*\]|\([^)]+\))/);
    spans.url = spanOf(detailsText, ...unresolved.indices[0]);
  }
  const locator =
    matchIndices(
      details,
      /\b((?:p{1,2}\.?|pages?)\s*\d+(?:\s*[-–]\s*\d+)?(?:\s*,\s*(?:p{1,2}\.?\s*)?\d+(?:\s*[-–]\s*\d+)?)*)/i
    ) ||
    (ibid && matchIndices(details, /^[\s,;:–—-]+(?:at\s+)?(\d+(?:\s*[-–]\s*\d+)?)(?=$|[,;.\s])/i));
  const volume = matchIndices(details, /\b(?:vol\.?|volume)\s*(\d+)/i);
  const issue = matchIndices(details, /\b(?:no\.?|issue)\s*(\d+)/i);
  if (locator) {
    noteMatch('locator', locator[1].trim(), 0.9, detailsText, locator, 1);
  }
  if (volume) {
    noteMatch('volume', volume[1], 0.9, detailsText, volume, 1);
  }
  if (issue) {
    noteMatch('issue', issue[1], 0.9, detailsText, issue, 1);
  }
  const access = matchIndices(details, ACCESS);
  if (access) {
    const value = unescape(access[1]);
    const normalized = dateValue(value);
    if (normalized) {
      noteMatch('accessed', normalized, 0.9, detailsText, access, 1);
    } else {
      uncertain.add('accessed');
      confidence.accessed = 0.2;
      spans.accessed = spanOf(detailsText, ...access.indices[1]);
    }
  }
  let remaining = detailsText;
  const labeledPublication = /\b(?:Publication|Source):\s*/i.test(details);
  const strip = (value) => {
    const index = value ? remaining.text.indexOf(value) : -1;
    if (index >= 0) {
      remaining = joinText(
        [sliceText(remaining, 0, index), sliceText(remaining, index + value.length)],
        ' '
      );
    }
  };
  strip(title?.[0]);
  if (!title) {
    strip(labeledTitle?.[0]);
  }
  strip(link?.[0] || bareUrl?.[0]);
  strip(doi?.[0]);
  strip(arxiv?.[0]);
  strip(labeledIsbn?.[0] || bareIsbn?.[0]);
  strip(access?.[0]);
  strip(locator?.[0]);
  if (volume) {
    strip(volume[0]);
  }
  if (issue) {
    strip(issue[0]);
  }
  const prefix = remaining.text.match(/^[\s,.;:–—-]*(?:(?:Publication|Source):\s*)?/i)[0].length;
  const suffix = remaining.text.match(/[\s,.;:–—-]*$/)[0].length;
  remaining = sliceText(remaining, prefix, Math.max(prefix, remaining.text.length - suffix));
  if (remaining.text) {
    if (
      (title || labeledTitle || labeledPublication) &&
      !ambiguousTitle &&
      !/\b(?:19|20)\d{2}\b/.test(remaining.text)
    ) {
      note('publication', unescape(remaining.text), 0.7, remaining, [0, remaining.text.length]);
    } else if (!ibid && !citation.publication) {
      uncertain.add('publication');
      confidence.publication = 0.25;
      spans.publication = spanOf(remaining);
    }
  }
  if (ibid) {
    if (previous?.citation && previous.ibidResolved !== false && previous.citation.author) {
      for (const field of [
        'author',
        'year',
        'title',
        'publication',
        'url',
        'accessed',
        'locator',
        'volume',
        'issue',
      ]) {
        if (
          !citation[field] &&
          (previous.citation[field] || previous.uncertainFields?.includes(field)) &&
          !uncertain.has(field)
        ) {
          citation[field] = previous.citation[field] || '';
          inherited.push(field);
          if (previous.fieldConfidence?.[field] != null) {
            confidence[field] = previous.fieldConfidence[field];
          }
          if (previous.uncertainFields?.includes(field)) {
            uncertain.add(field);
          }
        }
      }
    } else {
      uncertain.add('author');
      confidence.author = 0;
    }
  }
  // Backward-compat: omit empty extra fields from citation object shape
  const result = {
    author: citation.author,
    year: citation.year,
    title: citation.title,
    publication: citation.publication,
    url: citation.url,
    accessed: citation.accessed,
  };
  if (citation.locator) {
    result.locator = citation.locator;
  }
  if (citation.volume) {
    result.volume = citation.volume;
  }
  if (citation.issue) {
    result.issue = citation.issue;
  }
  if (citation.form) {
    result.form = citation.form;
  }
  return {
    citation: result,
    uncertainFields: [...uncertain],
    fieldConfidence: confidence,
    fieldSpans: spans,
    authorKind:
      ibid && inherited.includes('author') ? previous.authorKind : authorKind(citation.author),
    inheritedFields: inherited,
    ...(ibid ? { ibidResolved: inherited.includes('author') } : {}),
  };
}
