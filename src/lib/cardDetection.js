import { splitFrontmatter } from './frontmatter.js';

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const BOLD_LEAD = /^ {0,3}(\*\*|__)(?=\S)(.+?)\1(?:[ \t]*(.*))?$/;
const CITATION_SIGNAL = /\b(?:19|20)\d{2}\b|https?:\/\/|\baccessed\b/i;
const SHORT_YEAR = /\p{L}[\p{L}.'’-]*(?:\s+[\p{L}.'’-]+)*[ ,]+\d{2}(?=$|[ \t]*[,;:–—-])/u;
const SETEXT = /^ {0,3}(?:=+|-+)[ \t]*$/;
const RAW_HTML = /^ {0,3}<(script|pre|style|textarea)(?:[ \t>]|$)/i;

/**
 * Find level-four card sections in Markdown. Line indices are zero-based and
 * refer to the original document, including its frontmatter.
 *
 * A standalone bold lead on the first substantive line is a possible incomplete
 * citation. Other bold leads need a citation signal.
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
  let rawHtml = null;
  let inComment = false;
  let firstContent = false;

  for (let index = firstLine; index < lines.length; index++) {
    const line = lines[index];
    if (rawHtml) {
      if (new RegExp(`</${rawHtml}\\s*>`, 'i').test(line)) rawHtml = null;
      continue;
    }
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
    const rawOpening = visible.match(RAW_HTML);
    if (rawOpening) {
      if (!new RegExp(`</${rawOpening[1]}\\s*>`, 'i').test(visible)) rawHtml = rawOpening[1];
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
    if (visible.trim() && !/^(?: {4}|\t| {0,3}(?:>|[-+*][ \t]|\d+[.)][ \t]))/.test(visible) &&
        index + 1 < lines.length && SETEXT.test(lines[index + 1])) {
      if (card) {
        card.endLineIndex = index;
        card = null;
      }
      index++;
      continue;
    }
    if (!card || !visible.trim() || /^(?: {4}|\t)/.test(visible)) continue;
    const citation = visible.match(BOLD_LEAD);
    const remainder = citation?.[3]?.trim() || '';
    const signal = citation && (CITATION_SIGNAL.test(citation[2] + ' ' + remainder) || SHORT_YEAR.test(citation[2]));
    if (!card.citationLine && citation && (signal || (firstContent && !remainder))) {
      card.citationLine = visible.trim();
    }
    firstContent = false;
  }
  return cards;
}
