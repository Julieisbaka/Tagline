// Pure helpers for indexing a vault: names, links, tags, backlinks.
import { splitFrontmatter } from './frontmatter.js';
import { Lexer } from 'marked';

/** Test a case-insensitive flow-document extension. @param {string} p @returns {boolean} */
export const isFlow = (p) => p.toLowerCase().endsWith('.flow');
/** Test a case-insensitive Markdown-document extension. @param {string} p @returns {boolean} */
export const isMarkdown = (p) => p.toLowerCase().endsWith('.md');
/** Test a case-insensitive JSON Canvas extension. @param {string} p @returns {boolean} */
export const isCanvas = (p) => p.toLowerCase().endsWith('.canvas');
/** Test a case-insensitive JSON-document extension. @param {string} p @returns {boolean} */
export const isJson = (p) => p.toLowerCase().endsWith('.json');

/** Return the filename without a supported document extension. @param {string} p @returns {string} */
export function baseName(p) {
  const file = p.split('/').pop();
  return file.replace(/\.(md|flow|canvas)$/i, '');
}

/** Format a filename using the workspace's extension-visibility preferences. @returns {string} */
export function displayName(p, hideFlowExtension = true, showMarkdownExtension = false) {
  const file = p.split('/').pop();
  if (isMarkdown(p)) return showMarkdownExtension ? file : baseName(p);
  if (isCanvas(p)) return baseName(p);
  return hideFlowExtension ? baseName(p) : file;
}

/** Return a vault-relative parent directory, or empty string at the vault root. @returns {string} */
export function dirName(p) {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

/** Join a vault directory and filename; this does not validate containment. @returns {string} */
export function joinPath(dir, name) {
  return dir ? `${dir}/${name}` : name;
}

const WIKILINK_RE = /(!?)\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?\]\]/g;
const TAG_RE = /(^|[\s(])#([A-Za-z][\w/-]*)/g;

/** Remove YAML metadata and inline/fenced code before link or tag extraction. @param {string} content @returns {string} */
function stripCode(content) {
  return splitFrontmatter(content).body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

/** Extract wiki-link targets outside code, without headings or aliases. @returns {string[]} */
export function extractLinks(content) {
  const out = [];
  for (const m of stripCode(content).matchAll(WIKILINK_RE)) out.push(m[2].trim());
  return out;
}

/** Extract unique tag names outside code and Markdown heading markers. @returns {string[]} */
export function extractTags(content) {
  const out = new Set();
  const text = stripCode(content).replace(/^#{1,6}\s/gm, '');
  for (const m of text.matchAll(TAG_RE)) out.add(m[2].toLowerCase());
  return [...out];
}

/**
 * Map a note name or path to a candidate vault path; exact paths take precedence.
 * @param {string} target Note name or vault-relative path.
 * @param {string[]} paths Candidate document paths.
 * @returns {string|null} Matched path, or null when unresolved.
 */
export function resolveLink(target, paths) {
  const exact = paths.find((path) => path.toLowerCase() === target.trim().toLowerCase());
  if (exact) return exact;
  const t = target.trim().toLowerCase().replace(/\.md$/, '');
  if (!t) return null;
  let best = null;
  for (const p of paths) {
    const lower = p.toLowerCase().replace(/\.(md|flow)$/, '');
    if (lower === t) return p;
    if (!best && (lower.endsWith('/' + t) || baseName(p).toLowerCase() === t)) best = p;
  }
  return best;
}

/** Build a precedence-preserving, map-backed resolver for a fixed path list. @param {string[]} paths @returns {function} */
function createLinkResolver(paths) {
  const exactPaths = new Map();
  const normalizedPaths = new Map();
  const fallbackPaths = new Map();
  /** Keep the first path registered for a case-normalized lookup key. @param {Map} map @param {string} key @param {string} path @returns {void} */
  const addFirst = (map, key, path) => {
    if (!map.has(key)) map.set(key, path);
  };
  for (const path of paths) {
    const lower = path.toLowerCase();
    addFirst(exactPaths, lower, path);
    const normalized = lower.replace(/\.(md|flow)$/, '');
    addFirst(normalizedPaths, normalized, path);
    for (let slash = normalized.indexOf('/'); slash !== -1; slash = normalized.indexOf('/', slash + 1)) {
      addFirst(fallbackPaths, normalized.slice(slash + 1), path);
    }
    addFirst(fallbackPaths, baseName(path).toLowerCase(), path);
  }
  return (target) => {
    const normalizedTarget = target.trim().toLowerCase();
    const exact = exactPaths.get(normalizedTarget);
    if (exact) return exact;
    const name = normalizedTarget.replace(/\.md$/, '');
    return name ? normalizedPaths.get(name) || fallbackPaths.get(name) || null : null;
  };
}

/** Build paths, links, backlinks, tags and unresolved-link maps from Markdown contents. @returns {object} */
export function buildIndex(contents) {
  const paths = Object.keys(contents);
  const resolve = createLinkResolver(paths);
  const links = {};
  const backlinks = {};
  const tags = {};
  const unresolved = {};
  for (const p of paths) {
    if (!isMarkdown(p)) continue;
    const content = contents[p] || '';
    links[p] = [];
    for (const target of extractLinks(content)) {
      const resolved = resolve(target);
      if (resolved) {
        if (!links[p].includes(resolved)) links[p].push(resolved);
        (backlinks[resolved] ||= new Set()).add(p);
      } else {
        (unresolved[target] ||= new Set()).add(p);
      }
    }
    for (const tag of extractTags(content)) (tags[tag] ||= []).push(p);
  }
  /** Convert object values from sets to plain arrays for indexed results. @param {object} o @returns {object} */
  const toArrays = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [...v]]));
  return { paths, links, backlinks: toArrays(backlinks), tags, unresolved: toArrays(unresolved) };
}

/** Rewrite wiki links resolving to oldPath after a rename, preserving headings and aliases. @returns {string} */
export function rewriteLinks(content, oldPath, newPath, allPaths) {
  const newName = newPath.replace(/\.(md|flow)$/i, '');
  return content.replace(WIKILINK_RE, (full, bang, target, heading = '', alias = '') => {
    const resolved = resolveLink(target, allPaths);
    if (resolved !== oldPath) return full;
    return `${bang}[[${newName}${heading}${alias}]]`;
  });
}

/** Extract {level,text,line} headings outside fenced code; line is zero-based. @returns {object[]} */
export function outline(content) {
  const metadata = splitFrontmatter(content);
  content = (metadata.prefix.replace(/[^\n]/g, '') + metadata.body).replace(/\r\n?/g, '\n');
  const out = [];
  let line = 0;
  for (const token of Lexer.lex(content)) {
    if (token.type === 'heading') out.push({ level: token.depth, text: token.text.trim(), line });
    line += (token.raw.match(/\n/g) || []).length;
  }
  return out;
}

/** Flatten a vault tree into its document paths. @returns {string[]} */
export function flattenTree(tree, acc = []) {
  for (const n of tree) {
    if (n.type === 'folder') flattenTree(n.children, acc);
    else acc.push(n.path);
  }
  return acc;
}

/** Return Tagline's case-insensitive substring/subsequence match score. @returns {number} */
export function fuzzyScore(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 1;
  const idx = t.indexOf(q);
  if (idx !== -1) return 1000 - idx - t.length * 0.1;
  let ti = 0;
  let score = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return -1;
    score += found === ti ? 5 : 1;
    ti = found + 1;
  }
  return score;
}
