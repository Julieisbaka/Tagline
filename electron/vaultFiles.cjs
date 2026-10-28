const fs = require('node:fs/promises');
const path = require('node:path');

const NOTE_EXTS = ['.md', '.flow', '.canvas', '.json'];
const FILE_CONCURRENCY = 16;

async function loadVault(dir, base, includeContents) {
  const tree = [];
  const directories = [{ dir, base, nodes: tree }];
  const files = [];
  for (const directory of directories) {
    const entries = await fs.readdir(directory.dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const rel = directory.base ? `${directory.base}/${entry.name}` : entry.name;
      const full = path.join(directory.dir, entry.name);
      if (entry.isDirectory()) {
        const children = [];
        directory.nodes.push({ type: 'folder', path: rel, name: entry.name, children });
        directories.push({ dir: full, base: rel, nodes: children });
      } else if (NOTE_EXTS.includes(path.extname(entry.name).toLowerCase())) {
        const node = { type: 'file', path: rel, name: entry.name };
        directory.nodes.push(node);
        files.push({ full, node });
      }
    }
    directory.nodes.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1);
  }
  const texts = new Map();
  let next = 0;
  const workers = await Promise.allSettled(Array.from({ length: Math.min(FILE_CONCURRENCY, files.length) }, async () => {
    while (next < files.length) {
      const { full, node } = files[next++];
      node.mtime = (await fs.stat(full)).mtimeMs;
      if (includeContents) texts.set(node.path, await fs.readFile(full, 'utf8'));
    }
  }));
  const failed = workers.find((worker) => worker.status === 'rejected');
  if (failed) throw failed.reason;
  const contents = {};
  const collect = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'folder') collect(node.children);
      else contents[node.path] = texts.get(node.path);
    }
  };
  if (includeContents) collect(tree);
  return { tree, contents };
}

async function listVault(dir, base = '') { return (await loadVault(dir, base, false)).tree; }
async function readVaultSnapshot(dir) { return loadVault(dir, '', true); }

module.exports = { NOTE_EXTS, listVault, readVaultSnapshot };
