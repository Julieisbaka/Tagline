import { detectCards } from './cardDetection.js';
import { extractCardCitation } from './citationExtraction.js';
import { isMarkdown } from './vault.js';
import { Marked } from 'marked';
import { splitFrontmatter } from './frontmatter.js';

const markdown = new Marked({ gfm: true, breaks: true });

export const CITATION_FIELDS = ['author', 'year', 'title', 'publication', 'url', 'accessed'];

export const DEFAULT_CHECKUP = {
  checks: { citations: true, stale: true, links: true, recut: false },
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
    linkTimeoutSeconds: clampInt(
      options.linkTimeoutSeconds,
      1,
      60,
      DEFAULT_CHECKUP.linkTimeoutSeconds
    ),
    archiveFallback: options.archiveFallback ?? DEFAULT_CHECKUP.archiveFallback,
  };
}

/**
 * Find cards in Markdown notes and extract their citation candidates.
 * @param {object} files - Map of note path to Markdown content.
 * @returns {object[]} Cards with citations and document-relative UTF-16 field spans (end exclusive).
 *   Ibid inherits spans from the preceding citation in the same file, and lists inherited fields.
 */
export function scanCards(files) {
  const cards = [];
  for (const [path, content] of Object.entries(files || {})) {
    if (!isMarkdown(path)) {
      continue;
    }
    const text = String(content ?? '');
    const offsets = [0];
    for (const match of text.matchAll(/\r\n|\r|\n/g)) {
      offsets.push(match.index + match[0].length);
    }
    const references = markdown.lexer(splitFrontmatter(text).body).links;
    let previous = null;
    let previousSpans = {};
    for (const card of detectCards(text)) {
      const start = card.bodyStart ?? offsets[card.lineIndex + 1] ?? text.length;
      const extraction = extractCardCitation(
        text.slice(start, card.bodyEnd ?? card.endOffset),
        references,
        previous
      );
      const {
        citation,
        uncertainFields,
        fieldConfidence,
        fieldSpans,
        authorKind,
        inheritedFields,
      } = extraction;
      const spans = Object.fromEntries(
        Object.entries(fieldSpans).map(([field, span]) => [
          field,
          {
            start: start + span.start,
            end: start + span.end,
            ...(span.segments
              ? {
                  segments: span.segments.map((part) => ({
                    start: start + part.start,
                    end: start + part.end,
                  })),
                }
              : {}),
          },
        ])
      );
      for (const field of inheritedFields) {
        if (previousSpans[field]) {
          spans[field] = previousSpans[field];
        }
      }
      cards.push({
        path,
        title: card.title,
        lineIndex: card.lineIndex,
        bodyStart: start,
        bodyEnd: card.bodyEnd ?? card.endOffset,
        citation,
        citationUncertainFields: uncertainFields,
        citationFieldConfidence: fieldConfidence,
        citationFieldSpans: spans,
        citationAuthorKind: authorKind,
        citationInheritedFields: inheritedFields,
        ...(extraction.ibidResolved !== undefined
          ? { citationIbidResolved: extraction.ibidResolved }
          : {}),
      });
      previous = citation && extraction.ibidResolved !== false ? extraction : null;
      previousSpans = previous ? spans : {};
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
        const uncertain = requiredFields.filter((field) =>
          card.citationUncertainFields?.includes(field)
        );
        const missing = requiredFields.filter(
          (field) => !card.citation[field] && !uncertain.includes(field)
        );
        if (missing.length) {
          issues.push({ ...base, kind: 'missing_fields', fields: missing });
        }
        if (uncertain.length) {
          issues.push({ ...base, kind: 'uncertain_fields', fields: uncertain });
        }
      }
    }
    if (checks.stale && card.citation?.year) {
      const age = currentYear - Number(card.citation.year);
      if (age > staleYears) {
        issues.push({
          ...base,
          kind: 'stale_date',
          year: card.citation.year,
          age,
          threshold: staleYears,
        });
      }
    }
  }
  return issues;
}

