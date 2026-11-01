export const CITATION_FIELDS = ['author', 'year', 'title', 'publication', 'url', 'accessed'];

export const DEFAULT_CHECKUP = {
  checks: { citations: true, stale: true, links: true },
  requiredFields: CITATION_FIELDS,
  staleYears: 5,
  linkTimeoutSeconds: 10,
  archiveFallback: true,
};

const CARD_HEADING = /^####\s+(.*)$/;
const SECTION_HEADING = /^#{1,4}\s/;
const CITE_LINE = /^\*\*(.+?)\*\*(.*)$/;
const TITLE_PART = /"((?:[^"\\]|\\.)*)"/;
const LINK_PART = /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/;
const ACCESSED_PART = /Accessed\s+[^,\n]+/i;

const unescape = (value) => value.replace(/\\(.)/g, '$1');

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
 * Parse a bold citation line written by createCitation into its fields.
 * @param {string} line - The bold citation line, for example `**Smith 2024** — "Title", Pub, [url](url), Accessed 2024-01-02`.
 * @returns {object} - The citation fields; missing fields are empty strings.
 */
function parseCite(line) {
  const match = line.match(CITE_LINE);
  const lead = (match?.[1] || '').trim();
  const leadMatch = lead.match(/^(.*?)\s*((?:19|20)\d{2})$/);
  const rest = match?.[2] || '';
  const title = rest.match(TITLE_PART)?.[1] || '';
  const url = rest.match(LINK_PART)?.[1] || '';
  const accessed = rest.match(/Accessed\s+([^,\n]+)/i)?.[1]?.trim() || '';
  const remainder = rest.replace(/^\s*[—–-]\s*/, '').replace(TITLE_PART, '').replace(LINK_PART, '').replace(ACCESSED_PART, '');
  const publication = remainder.split(',').map((part) => part.trim()).find(Boolean) || '';
  return {
    author: unescape(leadMatch ? leadMatch[1] : lead).trim(),
    year: leadMatch ? leadMatch[2] : '',
    title: unescape(title),
    publication: unescape(publication),
    url,
    accessed,
  };
}

/**
 * Find every card (a `####` section) in the vault files and parse its first citation line.
 * @param {object} files - Map of note path to Markdown content.
 * @returns {object[]} - Cards with `path`, `title`, and `citation` (or null when the card has no citation line).
 */
export function scanCards(files) {
  const cards = [];
  for (const [path, content] of Object.entries(files || {})) {
    if (!isMarkdown(path)) continue;
    let card = null;
    const lines = String(content ?? '').split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const heading = line.match(CARD_HEADING);
      if (heading) {
        card = { path, title: heading[1].trim(), lineIndex, citation: null, hasCite: false };
        cards.push(card);
      } else if (SECTION_HEADING.test(line)) {
        card = null;
      } else if (card && !card.hasCite && line.startsWith('**')) {
        card.hasCite = true;
        card.citation = parseCite(line.trim());
      }
    }
  }
  return cards.map(({ hasCite, ...card }) => card);
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
        const missing = requiredFields.filter((field) => !card.citation[field]);
        if (missing.length) issues.push({ ...base, kind: 'missing_fields', fields: missing });
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
import { isMarkdown } from './vault.js';
