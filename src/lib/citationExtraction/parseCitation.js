import {
  MARKDOWN_LINK,
  URL,
  DOI,
  ARXIV,
  ISBN_LABELED,
  ISBN_13,
  TITLE,
  ACCESS,
  DEBATE_FORM,
  COURT_FORM,
  unescape,
  dateValue,
  expandYear,
  authorKind,
  findYearLead,
  ibidLead,
  isValidIsbn,
} from './recognition.js';
import { sliceText, joinText, spanOf, matchIndices } from './sourceText.js';

function trimTrailingPunct(value) {
  let text = String(value || '');
  while (/[.,;:!?]+$/.test(text)) {
    if (/[)\]]$/.test(text)) {
      break;
    }
    text = text.slice(0, -1);
  }
  return text;
}

function balanceClosing(value) {
  let text = String(value || '');
  for (;;) {
    const opens = (text.match(/\(/g) || []).length;
    const closes = (text.match(/\)/g) || []).length;
    if (closes <= opens || !/[).,;:!?]+$/.test(text)) {
      break;
    }
    if (/\)$/.test(text) && closes > opens) {
      text = text.slice(0, -1);
      continue;
    }
    text = trimTrailingPunct(text);
    if (!/\)$/.test(text)) {
      break;
    }
  }
  return trimTrailingPunct(text);
}

export function parseCitation(leadText, suffixText, previous) {
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
    const raw = link ? link[1] : bareUrl[0];
    const value = balanceClosing(raw);
    note('url', value, 0.95, detailsText, [bounds[0], bounds[0] + value.length]);
  } else if (doi) {
    const raw = doi[1];
    const value = balanceClosing(raw);
    const doiUrl = /^https?:\/\/(?:dx\.)?doi\.org\//i.test(doi[0]) ? balanceClosing(doi[0]) : `https://doi.org/${value}`;
    note('url', doiUrl.replace(/^https?:\/\/dx\.doi\.org\//i, 'https://doi.org/'), 0.95, detailsText, [
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
