const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const normalize = (word) => word.normalize('NFKC').toLowerCase().replace(/’/g, "'");

function words(text) {
  return [...text.matchAll(WORD)].map((match) => ({
    value: normalize(match[0]),
    start: match.index,
    end: match.index + match[0].length,
  }));
}

/** Prepare editable evidence text from a card, leaving the user in control of the quote. */
export function cardQuote(card, hasCitation = true) {
  const lines = card.split(/\r\n?|\n/).filter((line) => !/^\s*#{1,6}\s/.test(line));
  const first = lines.findIndex((line) => line.trim());
  if (hasCitation && first >= 0 && /^\s*(?:\*\*[^*\n]+\*\*|__[^_\n]+__)/.test(lines[first])) {
    lines.splice(first, 1);
  }
  return lines
    .join('\n')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(x[\da-f]+|\d+);/gi, (original, code) => {
      const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : original;
    })
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/gi,
      (_, name) =>
        ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[name.toLowerCase()]
    )
    .replace(/(?:==|\+\+|\*\*|__)/g, '')
    .trim();
}

/** Compare word sequences, returning source character ranges. This does not establish meaning or context. */
export function verifyQuote(quote, source) {
  if (
    typeof quote !== 'string' ||
    typeof source !== 'string' ||
    quote.length > 20000 ||
    source.length > 2000000
  ) {
    throw new Error('Quote or source text is too large to compare.');
  }
  const sourceWords = words(source);
  const chunks = quote
    .split(/\.{3,}|…/)
    .map(words)
    .filter((chunk) => chunk.length);
  const quoteCount = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (!quoteCount || !sourceWords.length) {
    return { status: 'unverified', ranges: [], matched: 0, total: quoteCount };
  }

  // Delimited normalized words make exact subsequence search independent of punctuation and spacing.
  const positions = [];
  let encoded = '|';
  for (const word of sourceWords) {
    positions.push(encoded.length);
    encoded += `${word.value}|`;
  }
  const ranges = [];
  let cursor = 0;
  let matched = 0;
  let separated = false;
  let attempts = 0;
  for (const chunk of chunks) {
    let at = 0;
    while (at < chunk.length) {
      // Bound work for long or unrelated input on large pages.
      if (++attempts > 200) {
        break;
      }
      let found = -1;
      let length = chunk.length - at;
      const start = cursor < positions.length ? positions[cursor] - 1 : encoded.length;
      // Try the complete remainder first, then locate a conservative three-word anchor.
      const full = `|${chunk
        .slice(at)
        .map((word) => word.value)
        .join('|')}|`;
      let offset = encoded.indexOf(full, start);
      if (offset >= 0) {
        found = positions.indexOf(offset + 1, cursor);
      } else if (length >= 3) {
        const anchor = `|${chunk
          .slice(at, at + 3)
          .map((word) => word.value)
          .join('|')}|`;
        offset = encoded.indexOf(anchor, start);
        if (offset >= 0) {
          found = positions.indexOf(offset + 1, cursor);
          length = 3;
          while (
            found + length < sourceWords.length &&
            at + length < chunk.length &&
            sourceWords[found + length].value === chunk[at + length].value
          ) {
            length++;
          }
        }
      }
      if (found < 0) {
        at++;
        continue;
      }
      if (ranges.length && found !== cursor) {
        separated = true;
      }
      ranges.push({ start: sourceWords[found].start, end: sourceWords[found + length - 1].end });
      cursor = found + length;
      matched += length;
      at += length;
    }
  }
  const status =
    matched !== quoteCount ? 'review' : separated || /\.{3,}|…/.test(quote) ? 'omission' : 'match';
  return { status, ranges, matched, total: quoteCount, limited: attempts > 200 };
}
