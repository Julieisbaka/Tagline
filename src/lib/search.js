import defaults from './defaultSettings.json' with { type: 'json' };
import { baseName, isMarkdown } from './vault.js';

/** 
 * Fold accents and case for locale-independent search matching.
 * This normalization ensures that searches are insensitive to diacritics and letter casing.
 * @param {string} text - The input text to normalize.
 * @returns {string} - The normalized text with accents removed and converted to lowercase.
 */
const fold = (text) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/** 
 * Split normalized text into Unicode letter/number tokens.
 * This function tokenizes the input text into an array of words and numbers, ignoring punctuation and other symbols.
 * @param {string} text - The input text to tokenize.
 * @returns {string[]} - An array of normalized tokens extracted from the text.
 */
const words = (text) => fold(text).match(/[\p{L}\p{N}]+/gu) || [];

export const HYBRID_CANDIDATE_LIMIT = 1000;

/** 
 * Validate a requested search-result count against the supported range.
 * This function ensures that the specified maximum number of search results is an integer between 1 and 1000, inclusive.
 * @param {number} maxResults - The requested maximum number of search results.
 * @returns {void}
 */
function validateLimit(maxResults) {
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 1000) {
    throw new Error('Maximum search results must be an integer between 1 and 1000.');
  }
}

/** 
 * Parse free-text search terms, quoted phrases, and tag filters.
 * This function extracts individual search terms, quoted phrases, and tag filters from a user query string.
 * @param {string} query - The raw search query input by the user.
 * @returns {object} - An object containing arrays of tags, terms, phrases, and the remaining text.
 */
