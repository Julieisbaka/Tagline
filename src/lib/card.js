import { spokenCitations } from './citation.js';
import { detectCards } from './cardDetection.js';
import { splitFrontmatter } from './frontmatter.js';
import { speechStats } from './readTime.js';

const HEADING_RE = /^(#{1,6})\s/;

/** 
 * Find the heading section containing a Markdown character offset.
 * @param {string} content - The full Markdown content including frontmatter.
 * @param {number} offset - The character offset within the content to locate.
 * @returns {object|null} - An object containing the section text, heading level, and title, or null if no section is found.
 */
export function getSectionAt(content, offset) {
  const metadata = splitFrontmatter(content);
  if (offset < metadata.offset) return null;
  content = metadata.body;
  offset -= metadata.offset;
  const lines = content.split('\n');
  let pos = 0;
  let cursorLine = 0;
  for (let i = 0; i < lines.length; i++) {
    if (offset <= pos + lines[i].length) {
      cursorLine = i;
      break;
    }
    pos += lines[i].length + 1;
    cursorLine = i;
  }
  let start = -1;
  let level = 7;
  for (let i = cursorLine; i >= 0; i--) {
    const m = lines[i].match(HEADING_RE);
    if (m) {
      start = i;
      level = m[1].length;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(HEADING_RE);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return { text: lines.slice(start, end).join('\n').trimEnd(), level, title: lines[start].replace(HEADING_RE, '') };
}

/** 
 * Repeatedly remove HTML tags from text without interpreting their contents.
 * @param {string} value - The text from which to strip HTML tags.
 * @returns {string} - The text with HTML tags removed.
 */
function stripTags(value) {
  let previous;
  do {
    previous = value;
    value = value.replace(/<[^>]*>/g, '');
  } while (value !== previous);
  return value.replace(/[<>]/g, '');
}

/** 
 * Count Unicode words after removing HTML tags and entity markup.
 * @param {string} s - The text in which to count words.
 * @returns {number} - The number of words found in the text.
 */
const countWords = (s) => (stripTags(s).replace(/&(?:#\d+|#x[\da-f]+|\w+);/gi, ' ')
  .match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;

/** 
 * Extract body, highlighted evidence, and spoken citations from a card.
 * @param {string} content - The full Markdown content of the card.
 * @returns {object} - An object containing the body text, highlighted evidence, and spoken citations.
 */
function evidenceParts(content) {
  content = splitFrontmatter(content).body;
  // Strip headings, cites and markup so we only count evidence text.
  const body = content
    .split('\n')
    .filter((l) => !HEADING_RE.test(l))
    .join('\n');
  const evidence = body.replace(/^\*\*[^*\n]+\*\*[^\n]*$/gm, '');
  const highlighted = [...evidence.matchAll(/==([\s\S]*?)==|<mark\b[^>]*>([\s\S]*?)<\/mark>/gi)]
    .map((m) => (m[1] ?? m[2]).replace(/\+\+/g, '')).join(' ');
  return { body, highlighted, citations: spokenCitations(content) };
}

/** 
 * Return highlighted evidence and citation lead text intended to be spoken.
 * @param {string} content - The full Markdown content of the card.
 * @returns {string} - The combined highlighted evidence and spoken citation text.
 */
export function spokenEvidence(content) {
  const { highlighted, citations } = evidenceParts(content);
  return `${highlighted}\n${citations}`.trim();
}

/** 
 * Count card, word, highlight, and spoken-citation statistics from Markdown.
 * @param {string} content - The full Markdown content of the card.
 * @returns {object} - An object containing various statistics including word counts, highlighted evidence, citation words, read words, underlined text, and card count.
 */
export function cardStats(content) {
  const cards = detectCards(content).length;
  content = splitFrontmatter(content).body;
  const { body, highlighted, citations } = evidenceParts(content);
  const citationWords = countWords(citations);
  const underlined = [...body.matchAll(/\+\+([\s\S]*?)\+\+/g)].map((m) => m[1].replace(/==/g, '')).join(' ');
  return {
    ...speechStats(`${highlighted}\n${citations}`.trim()),
    words: countWords(body.replace(/[=+*_]/g, '')),
    highlighted: countWords(highlighted),
    citationWords,
    readWords: countWords(highlighted) + citationWords,
    underlined: countWords(underlined),
    cards,
  };
}

/** 
 * Determine whether a speech document body already contains the specified evidence text, ignoring differences in whitespace.
 * @param {string} document - The full Markdown content of the speech document, including frontmatter.
 * @param {string} text - The evidence text to check for within the document body.
 * @returns {boolean} - True if the evidence text is found in the document body, false otherwise.
 */
export function containsEvidence(document, text) {
  const normalize = (value) => value.replace(/\s+/g, ' ').trim();
  const needle = normalize(text || '');
  return !!needle && normalize(splitFrontmatter(document || '').body).includes(needle);
}

/** 
 * Format a nonnegative duration in seconds as minutes and zero-padded seconds.
 * @param {number} totalSeconds - The total duration in seconds to format.
 * @returns {string} - The formatted duration as "minutes:seconds", with seconds zero-padded.
 */
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