/** Analyze highlighted readings locally. Results are suggestions for human review. */
export async function recutIssues(files, cards) {
  const { checkRecut } = await import('./recutCheck.js');
  const issues = [];
  for (const [index, card] of cards.entries()) {
    if (index % 10 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const body = files[card.path].slice(card.bodyStart, card.bodyEnd);
    const findings =
      body.length > 100000 ? [{ reason: 'too_long', excerpt: '' }] : checkRecut(body);
    issues.push(
      ...findings.map((finding) => ({
        path: card.path,
        card: card.title,
        lineIndex: card.lineIndex,
        kind: finding.reason === 'too_long' ? 'recut_unchecked' : 'possible_recut',
        ...finding,
      }))
    );
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
    if (result?.status !== 'dead') {
      continue;
    }
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

const comparableFields = ['author', 'year', 'title', 'publication'];
const normalizeField = (value) =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');

/** Compare only present, unambiguous fields against fetched source metadata. */
export function sourceIssues(cards, results) {
  const issues = [];
  for (const card of cards) {
    const url = card.citation?.url;
    const result = url && results[url];
    if (!result) {
      continue;
    }
    const base = { path: card.path, card: card.title, lineIndex: card.lineIndex };
    if (result.error) {
      issues.push({ ...base, kind: 'source_unavailable', reason: result.error });
      continue;
    }
    let compared = 0;
    for (const field of comparableFields) {
      const citationValue = card.citation[field];
      const sourceValue = result.metadata?.[field];
      if (!citationValue || !sourceValue || card.citationUncertainFields?.includes(field)) {
        continue;
      }
      const cited = normalizeField(citationValue);
      const source = normalizeField(sourceValue);
      if (!cited || !source) {
        continue;
      }
      compared++;
      const sameAuthor =
        field === 'author' &&
        (` ${source} `.includes(` ${cited} `) || ` ${cited} `.includes(` ${source} `));
      if (cited !== source && !sameAuthor) {
        issues.push({ ...base, kind: 'source_mismatch', field, citationValue, sourceValue });
      }
    }
    if (!compared) {
      issues.push({ ...base, kind: 'source_not_comparable' });
    }
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
    if (!byPath.has(card.path)) {
      byPath.set(card.path, []);
    }
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
        while (next < lines.length && !lines[next].trim()) {
          next++;
        }
        const match = lines[next]?.match(
          /^<!-- Evidence checkup \((citation|link|source|recut)\): (.*) -->$/
        );
        if (!match) {
          break;
        }
        spacing.push(...lines.slice(end, next));
        comments.set(match[1], lines[next]);
        end = next + 1;
      }
      for (const category of categories) {
        const messages = issues
          .filter(
            (issue) =>
              issue.path === path &&
              issue.lineIndex === card.lineIndex &&
              (issue.kind === 'dead_link'
                ? 'link'
                : issue.kind === 'possible_recut' || issue.kind === 'recut_unchecked'
                  ? 'recut'
                  : issue.kind === 'source_mismatch'
                    ? 'source'
                    : issue.kind.startsWith('source_')
                      ? null
                      : 'citation') === category
          )
          .map((issue) =>
            describe(issue)
              .replace(/[\r\n]+/g, ' ')
              .replace(/-{2,}/g, (dashes) => [...dashes].join(' '))
          );
        if (messages.length) {
          comments.set(
            category,
            `<!-- Evidence checkup (${category}): ${messages.join(' | ')} -->`
          );
        } else {
          comments.delete(category);
        }
      }
      lines.splice(card.lineIndex + 1, end - card.lineIndex - 1, ...comments.values(), ...spacing);
    }
    updated[path] = lines.join(newline);
  }
  return updated;
}

const stripMarkdown = (text) =>
  text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_=~`>#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Build a Markdown vault health report listing dead links found by a link check.
 * @param {object[]} cards - Cards from scanCards.
 * @param {object} results - Map of URL to link-check result.
 * @param {Date} [now]
 * @returns {string} Markdown document.
 */
export function vaultHealthReport(cards, results, now = new Date()) {
  const issues = linkIssues(cards, results);
  const lines = [
    '# Vault health report',
    '',
    `Generated ${now.toISOString().slice(0, 10)}. Cards scanned: ${cards.length}. Dead links: ${issues.length}.`,
    '',
  ];
  const byPath = new Map();
  for (const issue of issues) {
    byPath.set(issue.path, [...(byPath.get(issue.path) || []), issue]);
  }
  if (!issues.length) {
    lines.push('No dead links found.');
  }
  for (const [path, list] of byPath) {
    lines.push(`## ${path}`, '');
    for (const issue of list) {
      const archive = issue.archiveUrl ? ` ([archived](${issue.archiveUrl}))` : '';
      lines.push(`- ${issue.card}: <${issue.url}> (${issue.reason})${archive}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

/**
 * Build a new Markdown doc of card cites, optionally with taglines and first/last sentences.
 * @param {object} files - Map of note path to content.
 * @param {object[]} cards - Cards from scanCards.
 * @param {{tagline?: boolean, firstLast?: boolean}} [options]
 * @returns {string} Markdown document.
 */
export function citesExtract(files, cards, { tagline = false, firstLast = false } = {}) {
  const lines = ['# Cites extract', ''];
  for (const card of cards) {
    const [cite = '', ...rest] = files[card.path]
      .slice(card.bodyStart, card.bodyEnd)
      .trim()
      .split(/\r?\n[ \t]*\r?\n/);
    const citeText = stripMarkdown(cite);
    if (!citeText) {
      continue;
    }
    const entry = [];
    if (tagline) {
      entry.push(`**${stripMarkdown(card.title)}**`);
    }
    entry.push(citeText);
    if (firstLast) {
      const sentences = stripMarkdown(rest.join(' ')).match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g);
      const picked = sentences?.length ? [sentences[0], sentences.at(-1)] : [];
      if (sentences?.length === 1) {
        picked.pop();
      }
      if (picked.length) {
        entry.push(picked.map((s) => s.trim()).join(' … '));
      }
    }
    lines.push(entry.join('\n\n'), '');
  }
  return lines.join('\n').trimEnd() + '\n';
}