export function parseQuery(query) {
  const tags = [...query.matchAll(/tag:#?([\w/-]+)/gi)].map((m) => m[1].toLowerCase());
  const text = query.replace(/tag:#?[\w/-]+/gi, '').trim();
  const terms = [...new Set([...text.matchAll(/"([^"]+)"|(\S+)/g)].map((m) => fold(m[1] || m[2])))];
  const phrases = [...text.matchAll(/"([^"]+)"/g)].map((m) => fold(m[1]));
  return { tags, terms, phrases, text };
}

/** 
 * Filter Markdown documents by parsed tag and phrase constraints.
 * This function checks each document in the vault against the specified tag filters and quoted phrases, returning only those that match all criteria.
 * @param {object} contents - An object mapping file paths to their Markdown content.
 * @param {object} index - An index object containing precomputed tag mappings.
 * @param {string} query - The raw search query input by the user.
 * @returns {object} - An object containing only the documents that satisfy the tag and phrase constraints.
 */
export function filterSearchDocuments(contents, index, query) {
  const parsed = parseQuery(query);
  return Object.fromEntries(Object.entries(contents).filter(([path, content]) =>
    isMarkdown(path) && matchesConstraints(path, fold(baseName(path)), fold(content), index, parsed)));
}

function matchesConstraints(path, title, body, index, { tags, phrases }) {
  return tags.every((tag) => (index.tags[tag] || []).includes(path)) &&
    phrases.every((phrase) => `${title} ${body}`.includes(phrase));
}

/** Prepare a snapshot once per vault-content change, not once per keystroke. */
export function createSearchEngine(contents, index) {
  const prepared = new Map(Object.entries(contents).filter(([path]) => isMarkdown(path))
    .map(([path, content]) => {
      const tokens = words(content);
      const counts = new Map();
      for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
      const title = fold(baseName(path));
      const lines = content.split('\n').map((text, line) => ({ text, line, normalized: fold(text) }));
      return [path, { path, title, body: fold(content), counts, length: tokens.length, lines }];
    }));

  return (query, maxResults = defaults.searchMaxResults, { matchAll = true } = {}) => {
    validateLimit(maxResults);
    if (!query.trim()) return [];
    const parsed = parseQuery(query);
    const { terms, phrases } = parsed;
    const documents = [...prepared.values()].filter((doc) =>
      matchesConstraints(doc.path, doc.title, doc.body, index, parsed));
    const exact = rankDocuments(documents, terms.map((term) => [term]), maxResults, matchAll);
    if (exact.length || !terms.length) return exact;

    // Only recover typos when exact search is empty; quoted phrases stay literal.
    const vocabulary = new Set(documents.flatMap((doc) => [...doc.counts.keys(), ...words(doc.title)]));
    const alternatives = terms.map((term) => {
      if (phrases.includes(term) || term.length < 5 || words(term).length !== 1 ||
        documents.some((doc) => `${doc.title} ${doc.body}`.includes(term))) return [term];
      return [term, ...[...vocabulary].filter((word) => oneEditApart(term, word))];
    });
    if (alternatives.every((items) => items.length === 1)) return [];
    return rankDocuments(documents, alternatives, maxResults, matchAll)
      .map((result) => ({ ...result, approximate: true }));
  };
}

function oneEditApart(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    return a.slice(i + 1) === b.slice(i + 1) ||
      (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

function rankDocuments(documents, alternatives, maxResults, matchAll) {
  const average = documents.reduce((n, doc) => n + doc.length, 0) / Math.max(1, documents.length);
  const frequencies = alternatives.map((terms) => documents.filter(({ title, body }) =>
    terms.some((term) => title.includes(term) || body.includes(term))).length);
  return documents.flatMap(({ path, title, body, counts, length, lines }) => {
    const terms = alternatives.map((items) => items.find((term) => `${title} ${body}`.includes(term)));
    if (terms.length && !(matchAll ? terms.every(Boolean) : terms.some(Boolean))) return [];
    const matchedTerms = terms.filter(Boolean);
    const queryText = matchedTerms.join(' ');
    let rank = 0;
    const titleWords = new Set(words(title));
    for (const [i, term] of terms.entries()) {
      if (!term) continue;
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
    const passages = lines.map(({ text, line, normalized }) => {
      const found = matchedTerms.filter((term) => normalized.includes(term));
      const count = found.length;
      const heading = /^#{1,6}\s/.test(text);
      if (heading) found.forEach((term) => headingTerms.add(term));
      const positions = found.map((term) => normalized.indexOf(term));
      const span = count > 1 ? Math.max(...positions) - Math.min(...positions) : 0;
      const proximity = count > 1 ? count / (1 + span / 80) : 0;
      return { line, text, weight: count + proximity + (heading ? 0.5 : 0), proximity };
    }).filter((m) => m.weight >= 1).sort((a, b) => b.weight - a.weight || a.line - b.line);
    rank += (passages[0]?.proximity || 0) * 2;
    const matches = passages.slice(0, 4).map(({ line, text }) => ({ line, text }));
    rank += headingTerms.size * 2;
    return [{ path, matches, rank, matchedTerms }];
  }).sort((a, b) => b.rank - a.rank || a.path.localeCompare(b.path)).slice(0, maxResults);
}

/** Rank Markdown notes, preserving strict tags/phrases and recovering single-edit typos only on empty searches. */
export function searchVault(contents, index, query, maxResults = defaults.searchMaxResults, options = {}) {
  return createSearchEngine(contents, index)(query, maxResults, options);
}

/** Split a match-centered excerpt into highlighted and plain segments, preserving original Unicode. */
export function searchExcerpt(text, terms, maxLength = 200) {
  const offsets = [];
  let normalized = '';
  let offset = 0;
  for (const character of text) {
    const value = fold(character);
    for (let i = 0; i < value.length; i++) offsets.push(offset);
    normalized += value;
    offset += character.length;
  }
  offsets.push(text.length);
  const ranges = [];
  for (const term of terms.map(fold).filter(Boolean)) {
    let start = normalized.indexOf(term);
    while (start !== -1) {
      ranges.push([offsets[start], offsets[start + term.length]]);
      start = normalized.indexOf(term, start + term.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  // Prefer a window containing multiple matches, rather than always clipping at column 200.
  let start = 0;
  let bestCount = 0;
  let right = 0;
  for (let left = 0; left < ranges.length; left++) {
    const candidate = Math.max(0, ranges[left][0] - 40);
    right = Math.max(left, right);
    while (right < ranges.length && ranges[right][1] <= candidate + maxLength) right++;
    if (right - left > bestCount) {
      start = candidate;
      bestCount = right - left;
    }
  }
  const end = Math.min(text.length, start + maxLength);
  const segments = [];
  let cursor = start;
  if (start) segments.push({ text: '…', match: false });
  for (const [from, to] of ranges) {
    if (to <= cursor || from >= end) continue;
    if (from > cursor) segments.push({ text: text.slice(cursor, from), match: false });
    segments.push({ text: text.slice(Math.max(cursor, from), Math.min(end, to)), match: true });
    cursor = Math.min(end, to);
  }
  if (cursor < end) segments.push({ text: text.slice(cursor, end), match: false });
  if (end < text.length) segments.push({ text: '…', match: false });
  return segments;
}

/** 
 * Merge keyword and semantic rankings using reciprocal-rank fusion.
 * This function combines the results from keyword-based and semantic search, giving higher priority to documents that rank well in both, while ensuring a balanced fusion of scores.
 * @param {object[]} keywordResults - An array of search result objects from the keyword search.
 * @param {object[]} semanticResults - An array of search result objects from the semantic search.
 * @param {number} [maxResults] - The maximum number of merged search results to return.
 * @returns {object[]} - An array of merged and ranked search result objects.
 */
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
      if (result.matchedTerms) item.matchedTerms = result.matchedTerms;
      if (result.approximate) item.approximate = true;
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
