import { Marked } from 'marked';
import { splitFrontmatter } from './frontmatter.js';

const markdown = new Marked({ gfm: true, breaks: true });
const TRAILING_HASHES = /\s+#{1,6}\s*$/;
const BOLD_TAG = /^ {0,3}(?:\*\*|__)(?=\S)(.+?)(?:\*\*|__)\s*$/;
const WEAK_HEADINGS = new Set([3, 5]);

/**
 * Strip inline Markdown formatting from heading text to a plain title.
 * @param {string} value - Raw inline text.
 * @returns {string}
 */
function cleanTitle(value) {
  if (!value) {
    return '';
  }
  try {
    const tokens = markdown.lexer(String(value))[0]?.tokens;
    if (tokens) {
      const walk = (items) =>
        items
          .map((token) => {
            if (token.type === 'codespan') {
              return token.text;
            }
            if (token.tokens) {
              return walk(token.tokens);
            }
            if (token.type === 'html') {
              return '';
            }
            return token.raw ?? token.text ?? '';
          })
          .join('');
      return walk(tokens)
        .replace(/[<>]/g, '')
        .replace(TRAILING_HASHES, '')
        .replace(/\s+/g, ' ')
        .trim();
    }
  } catch {
    /* fall through */
  }
  return String(value)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/[<>]/g, '')
    .replace(TRAILING_HASHES)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find card sections using Markdown block structure.
 * Default (depth 4, weak off): returns strong h4 cards with legacy fields plus offsets/confidence.
 * Line/offset indices are zero-based in the original document; end values exclusive.
 *
 * @param {string} content
 * @param {{depth?: number, weak?: boolean}} [options]
 * @returns {{title: string, lineIndex: number, endLineIndex: number, startOffset: number, endOffset: number, depth: number, confidence: number, weak: boolean}[]}
 */
export function detectCards(content, options = {}) {
  const depth = Number.isInteger(options.depth) ? options.depth : 4;
  const includeWeak = options.weak === true;
  const { prefix, body } = splitFrontmatter(content);
  const normalized = body.replace(/\r\n?/g, '\n');
  const original = String(content ?? '');
  const tokens = markdown.lexer(normalized);
  const cards = [];
  let lineIndex = (prefix.match(/\n/g) || []).length;
  let card = null;

  const lineOffsets = (text) => {
    const offsets = [0];
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      if (ch === 13) {
        offsets.push(text.charCodeAt(i + 1) === 10 ? i + 2 : i + 1);
        if (text.charCodeAt(i + 1) === 10) {
          i++;
        }
      } else if (ch === 10) {
        offsets.push(i + 1);
      }
    }
    return offsets;
  };
  const offsets = lineOffsets(original);
  const at = (line) => offsets[line] ?? original.length;

  // Only standalone, top-level Markdown comments are markers. Ignore unmatched
  // or nested pairs rather than swallowing the remainder of a document.
  const pairs = new Map();
  let markerStart = null;
  let markerDepth = 0;
  let nested = false;
  let markerLine = lineIndex;
  for (const token of tokens) {
    const marker = token.type === 'html' && /^ {0,3}<!-- card:(start|end) -->\s*$/.exec(token.raw);
    if (marker?.[1] === 'start') {
      if (markerDepth++) {
        nested = true;
      } else {
        markerStart = markerLine;
      }
    } else if (marker?.[1] === 'end' && markerDepth) {
      if (--markerDepth === 0) {
        if (!nested) {
          pairs.set(markerStart, markerLine);
        }
        markerStart = null;
        nested = false;
      }
    }
    markerLine += (token.raw.match(/\n/g) || []).length;
  }

  const closeCard = () => {
    if (card) {
      card.endLineIndex = lineIndex;
      card.endOffset = at(lineIndex);
      card = null;
    }
  };
  const openCard = (candidate) => {
    closeCard();
    card = {
      title: cleanTitle(candidate.title),
      lineIndex,
      endLineIndex: 0,
      startOffset: at(lineIndex),
      endOffset: 0,
      depth: candidate.depth,
      confidence: candidate.confidence,
      weak: candidate.weak === true,
    };
    cards.push(card);
  };

  let skipThrough = -1;
  for (const token of tokens) {
    const tokenLines = (token.raw.match(/\n/g) || []).length;
    const endMarker = pairs.get(lineIndex);
    if (endMarker !== undefined) {
      skipThrough = endMarker;
      closeCard();
      const bodyStart = at(lineIndex + 1);
      const bodyEnd = at(endMarker);
      const inside = original.slice(bodyStart, bodyEnd);
      const first = markdown
        .lexer(inside.replace(/\r\n?/g, '\n'))
        .find((item) => item.type === 'heading' || item.type === 'paragraph');
      cards.push({
        title: cleanTitle(first?.text?.split('\n')[0] || 'Card'),
        lineIndex,
        endLineIndex: endMarker + 1,
        startOffset: at(lineIndex),
        endOffset: at(endMarker + 1),
        bodyStart,
        bodyEnd,
        depth: 0,
        confidence: 1,
        weak: false,
        explicit: true,
      });
    }
    if (lineIndex <= skipThrough) {
      lineIndex += tokenLines;
      continue;
    }
    if (token.type === 'heading') {
      const strong = token.depth === depth;
      const soft = includeWeak && WEAK_HEADINGS.has(token.depth);
      if (token.depth < depth) {
        closeCard();
      } else if (strong) {
        openCard({ title: token.text, depth: token.depth, confidence: 1 });
      } else if (soft) {
        openCard({ title: token.text, depth: token.depth, confidence: 0.55, weak: true });
      } else if (token.depth === depth) {
        closeCard();
      }
    } else if (includeWeak && token.type === 'paragraph' && !card) {
      const raw = token.raw.replace(/\r\n?/g, '\n');
      const lines = raw.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const bold = lines[i].match(BOLD_TAG);
        if (bold) {
          const title = cleanTitle(bold[1]);
          if (title && title.length <= 120 && !/[.!?]$/.test(title)) {
            openCard({ title, depth: 0, confidence: 0.35, weak: true });
            // Adjust to the actual bold line within this paragraph token.
            card.lineIndex = lineIndex + i;
            card.startOffset = at(card.lineIndex);
            break;
          }
        }
      }
    }
    lineIndex += tokenLines;
  }
  if (card) {
    card.endLineIndex = original.split(/\r\n?|\n/).length;
    card.endOffset = original.length;
  }
  const filtered =
    !includeWeak && depth === 4
      ? cards.filter((c) => (c.depth === 4 || c.explicit) && !c.weak)
      : cards;
  // Legacy shape for default calls: preserve exact {title,lineIndex,endLineIndex} contract.
  if (!options || (options.depth === undefined && options.weak === undefined)) {
    return filtered.map(
      ({
        title,
        lineIndex,
        endLineIndex,
        startOffset,
        endOffset,
        depth: d,
        confidence,
        weak: w,
        explicit,
        bodyStart,
        bodyEnd,
      }) => ({
        title,
        lineIndex,
        endLineIndex,
        startOffset,
        endOffset,
        depth: d,
        confidence,
        weak: w,
        ...(explicit ? { explicit, bodyStart, bodyEnd } : {}),
      })
    );
  }
  return filtered;
}
