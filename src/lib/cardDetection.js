import { splitFrontmatter } from './frontmatter.js';

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const BOLD_LEAD = /^ {0,3}(\*\*|__)(?=\S)(.+?)\1(?:[ \t]*(.*))?$/;
const CITATION_SIGNAL = /\b(?:19|20)\d{2}\b|\b\d{2}\b|https?:\/\/|\baccessed\b|[—–]/i;

/**
 * Find level-four card sections in Markdown. Line indices are zero-based and
 * refer to the original document, including its frontmatter.
 *
 * A bold lead on the first substantive line is a possible incomplete citation.
 * Later bold leads must contain a citation signal to avoid mistaking ordinary
 * emphasized evidence for a citation.
 *
 * @param {string} content Markdown document.
 * @returns {{title: string, lineIndex: number, endLineIndex: number, citationLine: string|null}[]}
 */
export function detectCards(content) {
  const lines = content.split(/\r?\n/);
  const frontmatter = splitFrontmatter(content);
  const firstLine = (frontmatter.prefix.match(/\n/g) || []).length;
  const cards = [];
  let card = null;
  let fence = null;
  let inComment = false;
  let firstContent = false;

  for (let index = firstLine; index < lines.length; index++) {
    const line = lines[index];
    if (fence) {
      const closing = line.match(FENCE);
      if (closing && closing[1][0] === fence.character &&
          closing[1].length >= fence.length && !closing[2].trim()) fence = null;
      continue;
    }

    let visible = '';
    let position = 0;
    while (position < line.length) {
      if (inComment) {
        const end = line.indexOf('-->', position);
        if (end < 0) break;
        inComment = false;
        position = end + 3;
      } else {
        if (line[position] === '`') {
          const run = /^`+/.exec(line.slice(position))[0];
          const closing = line.indexOf(run, position + run.length);
          if (closing >= 0) {
            visible += line.slice(position, closing + run.length);
            position = closing + run.length;
            continue;
          }
        }
        if (line.startsWith('<!--', position)) {
          inComment = true;
          position += 4;
        } else {
          visible += line[position++];
        }
      }
    }

    const opening = visible.match(FENCE);
    if (opening && !(opening[1][0] === '`' && opening[2].includes('`'))) {
      fence = { character: opening[1][0], length: opening[1].length };
      continue;
    }
    const heading = visible.match(HEADING);
    if (heading) {
      const level = heading[1].length;
      if (level <= 4 && card) {
        card.endLineIndex = index;
        card = null;
      }
      if (level === 4) {
        const title = (heading[2] || '').replace(/[ \t]+#+[ \t]*$/, '').trim();
        card = { title, lineIndex: index, endLineIndex: lines.length, citationLine: null };
        cards.push(card);
        firstContent = true;
      }
      continue;
    }
    if (!card || !visible.trim() || /^(?: {4}|\t)/.test(visible)) continue;
    const citation = visible.match(BOLD_LEAD);
    if (!card.citationLine && citation && (firstContent || CITATION_SIGNAL.test(citation[2] + ' ' + (citation[3] || '')))) {
      card.citationLine = visible.trim();
    }
    firstContent = false;
  }
  return cards;
}
