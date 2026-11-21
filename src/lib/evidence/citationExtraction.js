import { Marked } from 'marked';
import {
  FULL_YEAR,
  URL,
  DOI,
  ARXIV,
  ISBN,
  TITLE,
  DEBATE_FORM,
  COURT_FORM,
  findYearLead,
  ibidLead,
} from './citationExtraction/recognition.js';
import {
  sourceText,
  sliceText,
  joinText,
  matchIndices,
  collapseText,
  resolveReferences,
} from './citationExtraction/sourceText.js';
import { parseCitation } from './citationExtraction/parseCitation.js';

export { expandTwoDigitYear, isValidIsbn } from './citationExtraction/recognition.js';

const markdown = new Marked({ gfm: true, breaks: true });
const BOLD_LEAD = /^ {0,3}(\*\*|__)(?=\S)([\s\S]+?)\1([\s\S]*)$/;
const CONTINUATION =
  /^(?:["\u201c]|(?:title|publication|source|volume|vol\.?|issue|no\.?|p{1,2}\.?|pages?)\s*:|accessed\b|doi:|arxiv:|isbn(?:-1[03])?:|https?:\/\/|\[[^\]]+\](?:\[[^\]]*\]|\())/i;

function collapse(text) {
  return text.replace(/\s+/g, ' ').trim();
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
