import { detectCards } from './cardDetection.js';
import { extractCardCitation } from './citationExtraction.js';
import { isMarkdown } from './vault.js';

export const CITATION_FIELDS = ['author', 'year', 'title', 'publication', 'url', 'accessed'];

export const DEFAULT_CHECKUP = {
  checks: { citations: true, stale: true, links: true },
  requiredFields: CITATION_FIELDS,
  staleYears: 5,
  linkTimeoutSeconds: 10,
  archiveFallback: true,
};

/**
 * Normalize user-chosen checkup settings, falling back to defaults for invalid values.
 * @param {object} [options] - Partial checkup settings.
 * @returns {object} - Complete, validated checkup settings.
 */
export function normalizeCheckup(options = {}) {
  const clampInt = (value, min, max, fallback) => {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };
  return {
    checks: { ...DEFAULT_CHECKUP.checks, ...options.checks },
    requiredFields: Array.isArray(options.requiredFields)
      ? CITATION_FIELDS.filter((field) => options.requiredFields.includes(field))
      : DEFAULT_CHECKUP.requiredFields,
    staleYears: clampInt(options.staleYears, 1, 100, DEFAULT_CHECKUP.staleYears),
    linkTimeoutSeconds: clampInt(options.linkTimeoutSeconds, 1, 60, DEFAULT_CHECKUP.linkTimeoutSeconds),
    archiveFallback: options.archiveFallback ?? DEFAULT_CHECKUP.archiveFallback,
  };
}

/**
 * Find cards in Markdown notes and extract their citation candidates.
 * @param {object} files - Map of note path to Markdown content.
 * @returns {object[]} - Cards with `path`, `title`, and `citation` (or null when the card has no citation line).
 */
export function scanCards(files) {
  const cards = [];
  for (const [path, content] of Object.entries(files || {})) {
    if (!isMarkdown(path)) continue;
    const text = String(content ?? '');
    const lines = text.split(/\r\n?|\n/);
    for (const card of detectCards(text)) {
      const { citation, uncertainFields } = extractCardCitation(lines.slice(card.lineIndex + 1, card.endLineIndex).join('\n'));
      cards.push({
        path, title: card.title, lineIndex: card.lineIndex, citation, citationUncertainFields: uncertainFields,
      });
    }
  }
  return cards;
}

/**
 * List the unique URLs cited by the cards.
 * @param {object[]} cards - Cards from scanCards.
 * @returns {string[]} - Unique citation URLs.
 */
export function citedUrls(cards) {
  return [...new Set(cards.map((card) => card.citation?.url).filter(Boolean))];
}

/**
 * Flag cards with missing citation fields or stale source dates.
 * @param {object[]} cards - Cards from scanCards.
 * @param {object} [options] - Checkup settings (see normalizeCheckup).
 * @param {Date} [now] - The reference date for stale checks.
 * @returns {object[]} - Issues with `path`, `card`, `kind`, and `detail`.
 */
export function auditCards(cards, options = {}, now = new Date()) {
  const { checks, requiredFields, staleYears } = normalizeCheckup(options);
  const issues = [];
  const currentYear = now.getFullYear();
  for (const card of cards) {
    const base = { path: card.path, card: card.title, lineIndex: card.lineIndex };
    if (checks.citations) {
      if (!card.citation) {
        issues.push({ ...base, kind: 'missing_citation' });
      } else {
        const uncertain = requiredFields.filter((field) => card.citationUncertainFields?.includes(field));
        const missing = requiredFields.filter((field) => !card.citation[field] && !uncertain.includes(field));
        if (missing.length) issues.push({ ...base, kind: 'missing_fields', fields: missing });
        if (uncertain.length) issues.push({ ...base, kind: 'uncertain_fields', fields: uncertain });
      }
    }
    if (checks.stale && card.citation?.year) {
      const age = currentYear - Number(card.citation.year);
      if (age > staleYears) {
        issues.push({ ...base, kind: 'stale_date', year: card.citation.year, age, threshold: staleYears });
      }
    }
  }
  return issues;
}

/**
 * Turn link-check results into issues for cards whose cited URL no longer resolves.
 * Unverified links (timeouts, blocked requests) are not reported as problems.
 * @param {object[]} cards - Cards from scanCards.
 * @param {object} results - Map of URL to `{ status, reason, archiveUrl }` from the link checker.
 * @returns {object[]} - `dead_link` issues.
 */
export function linkIssues(cards, results) {
  const issues = [];
  for (const card of cards) {
    const url = card.citation?.url;
    const result = url && results?.[url];
    if (result?.status !== 'dead') continue;
    issues.push({
      path: card.path,
      card: card.title,
      lineIndex: card.lineIndex,
      kind: 'dead_link',
      url,
      reason: result.reason,
      archiveUrl: result.archiveUrl || '',
    });
  }
  return issues;
}

/**
 * Refresh checkup-owned comments immediately after each card heading.
 * Only the requested categories are replaced, so a link check preserves citation results.
 */
export function annotateEvidence(files, cards, issues, categories, describe) {
  const updated = { ...files };
  const byPath = new Map();
  for (const card of cards) {
    if (!byPath.has(card.path)) byPath.set(card.path, []);
    byPath.get(card.path).push(card);
  }
  for (const [path, fileCards] of byPath) {
    const original = files[path];
    const newline = original.includes('\r\n') ? '\r\n' : '\n';
    const lines = original.split(/\r?\n/);
    for (const card of [...fileCards].reverse()) {
      const comments = new Map();
      const spacing = [];
      let end = card.lineIndex + 1;
      while (end < lines.length) {
        let next = end;
        while (next < lines.length && !lines[next].trim()) next++;
        const match = lines[next]?.match(/^<!-- Evidence checkup \((citation|link)\): (.*) -->$/);
        if (!match) break;
        spacing.push(...lines.slice(end, next));
        comments.set(match[1], lines[next]);
        end = next + 1;
      }
      for (const category of categories) {
        const messages = issues.filter((issue) => issue.path === path && issue.lineIndex === card.lineIndex &&
          (issue.kind === 'dead_link' ? 'link' : 'citation') === category)
          .map((issue) => describe(issue).replace(/[\r\n]+/g, ' ').replace(/-{2,}/g, (dashes) => [...dashes].join(' ')));
        if (messages.length) comments.set(category, `<!-- Evidence checkup (${category}): ${messages.join(' | ')} -->`);
        else comments.delete(category);
      }
      lines.splice(card.lineIndex + 1, end - card.lineIndex - 1, ...comments.values(), ...spacing);
    }
    updated[path] = lines.join(newline);
  }
  return updated;
}
