const fs = require('node:fs/promises');
const path = require('node:path');
const { listVault } = require('../vaultFiles.cjs');
const { ToolError, flatten } = require('./vault.cjs');

const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
const MAX_EVIDENCE_FILES = 1000;
const MAX_EVIDENCE_HEADINGS = 5000;
const MAX_CITATION_CHARACTERS = 100_000;

function createEvidenceTools({ root, resolve }) {
  const pathProperty = (description) => ({ type: 'string', description });
  // Use the same parsers as the UI, including in packaged builds.
  const evidence = () => import('../../src/lib/evidenceCheckup.js');
  const citations = () => import('../../src/lib/citationExtraction.js');
  async function readEvidenceNote(full, base, remaining) {
    const realBase = await fs.realpath(base);
    const realFile = await fs.realpath(full);
    const relative = path.relative(realBase, realFile);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new ToolError('Evidence note resolves outside the vault.');
    }
    const handle = await fs.open(realFile, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) {
        throw new ToolError('Evidence scanning requires a regular Markdown file.');
      }
      if (stat.size > remaining) {
        throw new ToolError('Evidence scan exceeds the size limit. Specify a smaller note.');
      }
      // Check the limit while reading too, in case the file grows after stat().
      const parts = [];
      let total = 0;
      for (;;) {
        const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining - total + 1));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
        if (!bytesRead) {
          break;
        }
        total += bytesRead;
        if (total > remaining) {
          throw new ToolError('Evidence scan exceeds the size limit. Specify a smaller note.');
        }
        parts.push(chunk.subarray(0, bytesRead));
      }
      return { text: Buffer.concat(parts, total).toString('utf8'), bytes: total };
    } finally {
      await handle.close();
    }
  }
  async function evidenceCards(rel) {
    let files;
    if (rel !== undefined) {
      const note = resolve(rel, { note: true });
      if (!note.rel.toLowerCase().endsWith('.md')) {
        throw new ToolError('Evidence scanning requires a Markdown note.');
      }
      const content = await readEvidenceNote(note.full, root(), MAX_EVIDENCE_BYTES);
      files = { [note.rel]: content.text };
    } else {
      const base = root();
      const notes = flatten(await listVault(base)).filter((file) =>
        file.path.toLowerCase().endsWith('.md')
      );
      if (notes.length > MAX_EVIDENCE_FILES) {
        throw new ToolError('Too many notes to scan at once. Specify a note path.');
      }
      files = {};
      let bytes = 0;
      for (const note of notes) {
        const content = await readEvidenceNote(
          path.join(base, note.path),
          base,
          MAX_EVIDENCE_BYTES - bytes
        );
        bytes += content.bytes;
        files[note.path] = content.text;
      }
    }
    let apparentHeadings = 0;
    for (const content of Object.values(files)) {
      // Conservative preflight also counts headings inside fences; avoid parsing huge card sets.
      const headings = /(?:^|[\r\n]) {0,3}####(?=[ \t\r\n]|$)/g;
      while (headings.test(content)) {
        apparentHeadings++;
        if (apparentHeadings > MAX_EVIDENCE_HEADINGS) {
          throw new ToolError('Too many apparent card headings to scan. Specify a smaller note.');
        }
      }
    }
    return (await evidence()).scanCards(files);
  }
  function pageArgs(offset, limit, max) {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > max
    ) {
      throw new ToolError(`offset must be nonnegative and limit must be from 1 to ${max}.`);
    }
  }
  return [
    {
      name: 'list_cards',
      title: 'List evidence cards',
      description:
        'Find Markdown evidence cards and their extracted citations in one note or the open vault.',
      inputSchema: {
        type: 'object',
        properties: {
          path: pathProperty('Optional vault-relative Markdown note path.'),
          offset: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 1000 },
        },
      },
      annotations: { readOnlyHint: true },
      run: async ({ path: rel, offset = 0, limit = 100 } = {}) => {
        pageArgs(offset, limit, 1000);
        const cards = await evidenceCards(rel);
        return {
          count: cards.length,
          offset,
          cards: cards.slice(offset, offset + limit),
          truncated: offset + limit < cards.length,
        };
      },
    },
    {
      name: 'extract_citation',
      title: 'Extract citation',
      description:
        'Extract a citation candidate and uncertain fields from Markdown card text. Does not verify the source.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', maxLength: MAX_CITATION_CHARACTERS } },
        required: ['text'],
      },
      annotations: { readOnlyHint: true },
      run: async ({ text } = {}) => {
        if (typeof text !== 'string' || text.length > MAX_CITATION_CHARACTERS) {
          throw new ToolError(
            `text must be a string of at most ${MAX_CITATION_CHARACTERS} characters.`
          );
        }
        return (await citations()).extractCardCitation(text);
      },
    },
    {
      name: 'validate_isbn',
      title: 'Validate ISBN',
      description: 'Validate an ISBN-10 or ISBN-13 checksum. This does not look up the book.',
      inputSchema: {
        type: 'object',
        properties: { isbn: { type: 'string', maxLength: 100 } },
        required: ['isbn'],
      },
      annotations: { readOnlyHint: true },
      run: async ({ isbn } = {}) => {
        if (typeof isbn !== 'string' || isbn.length > 100) {
          throw new ToolError('isbn must be a string of at most 100 characters.');
        }
        return { isbn, valid: (await citations()).isValidIsbn(isbn) };
      },
    },
    {
      name: 'audit_evidence',
      title: 'Audit evidence',
      description:
        'Check cards for missing or uncertain citation fields and stale years. Offline only; does not check links or source accuracy.',
      inputSchema: {
        type: 'object',
        properties: {
          path: pathProperty('Optional vault-relative Markdown note path.'),
          staleYears: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 2000 },
        },
      },
      annotations: { readOnlyHint: true },
      run: async ({ path: rel, staleYears = 5, offset = 0, limit = 100 } = {}) => {
        if (!Number.isInteger(staleYears) || staleYears < 1 || staleYears > 100) {
          throw new ToolError('staleYears must be an integer from 1 to 100.');
        }
        pageArgs(offset, limit, 2000);
        const cards = await evidenceCards(rel);
        const issues = (await evidence()).auditCards(cards, {
          staleYears,
          checks: { links: false },
        });
        return {
          cardsScanned: cards.length,
          count: issues.length,
          offset,
          issues: issues.slice(offset, offset + limit),
          truncated: offset + limit < issues.length,
        };
      },
    },
  ];
}

module.exports = { createEvidenceTools };
