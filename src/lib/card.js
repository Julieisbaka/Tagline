import { spokenCitations } from './citation.js';
import { splitFrontmatter } from './frontmatter.js';
import { speechStats } from './readTime.js';

const HEADING_RE = /^(#{1,6})\s/;

// A "card" is a level-4 heading (tag) plus everything until the next heading.
// If the cursor is under a higher-level heading (block/hat/pocket), that
// whole section is returned instead.
/** Find the heading section containing a Markdown character offset. @param {string} content @param {number} offset @returns {object|null} */
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

/** Repeatedly remove HTML tags from text without interpreting their contents. @param {string} value @returns {string} */
function stripTags(value) {
  let previous;
  do {
    previous = value;
    value = value.replace(/<[^>]*>/g, '');
  } while (value !== previous);
  return value.replace(/[<>]/g, '');
}

/** Count Unicode words after removing tags and entity markup. @param {string} s @returns {number} */
const countWords = (s) => (stripTags(s).replace(/&(?:#\d+|#x[\da-f]+|\w+);/gi, ' ')
  .match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;

/** Extract body, highlighted evidence, and spoken citations from a card. @param {string} content @returns {object} */
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

/** Return highlighted evidence and citation lead text intended to be spoken. @param {string} content @returns {string} */
export function spokenEvidence(content) {
  const { highlighted, citations } = evidenceParts(content);
  return `${highlighted}\n${citations}`.trim();
}

/** Count card, word, highlight, and spoken-citation statistics from Markdown. @param {string} content @returns {object} */
export function cardStats(content) {
  content = splitFrontmatter(content).body;
  const { body, highlighted, citations } = evidenceParts(content);
  const citationWords = countWords(citations);
  const underlined = [...body.matchAll(/\+\+([\s\S]*?)\+\+/g)].map((m) => m[1].replace(/==/g, '')).join(' ');
  const cards = (content.match(/^####\s/gm) || []).length;
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

/** Format a nonnegative duration in seconds as minutes and zero-padded seconds. @param {number} totalSeconds @returns {string} */
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
