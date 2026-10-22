import { baseName, isMarkdown } from './vault.js';
import defaults from './defaultSettings.json' with { type: 'json' };

const fold = (text) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const words = (text) => fold(text).match(/[\p{L}\p{N}]+/gu) || [];
export const HYBRID_CANDIDATE_LIMIT = 1000;

function validateLimit(maxResults) {
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 1000) {
    throw new Error('Maximum search results must be an integer between 1 and 1000.');
  }
}

export function parseQuery(query) {
  const tags = [...query.matchAll(/tag:#?([\w/-]+)/gi)].map((m) => m[1].toLowerCase());
  const text = query.replace(/tag:#?[\w/-]+/gi, '').trim();
  const terms = [...new Set([...text.matchAll(/"([^"]+)"|(\S+)/g)].map((m) => fold(m[1] || m[2])))];
  const phrases = [...text.matchAll(/"([^"]+)"/g)].map((m) => fold(m[1]));
  return { tags, terms, phrases, text };
}

export function filterSearchDocuments(contents, index, query) {
  const { tags, phrases } = parseQuery(query);
  return Object.fromEntries(Object.entries(contents).filter(([path, content]) =>
    isMarkdown(path) && tags.every((tag) => (index.tags[tag] || []).includes(path)) &&
    phrases.every((phrase) => `${fold(baseName(path))} ${fold(content)}`.includes(phrase))));
}

export function searchVault(contents, index, query, maxResults = defaults.searchMaxResults, { matchAll = true } = {}) {
  validateLimit(maxResults);
  const { terms } = parseQuery(query);
  if (!query.trim()) return [];
  const documents = Object.entries(filterSearchDocuments(contents, index, query))
    .map(([path, content]) => {
      const tokens = words(content);
      const counts = new Map();
      for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
      return { path, content, title: fold(baseName(path)), body: fold(content), counts, length: tokens.length };
    });
  const average = documents.reduce((n, doc) => n + doc.length, 0) / Math.max(1, documents.length);
  const frequencies = terms.map((term) => documents.filter(({ title, body }) => title.includes(term) || body.includes(term)).length);
  const queryText = terms.join(' ');
  return documents.flatMap(({ path, content, title, body, counts, length }) => {
    const matchesTerm = (term) => `${title} ${body}`.includes(term);
    if (terms.length && !(matchAll ? terms.every(matchesTerm) : terms.some(matchesTerm))) return [];
    let rank = 0;
    const titleWords = new Set(words(title));
    for (const [i, term] of terms.entries()) {
      // BM25 saturation and length normalization avoid rewarding long, repetitive files.
      const exact = counts.get(term) || 0;
      const tf = exact || body.split(term).length - 1;
      const idf = Math.log(1 + (documents.length - frequencies[i] + 0.5) / (frequencies[i] + 0.5));
      const partial = !exact && words(term).length === 1;
      rank += (partial ? 0.35 : 1) * idf * (tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * length / Math.max(1, average))));
      if (title === term) rank += 12;
      else if (titleWords.has(term)) rank += 6;
      else if (title.includes(term)) rank += 2;
    }
    if (queryText && title === queryText) rank += 8;
    if (queryText && body.includes(queryText)) rank += 3;
    const headingTerms = new Set();
    const matches = content.split('\n').map((line, lineNumber) => {
      const normalized = fold(line);
      const found = terms.filter((term) => normalized.includes(term));
      const count = found.length;
      const heading = /^#{1,6}\s/.test(line);
      if (heading) found.forEach((term) => headingTerms.add(term));
      return { line: lineNumber, text: line, weight: count + (heading ? 0.5 : 0) };
    }).filter((m) => m.weight >= 1).sort((a, b) => b.weight - a.weight || a.line - b.line).slice(0, 4);
    rank += headingTerms.size * 2;
    return [{ path, matches, rank }];
  }).sort((a, b) => b.rank - a.rank || a.path.localeCompare(b.path)).slice(0, maxResults);
}

export function mergeHybridResults(keywordResults, semanticResults, maxResults = defaults.searchMaxResults) {
  validateLimit(maxResults);
  const merged = new Map();
  for (const [source, results] of [['keyword', keywordResults], ['semantic', semanticResults]]) {
    const seen = new Set();
    results.forEach((result, position) => {
      if (seen.has(result.path)) return;
      seen.add(result.path);
      const item = merged.get(result.path) || { path: result.path, matches: [], sources: [], rank: 0 };
      // Reciprocal-rank fusion combines unlike scores without treating cosine as BM25.
      item.rank += 1 / (60 + position + 1);
      item.sources.push(source);
      const matches = source === 'keyword' ? result.matches : [{ line: result.line, text: result.text }];
      for (const match of matches) {
        if (item.matches.length < 4 && !item.matches.some((existing) => existing.line === match.line)) {
          item.matches.push(match);
        }
      }
      if (source === 'semantic') item.score = result.score;
      merged.set(result.path, item);
    });
  }
  return [...merged.values()]
    .sort((a, b) => b.rank - a.rank || a.path.localeCompare(b.path)).slice(0, maxResults);
}
