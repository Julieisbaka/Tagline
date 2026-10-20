// Pure helpers for indexing a vault: names, links, tags, backlinks.

export const isFlow = (p) => p.toLowerCase().endsWith('.flow');
export const isMarkdown = (p) => p.toLowerCase().endsWith('.md');

export function baseName(p) {
  const file = p.split('/').pop();
  return file.replace(/\.(md|flow)$/i, '');
}

export function dirName(p) {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

export function joinPath(dir, name) {
  return dir ? `${dir}/${name}` : name;
}

const WIKILINK_RE = /(!?)\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?\]\]/g;
const TAG_RE = /(^|[\s(])#([A-Za-z][\w/-]*)/g;

function stripCode(content) {
  return content.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

export function extractLinks(content) {
  const out = [];
  for (const m of stripCode(content).matchAll(WIKILINK_RE)) out.push(m[2].trim());
  return out;
}

export function extractTags(content) {
  const out = new Set();
  const text = stripCode(content).replace(/^#{1,6}\s/gm, '');
  for (const m of text.matchAll(TAG_RE)) out.add(m[2].toLowerCase());
  return [...out];
}

// Map a link target ("Note", "Folder/Note", "Note.md") to a vault path.
export function resolveLink(target, paths) {
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

export function buildIndex(contents) {
  const paths = Object.keys(contents);
  const links = {};
  const backlinks = {};
  const tags = {};
  const unresolved = {};
  for (const p of paths) {
    if (!isMarkdown(p)) continue;
    const content = contents[p] || '';
    links[p] = [];
    for (const target of extractLinks(content)) {
      const resolved = resolveLink(target, paths);
      if (resolved) {
        if (!links[p].includes(resolved)) links[p].push(resolved);
        (backlinks[resolved] ||= new Set()).add(p);
      } else {
        (unresolved[target] ||= new Set()).add(p);
      }
    }
    for (const tag of extractTags(content)) (tags[tag] ||= []).push(p);
  }
  const toArrays = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [...v]]));
  return { paths, links, backlinks: toArrays(backlinks), tags, unresolved: toArrays(unresolved) };
}

// Rewrite [[links]] pointing at oldPath so they point at newPath after a rename.
export function rewriteLinks(content, oldPath, newPath, allPaths) {
  const newName = newPath.replace(/\.(md|flow)$/i, '');
  return content.replace(WIKILINK_RE, (full, bang, target, heading = '', alias = '') => {
    const resolved = resolveLink(target, allPaths);
    if (resolved !== oldPath) return full;
    return `${bang}[[${newName}${heading}${alias}]]`;
  });
}

export function outline(content) {
  const out = [];
  let inCode = false;
  content.split('\n').forEach((line, i) => {
    if (line.startsWith('```')) inCode = !inCode;
    const m = !inCode && line.match(/^(#{1,6})\s+(.*)$/);
    if (m) out.push({ level: m[1].length, text: m[2].trim(), line: i });
  });
  return out;
}

export function flattenTree(tree, acc = []) {
  for (const n of tree) {
    if (n.type === 'folder') flattenTree(n.children, acc);
    else acc.push(n.path);
  }
  return acc;
}

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
