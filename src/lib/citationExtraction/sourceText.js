// Original ranges use encoded offsets (including CRLF width); generated characters have no range.
export function sourceText(value) {
  const text = String(value ?? '');
  const normalized = text.replace(/\r\n?/g, '\n');
  const ranges = new Float64Array(normalized.length);
  let index = 0;
  for (let i = 0; i < text.length; i++) {
    const start = i;
    if (text[i] === '\r' && text[i + 1] === '\n') {
      i++;
    }
    ranges[index++] = start * 2 + (i - start);
  }
  return { text: normalized, ranges };
}

export const sliceText = (value, start, end) => ({
  text: value.text.slice(start, end),
  ranges: value.ranges.slice(start, end),
});
export const joinText = (parts, separator = '') => {
  const result = { text: '', ranges: [] };
  parts.forEach((part, i) => {
    if (i) {
      result.text += separator;
      result.ranges.push(...Array(separator.length).fill(null));
    }
    result.text += part.text;
    for (const range of part.ranges) {
      result.ranges.push(range);
    }
  });
  return result;
};
export const spanOf = (value, start = 0, end = value.text.length) => {
  const segments = [];
  for (let i = start; i < end; i++) {
    let range = value.ranges[i];
    if (range == null) {
      continue;
    }
    if (typeof range === 'number') {
      const start = Math.floor(range / 2);
      range = { start, end: start + 1 + (range % 2) };
    }
    const last = segments[segments.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      segments.push({ ...range });
    }
  }
  if (!segments.length) {
    return undefined;
  }
  return {
    start: segments[0].start,
    end: segments[segments.length - 1].end,
    ...(segments.length > 1 ? { segments } : {}),
  };
};
export const matchIndices = (value, regex) =>
  new RegExp(regex.source, regex.flags.includes('d') ? regex.flags : regex.flags + 'd').exec(value);

function replaceText(value, regex, replacement) {
  const parts = [];
  let last = 0;
  for (const match of value.text.matchAll(regex)) {
    parts.push(sliceText(value, last, match.index));
    const text = replacement(match);
    const span = spanOf(value, match.index, match.index + match[0].length);
    parts.push(
      text === match[0]
        ? sliceText(value, match.index, match.index + match[0].length)
        : { text, ranges: Array(text.length).fill(span || null) }
    );
    last = match.index + match[0].length;
  }
  parts.push(sliceText(value, last));
  return joinText(parts);
}

export function collapseText(value) {
  const collapsed = replaceText(value, /\s+/g, () => ' ');
  const start = collapsed.text.length - collapsed.text.trimStart().length;
  return sliceText(collapsed, start, collapsed.text.trimEnd().length);
}

export function resolveReferences(value, references) {
  const resolve = (match) => {
    const key = (match[2] || match[1]).trim().replace(/\s+/g, ' ').toLowerCase();
    const href = references?.[key]?.href;
    return typeof href === 'string' && /^https?:\/\//i.test(href)
      ? `[${match[1]}](${href})`
      : match[0];
  };
  const resolved = replaceText(value, /\[([^\]\n]+)\]\[([^\]\n]*)\]/g, resolve);
  return replaceText(resolved, /\[([^\]\n]+)\](?![\[(])/g, resolve);
}
