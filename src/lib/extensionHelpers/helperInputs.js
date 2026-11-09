import { marked } from 'marked';
import { parseDate } from '../calendar.js';
import { splitFrontmatter } from '../frontmatter.js';

/**
 * Maximum input text accepted by extension pure-text helpers.
 */
export const MAX_HELPER_TEXT = 100_000;

/**
 * Run a bounded path-formatting helper without accessing the filesystem.
 * @param {string} operation
 * @param {string[]} args
 * @returns {string}
 */
export function pathHelper(operation, args) {
  /**
   * Normalize a vault-relative path and reject traversal above its root.
   * @param {string} input
   * @returns {string}
   */
  const normalize = (input) => {
    if (typeof input !== 'string' || input.length > 1000 || /^[\\/]|^[a-z]:/i.test(input)) {
      throw new Error('Use a vault-relative path up to 1,000 characters.');
    }
    const parts = [];
    for (const part of input.replace(/\\/g, '/').split('/')) {
      if (!part || part === '.') {
        continue;
      }
      if (part === '..') {
        if (!parts.length) {
          throw new Error('Path escapes the vault.');
        }
        parts.pop();
      } else {
        parts.push(part);
      }
    }
    return parts.join('/');
  };
  if (operation === 'join') {
    if (
      !args.length ||
      args.some((input) => typeof input !== 'string' || /^[\\/]|^[a-z]:/i.test(input))
    ) {
      throw new Error('Use vault-relative paths.');
    }
    return normalize(args.join('/'));
  }
  const path = normalize(args[0]);
  if (operation === 'normalize') {
    return path;
  }
  if (operation === 'basename') {
    return path.split('/').pop() || '';
  }
  if (operation === 'dirname') {
    return path.split('/').slice(0, -1).join('/');
  }
  if (operation === 'extname') {
    return (
      path
        .split('/')
        .pop()
        ?.match(/^.+(\.[^.]*)$/)?.[1] || ''
    );
  }
  throw new Error('Unknown path helper.');
}

/**
 * Convert Markdown to plain text, excluding HTML and YAML metadata.
 * @param {string} markdown
 * @returns {string}
 */
export function markdownToText(markdown) {
  /**
   * Recursively collect readable text from Markdown lexer tokens.
   * @param {object[]} tokens
   * @returns {string}
   */
  const collect = (tokens) =>
    tokens
      .map((token) => {
        if (token.type === 'html') {
          return '';
        }
        if (token.type === 'image') {
          return token.text || '';
        }
        if (token.type === 'table') {
          return [...token.header, ...token.rows.flat()]
            .map((cell) => collect(cell.tokens))
            .join(' ');
        }
        if (token.items) {
          return collect(token.items);
        }
        if (token.tokens) {
          return collect(token.tokens);
        }
        return (
          token.text || (token.type === 'br' || token.type === 'space' ? '\n' : token.raw || '')
        );
      })
      .join(' ');
  return collect(marked.lexer(splitFrontmatter(markdown).body))
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .trim();
}

/**
 * Validate text arguments passed to extension utility helpers.
 * @param {*} value
 * @param {string} label
 * @returns {string}
 */
export function requireHelperText(value, label) {
  if (typeof value !== 'string' || value.length > MAX_HELPER_TEXT) {
    throw new Error(`${label} must be text up to ${MAX_HELPER_TEXT} characters.`);
  }
  return value;
}

/**
 * Validate optional Markdown reference definitions supplied to citation extraction.
 * @param {*} value
 * @returns {object}
 */
export function requireReferences(value) {
  if (value === undefined) {
    return {};
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('References must be an object mapping labels to { href }.');
  }
  const entries = Object.entries(value);
  if (entries.length > 10_000) {
    throw new Error('References must contain at most 10,000 entries.');
  }
  const references = {};
  for (const [key, entry] of entries) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.href !== 'string' ||
      entry.href.length > 10_000
    ) {
      throw new Error('Each reference must include an href string up to 10,000 characters.');
    }
    references[key] = { href: entry.href };
  }
  return references;
}

