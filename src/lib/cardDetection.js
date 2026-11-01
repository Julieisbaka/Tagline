import { Marked } from 'marked';
import { splitFrontmatter } from './frontmatter.js';

const markdown = new Marked({ gfm: true, breaks: true });

/**
 * Find top-level level-four card sections using Markdown block structure.
 * Line indices are zero-based in the original document, including frontmatter;
 * endLineIndex is exclusive.
 * @param {string} content Markdown document.
 * @returns {{title: string, lineIndex: number, endLineIndex: number}[]}
 */
export function detectCards(content) {
  const { prefix, body } = splitFrontmatter(content);
  const normalized = body.replace(/\r\n?/g, '\n');
  const tokens = markdown.lexer(normalized);
  const cards = [];
  let lineIndex = (prefix.match(/\n/g) || []).length;
  let card = null;
  for (const token of tokens) {
    if (token.type === 'heading' && token.depth <= 4) {
      if (card) card.endLineIndex = lineIndex;
      card = null;
      if (token.depth === 4) {
        card = { title: token.text.trim(), lineIndex, endLineIndex: 0 };
        cards.push(card);
      }
    }
    lineIndex += (token.raw.match(/\n/g) || []).length;
  }
  if (card) card.endLineIndex = content.split(/\r\n?|\n/).length;
  return cards;
}
