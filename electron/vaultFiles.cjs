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
const descriptorDirectory =
  process.platform === 'linux' ? '/proc/self/fd' : process.platform === 'darwin' ? '/dev/fd' : null;

function descriptorPath(handle, fallback) {
  return descriptorDirectory ? path.join(descriptorDirectory, String(handle.fd)) : fallback;
}

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
  const directoryFlags =
    fssync.constants.O_RDONLY |
    (fssync.constants.O_DIRECTORY || 0) |
    (fssync.constants.O_NOFOLLOW || 0);
  let rootHandle;
  let rootHandlePath;
  try {
    rootHandle = await fs.open(realRoot, directoryFlags);
    rootHandlePath = descriptorPath(rootHandle, realRoot);
    const openedRoot = await fs.realpath(rootHandlePath);
    if (openedRoot !== realRoot) {
      throw new Error('Vault directory changed during traversal');
    }
  } catch (error) {
    await rootHandle?.close().catch(() => {});
    throw error;
  }
  const directories = [{ dir: rootHandlePath, base, nodes: tree }];
  const openedDirectories = [rootHandle];
  const files = [];
  const seen = includeContents ? new Set() : null;
  const ignorer = loadIgnoreRules(dir);
  try {
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
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          let handle;
          try {
            handle = await fs.open(full, directoryFlags);
            const stat = await handle.stat();
            const realDirectory = await fs.realpath(descriptorPath(handle, full));
            if (!stat.isDirectory() || !isContained(realDirectory)) {
              await handle.close();
              continue;
            }
          } catch {
            await handle?.close().catch(() => {});
            continue;
          }
          openedDirectories.push(handle);
          const children = [];
          directory.nodes.push({ type: 'folder', path: rel, name: entry.name, children });
          directories.push({ dir: descriptorPath(handle, full), base: rel, nodes: children });
        } else if (NOTE_EXTS.includes(path.extname(entry.name).toLowerCase())) {
          files.push({ full, rel, name: entry.name, nodes: directory.nodes });
        }
      }
    }
    const texts = new Map();
    let next = 0;
    const workers = await Promise.allSettled(
      Array.from({ length: Math.min(FILE_CONCURRENCY, files.length) }, async () => {
        while (next < files.length) {
          const { full, rel, name, nodes } = files[next++];
          let fh;
          try {
            fh = await fs.open(full, fssync.constants.O_RDONLY | (fssync.constants.O_NOFOLLOW || 0));
          } catch {
            continue;
          }
          try {
            const stat = await fh.stat();
            const realFile = await fs.realpath(descriptorPath(fh, full));
            if (!stat.isFile() || !isContained(realFile)) {
              continue;
            }
            const node = { type: 'file', path: rel, name, mtime: stat.mtimeMs };
            nodes.push(node);
            if (includeContents) {
              seen.add(rel);
              const cached = cachedContents.get(rel);
              const text =
                cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size
                  ? cached.text
                  : await fh.readFile('utf8');
              cachedContents.set(rel, { mtimeMs: stat.mtimeMs, size: stat.size, text });
              texts.set(rel, text);
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
    const sortNodes = (nodes) => {
      nodes.sort((a, b) =>
        a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1
      );
      for (const node of nodes) {
        if (node.type === 'folder') {
          sortNodes(node.children);
        }
      }
    };
    sortNodes(tree);
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
  } finally {
    await Promise.all(openedDirectories.map((handle) => handle.close().catch(() => {})));
  }
}

async function listVault(dir, base = '') {
  return (await loadVault(dir, base, false)).tree;
}
async function readVaultSnapshot(dir) {
  return loadVault(dir, '', true);
}

module.exports = { NOTE_EXTS, listVault, readVaultSnapshot };
