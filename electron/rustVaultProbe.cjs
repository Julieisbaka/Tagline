const { readdirSync } = require('node:fs');
const path = require('node:path');
const { getSystemErrorName } = require('node:util');

let nativeModule;

function loadNativeModule() {
  if (nativeModule) {
    return nativeModule;
  }
  const directory = path.join(__dirname, '..', 'experiments', 'rust-vault', 'dist');
  let files;
  try {
    files = readdirSync(directory);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    files = [];
  }
  const binaries = files.filter((file) => file.endsWith('.node'));
  if (binaries.length === 0) {
    throw new Error(`Rust vault probe is not built. Run "npm run experiment:rust-vault".`);
  }
  if (binaries.length > 1) {
    throw new Error(`Multiple Rust vault probe addons found. Remove stale .node files from ${directory} and rebuild.`);
  }
  nativeModule = require(path.join(directory, binaries[0]));
  return nativeModule;
}

function listNotePaths(root) {
  try {
    return loadNativeModule().listNotePaths(root);
  } catch (error) {
    throw normalizeError(error);
  }
}

function normalizeError(error) {
  const match = /^TAGLINE_VAULT_ERROR:([A-Z]+):(\d+): /.exec(error.message);
  if (match) {
    error.code = match[1];
    if (process.platform !== 'win32' && Number(match[2]) > 0) {
      try {
        const code = getSystemErrorName(-Number(match[2]));
        if (!code.startsWith('Unknown system error')) {
          error.code = code;
        }
      } catch {
        // Keep the native fallback for unrecognized system error numbers.
      }
    }
    error.message = error.message.slice(match[0].length);
  }
  return error;
}

async function loadVault(root, base, includeContents) {
  let entries;
  try {
    entries = await loadNativeModule().loadVault(path.resolve(root), base, includeContents);
  } catch (error) {
    throw normalizeError(error);
  }
  const tree = [];
  const children = [];
  for (const entry of entries) {
    const node = entry.isFolder
      ? { type: 'folder', path: entry.path, name: entry.name, children: [] }
      : { type: 'file', path: entry.path, name: entry.name, mtime: entry.mtime };
    (entry.parent === -1 ? tree : children[entry.parent]).push(node);
    children.push(node.children);
  }
  const contents = {};
  function collect(nodes) {
    nodes.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1
    );
    for (const node of nodes) {
      if (node.type === 'folder') {
        collect(node.children);
      }
    }
  }
  collect(tree);
  if (includeContents) {
    const texts = new Map(entries.filter((entry) => !entry.isFolder).map((entry) => [entry.path, entry.text]));
    function collectContents(nodes) {
      for (const node of nodes) {
        if (node.type === 'folder') {
          collectContents(node.children);
        } else {
          contents[node.path] = texts.get(node.path);
        }
      }
    }
    collectContents(tree);
  }
  return { tree, contents };
}

async function listVault(root, base = '') {
  return (await loadVault(root, base, false)).tree;
}

async function readVaultSnapshot(root) {
  return loadVault(root, '', true);
}

module.exports = { listNotePaths, listVault, readVaultSnapshot };
