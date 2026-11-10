function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function standardizeLine(line, marker) {
  const escaped = escapeRegExp(marker);
  let result = line.replace(new RegExp(`${escaped}([^\\n]*?)${escaped}`, 'g'), (match, content) => {
    const leading = content.match(/^[ \t]*/)[0];
    const trailing = content.match(/[ \t]*$/)[0];
    const body = content.slice(leading.length, content.length - trailing.length);
    return body ? `${leading}${marker}${body}${marker}${trailing}` : content;
  });

  const adjacent = new RegExp(
    `${escaped}([^\\n]*?\\S)${escaped}([ \\t]*(?:[\\p{P}\\p{S}][ \\t]*)*)${escaped}(\\S[^\\n]*?)${escaped}`,
    'gu'
  );
  let previous;
  do {
    previous = result;
    result = result.replace(adjacent, (_match, left, separator, right) =>
      `${marker}${left}${separator}${right}${marker}`
    );
  } while (result !== previous);

  return result;
}

function standardize(text, marker) {
  let fence = null;
  return text
    .split(/(\r?\n)/)
    .map((line) => {
      if (line === '\n' || line === '\r\n') {
        return line;
      }
      const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fence) {
        if (
          fenceMatch &&
          fenceMatch[1][0] === fence.character &&
          fenceMatch[1].length >= fence.length &&
          new RegExp(`^ {0,3}${fence.character}{${fence.length},}[ \\t]*$`).test(line)
        ) {
          fence = null;
        }
        return line;
      }
      if (fenceMatch) {
        fence = { character: fenceMatch[1][0], length: fenceMatch[1].length };
        return line;
      }

      let output = '';
      let cursor = 0;
      for (const match of line.matchAll(/(`+).*?\1/g)) {
        output += standardizeLine(line.slice(cursor, match.index), marker) + match[0];
        cursor = match.index + match[0].length;
      }
      return output + standardizeLine(line.slice(cursor), marker);
    })
    .join('');
}

/** Trim spaces out of highlights and join adjacent highlights across spaces or punctuation. */
export const standardizeHighlights = (text) =>
  typeof text === 'string' ? standardize(text, '==') : text;

/** Trim spaces out of bold spans and join adjacent bold spans across spaces or punctuation. */
export const standardizeBold = (text) =>
  typeof text === 'string' ? standardize(text, '**') : text;

/** Standardize highlights and bold markup in Markdown text. */
export const standardizeAll = (text) =>
  typeof text === 'string' ? standardizeBold(standardizeHighlights(text)) : text;
