const fs = require('node:fs/promises');
const fssync = require('node:fs');
const path = require('node:path');
const ignore = require('ignore');

const NOTE_EXTS = ['.md', '.flow', '.canvas', '.json'];
const contentsCache = new Map();

function loadIgnoreRules(dir) {
  try {
    return ignore().add(fssync.readFileSync(path.join(dir, '.taglineignore'), 'utf8'));
  } catch {
    return null;
  }
}
const FILE_CONCURRENCY = 16;

async function loadVault(dir, base, includeContents) {
  const tree = [];
  const root = path.resolve(dir);
  const realRoot = await fs.realpath(root);
  const isContained = (full) => {
    const relative = path.relative(realRoot, full);
    return (
      relative === '' ||
      (relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative))
    );
  };
  let cachedContents;
  if (includeContents) {
    cachedContents = contentsCache.get(root);
    if (!cachedContents) {
      cachedContents = new Map();
      contentsCache.set(root, cachedContents);
    }
  }
  const directories = [{ dir, base, nodes: tree }];
  const files = [];
  const seen = includeContents ? new Set() : null;
  const ignorer = loadIgnoreRules(dir);
  for (const directory of directories) {
    const entries = await fs.readdir(directory.dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue;
      }
      const rel = directory.base ? `${directory.base}/${entry.name}` : entry.name;
      if (ignorer && ignorer.ignores(rel)) {
        continue;
      }
      const full = path.join(directory.dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.isSymbolicLink()) {
          continue;
        }
        let realDirectory;
        try {
          realDirectory = await fs.realpath(full);
        } catch {
          continue;
        }
        if (!isContained(realDirectory)) {
          continue;
        }
        const children = [];
        directory.nodes.push({ type: 'folder', path: rel, name: entry.name, children });
        directories.push({ dir: full, base: rel, nodes: children });
      } else if (NOTE_EXTS.includes(path.extname(entry.name).toLowerCase())) {
        if (entry.isSymbolicLink()) {
          continue;
        }
        let lstat;
        let realFile;
        try {
          lstat = await fs.lstat(full);
          realFile = await fs.realpath(full);
        } catch {
          continue;
        }
        if (!lstat.isFile() || !isContained(realFile)) {
          continue;
        }
        const node = { type: 'file', path: rel, name: entry.name };
        directory.nodes.push(node);
        files.push({ full, node });
      }
    }
    directory.nodes.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1
    );
  }
  const texts = new Map();
  let next = 0;
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(FILE_CONCURRENCY, files.length) }, async () => {
      while (next < files.length) {
        const { full, node } = files[next++];
        const flags = fssync.constants.O_RDONLY | (fssync.constants.O_NOFOLLOW || 0);
        const fh = await fs.open(full, flags);
        try {
          const stat = await fh.stat();
          if (!stat.isFile()) {
            continue;
          }
          const realFile = await fs.realpath(full);
          if (!isContained(realFile)) {
            continue;
          }
          node.mtime = stat.mtimeMs;
          if (includeContents) {
            seen.add(node.path);
            const cached = cachedContents.get(node.path);
            const text =
              cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size
                ? cached.text
                : await fh.readFile('utf8');
            cachedContents.set(node.path, { mtimeMs: stat.mtimeMs, size: stat.size, text });
            texts.set(node.path, text);
          }
        } finally {
          await fh.close();
        }
      }
    })
  );
  const failed = workers.find((worker) => worker.status === 'rejected');
  if (failed) {
    throw failed.reason;
  }
  const contents = {};
  const collect = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'folder') {
        collect(node.children);
      } else {
        const text = texts.get(node.path);
        if (text !== undefined) {
          contents[node.path] = text;
        }
      }
    }
  };
  if (includeContents) {
    collect(tree);
    for (const rel of cachedContents.keys()) {
      if (!seen.has(rel)) {
        cachedContents.delete(rel);
      }
    }
  }
  return { tree, contents };
}

async function listVault(dir, base = '') {
  return (await loadVault(dir, base, false)).tree;
}
async function readVaultSnapshot(dir) {
  return loadVault(dir, '', true);
}

module.exports = { NOTE_EXTS, listVault, readVaultSnapshot };
