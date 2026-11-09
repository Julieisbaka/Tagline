const fs = require('node:fs/promises');
const path = require('node:path');
const { NOTE_EXTS } = require('../vaultFiles.cjs');

const MAX_NOTE_CHARACTERS = 2_000_000;

class ToolError extends Error {}

function flatten(nodes, out = []) {
  for (const node of nodes) {
    if (node.type === 'folder') {
      flatten(node.children, out);
    } else {
      out.push(node);
    }
  }
  return out;
}

function outline(text) {
  const headings = [];
  let fence = false;
  text.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
    }
    const match = !fence && /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (match) {
      headings.push({ level: match[1].length, text: match[2], line: index + 1 });
    }
  });
  return headings;
}

function createVaultContext({ getVaultRoot, getAllowWrites, getAllowModels, getLocalModels }) {
  const root = () => {
    const value = getVaultRoot();
    if (!value) {
      throw new ToolError('No vault is open in Tagline. Open a vault first.');
    }
    return value;
  };

  // Vault-relative, forward-slash path that stays inside the vault and out of hidden folders.
  function resolve(rel, { note = false, allowRoot = false } = {}) {
    if (typeof rel !== 'string' || (!rel.trim() && !allowRoot)) {
      throw new ToolError('A vault-relative path is required.');
    }
    const clean = rel
      .replaceAll('\\', '/')
      .replace(/^\.?\/+/, '')
      .replace(/\/+$/, '');
    const segments = clean.split('/').filter(Boolean);
    if (
      path.win32.isAbsolute(rel) ||
      path.posix.isAbsolute(rel) ||
      segments.some((segment) => segment === '..' || segment.startsWith('.'))
    ) {
      throw new ToolError(`Path must stay inside the vault and avoid hidden folders: ${rel}`);
    }
    let name = segments.join('/');
    if (note && name && !NOTE_EXTS.includes(path.posix.extname(name).toLowerCase())) {
      name += '.md';
    }
    const base = root();
    const full = path.resolve(base, name);
    const relative = path.relative(base, full);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new ToolError(`Path escapes the vault: ${rel}`);
    }
    return { rel: name, full };
  }

  const requireWrites = () => {
    if (!getAllowWrites()) {
      throw new ToolError(
        'Tagline is in read-only mode for agents. Enable "Allow agents to change notes" in Settings > Integrations.'
      );
    }
  };
  const requireModels = () => {
    if (!getAllowModels()) {
      throw new ToolError('Enable "Allow agents to use local models" in Settings > Integrations.');
    }
    const models = getLocalModels();
    if (!models) {
      throw new ToolError('Local models are not available yet.');
    }
    return models;
  };
  const exists = (full) =>
    fs.stat(full).then(
      () => true,
      (error) => {
        if (error.code === 'ENOENT') {
          return false;
        }
        throw error;
      }
    );
  const checkContent = (content) => {
    if (typeof content !== 'string') {
      throw new ToolError('content must be a string.');
    }
    if (content.length > MAX_NOTE_CHARACTERS) {
      throw new ToolError(`content exceeds ${MAX_NOTE_CHARACTERS} characters.`);
    }
  };
  const readNote = async (rel) => {
    const target = resolve(rel, { note: true });
    try {
      return { ...target, text: await fs.readFile(target.full, 'utf8') };
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') {
        throw new ToolError(`Note not found: ${target.rel}`);
      }
      throw error;
    }
  };

  return { root, resolve, requireWrites, requireModels, exists, checkContent, readNote };
}

module.exports = { ToolError, flatten, outline, createVaultContext };
