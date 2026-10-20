import { baseName, isMarkdown } from './vault.js';

const fold = (text) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
const words = (text) => fold(text).match(/[\p{L}\p{N}]+/gu) || [];

export function parseQuery(query) {
  const tags = [...query.matchAll(/tag:#?([\w/-]+)/gi)].map((m) => m[1].toLowerCase());
  const text = query.replace(/tag:#?[\w/-]+/gi, '').trim();
  const terms = [...text.matchAll(/"([^"]+)"|(\S+)/g)].map((m) => fold(m[1] || m[2]));
  return { tags, terms, text };
}

export function searchVault(contents, index, query, maxResults = 200) {
  const { tags, terms, text } = parseQuery(query);
  if (!query.trim()) return [];
  const documents = Object.entries(contents).filter(([p]) =>
    isMarkdown(p) && tags.every((tag) => (index.tags[tag] || []).includes(p)));
  const average = documents.reduce((n, [, c]) => n + words(c).length, 0) / Math.max(1, documents.length);
  const frequencies = terms.map((term) => documents.filter(([p, c]) => fold(`${baseName(p)} ${c}`).includes(term)).length);
  return documents.flatMap(([path, content]) => {
    const title = fold(baseName(path));
    const body = fold(content);
    if (!terms.every((term) => `${title} ${body}`.includes(term))) return [];
    const length = words(content).length;
    let rank = 0;
    for (const [i, term] of terms.entries()) {
      // BM25 saturation and length normalization avoid rewarding long, repetitive files.
      const tf = body.split(term).length - 1;
      const idf = Math.log(1 + (documents.length - frequencies[i] + 0.5) / (frequencies[i] + 0.5));
      rank += idf * (tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * length / Math.max(1, average))));
      if (title === term) rank += 12;
      else if (title.includes(term)) rank += 6;
    }
    if (text && body.includes(fold(text.replace(/"/g, '')))) rank += 3;
    const matches = content.split('\n').map((line, lineNumber) => {
      const count = terms.filter((term) => fold(line).includes(term)).length;
      const heading = /^#{1,6}\s/.test(line);
      if (heading) rank += count * 2;
      return { line: lineNumber, text: line, weight: count + (heading ? 0.5 : 0) };
    }).filter((m) => m.weight >= 1).sort((a, b) => b.weight - a.weight || a.line - b.line).slice(0, 4);
    return [{ path, matches, rank }];
  }).sort((a, b) => b.rank - a.rank || a.path.localeCompare(b.path)).slice(0, maxResults);
}