/**
 * Validate a bounded list of vault-relative paths.
 * @param {*} value
 * @returns {string[]}
 */
export function requirePaths(value) {
  if (
    !Array.isArray(value) ||
    value.length > 10_000 ||
    value.some((path) => typeof path !== 'string' || path.length > 1000)
  ) {
    throw new Error('Paths must be an array of at most 10,000 vault-relative paths.');
  }
  return value;
}

/**
 * Validate a bounded list of helper IDs.
 * @param {*} value
 * @returns {string[]}
 */
export function requireIds(value) {
  if (
    !Array.isArray(value) ||
    value.length > 1000 ||
    value.some((id) => typeof id !== 'string' || id.length > 200)
  ) {
    throw new Error('IDs must be an array of at most 1,000 strings no longer than 200 characters.');
  }
  return value;
}

/**
 * Validate and bound caller-supplied path-to-Markdown content.
 * @param {*} value
 * @returns {Record<string,string>}
 */
export function requireDocuments(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Documents must be a path-to-text object.');
  }
  const entries = Object.entries(value);
  if (
    entries.length > 10_000 ||
    entries.some(
      ([path, text]) =>
        typeof path !== 'string' ||
        path.length > 1000 ||
        typeof text !== 'string' ||
        text.length > MAX_HELPER_TEXT
    )
  ) {
    throw new Error(
      'Documents must contain at most 10,000 paths and text values up to 100,000 characters.'
    );
  }
  if (entries.reduce((total, [, text]) => total + text.length, 0) > 1_000_000) {
    throw new Error('Document text must total no more than 1,000,000 characters.');
  }
  return value;
}

/**
 * Validate a bounded nonnegative row or column index.
 * @param {*} value
 * @param {string} label
 * @returns {number}
 */
export function requireCoordinate(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100_000) {
    throw new Error(`${label} must be an integer from 0 to 100,000.`);
  }
  return value;
}

/**
 * Validate bounded two-dimensional flow cell text.
 * @param {*} value
 * @param {string} label
 * @returns {string[][]}
 */
export function requireFlowCells(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of rows.`);
  }
  let count = 0,
    characters = 0;
  for (const row of value) {
    if (!Array.isArray(row)) {
      throw new Error(`${label} must contain arrays of cells.`);
    }
    count += row.length;
    for (const cell of row) {
      if (typeof cell !== 'string') {
        throw new Error(`${label} cells must be text.`);
      }
      characters += cell.length;
    }
  }
  if (count > 100_000 || characters > MAX_HELPER_TEXT) {
    throw new Error(`${label} exceeds the flow-cell limits.`);
  }
  return value;
}

/**
 * Validate a bounded tree before traversing it in extension helpers.
 * @param {*} value
 * @returns {object[]}
 */
export function requireFolderTree(value) {
  if (!Array.isArray(value)) {
    throw new Error('Folder tree must be an array.');
  }
  const seen = new Set();
  let count = 0;
  /**
   * Validate one bounded tree level and all descendant folder nodes.
   * @param {object[]} nodes
   * @param {number} depth
   * @returns {void}
   */
  const visit = (nodes, depth) => {
    if (depth > 100) {
      throw new Error('Folder tree exceeds 100 levels.');
    }
    for (const node of nodes) {
      if (!node || typeof node !== 'object' || seen.has(node)) {
        throw new Error('Folder tree must not contain invalid or circular nodes.');
      }
      seen.add(node);
      if (++count > 10_000 || typeof node.path !== 'string' || node.path.length > 1000) {
        throw new Error('Folder tree must contain at most 10,000 nodes with valid paths.');
      }
      if (node.type === 'folder') {
        if (!Array.isArray(node.children)) {
          throw new Error('Folder tree folders must have child arrays.');
        }
        visit(node.children, depth + 1);
      }
    }
  };
  visit(value, 0);
  return value;
}

/**
 * Convert and validate a Date or strict local date string.
 * @param {*} value
 * @param {string} label
 * @returns {Date}
 */
export function requireDate(value, label) {
  const date = typeof value === 'string' ? parseDate(value) : value;
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error(`${label} must be a valid date.`);
  }
  return date;
}
