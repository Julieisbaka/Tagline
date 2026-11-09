const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { relativeFile } = require('./manifest.cjs');

const MAX_INSTALL_FILES = 5000;
const MAX_INSTALL_BYTES = 50 * 1024 * 1024;
const SKIPPED_NAMES = new Set(['.git', 'node_modules']);

// Accepts the extension folder, its manifest.json, or a wrapper folder holding exactly one extension.
async function findManifestRoot(source) {
  const stat = await fs.stat(source).catch(() => null);
  if (!stat) {
    throw new Error('That path no longer exists.');
  }
  let dir = source;
  if (stat.isFile()) {
    if (path.basename(source).toLowerCase() !== 'manifest.json') {
      throw new Error('Drop a folder that contains a manifest.json file.');
    }
    dir = path.dirname(source);
  }
  const hasManifest = (candidate) =>
    fs.stat(path.join(candidate, 'manifest.json')).then(
      (item) => item.isFile(),
      () => false
    );
  if (await hasManifest(dir)) {
    return dir;
  }
  const nested = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const candidate = path.join(dir, entry.name);
    if (entry.isDirectory() && !SKIPPED_NAMES.has(entry.name) && (await hasManifest(candidate))) {
      nested.push(candidate);
    }
  }
  if (nested.length === 1) {
    return nested[0];
  }
  throw new Error(
    nested.length
      ? 'Several extensions were found. Drop one extension folder at a time.'
      : `No manifest.json found in "${path.basename(dir)}".`
  );
}

async function assertCopyable(root) {
  let files = 0;
  let bytes = 0;
  const pending = [root];
  while (pending.length) {
    for (const entry of await fs.readdir(pending.pop(), { withFileTypes: true })) {
      if (SKIPPED_NAMES.has(entry.name) || entry.isSymbolicLink()) {
        continue;
      }
      const full = path.join(entry.parentPath, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
      } else if (entry.isFile()) {
        files += 1;
        bytes += (await fs.stat(full)).size;
      }
      if (files > MAX_INSTALL_FILES || bytes > MAX_INSTALL_BYTES) {
        throw new Error('Extension folder is too large to install.');
      }
    }
  }
}

async function copyFilter(source) {
  return !SKIPPED_NAMES.has(path.basename(source)) && !(await fs.lstat(source)).isSymbolicLink();
}

// Resolves symlinks so a link inside the extension folder cannot read files elsewhere.
async function containedFile(root, value, ext) {
  const file = await fs.realpath(relativeFile(root, value, ext));
  const rel = path.relative(await fs.realpath(root), file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`File escapes the extension folder: ${value}`);
  }
  return file;
}

async function copyExtension(app, source, target) {
  await assertCopyable(source);
  const staging = path.join(app.getPath('userData'), 'extension-staging', randomUUID());
  await fs.mkdir(path.dirname(staging), { recursive: true });
  try {
    await fs.cp(source, staging, { recursive: true, filter: copyFilter });
    await fs.mkdir(path.dirname(target), { recursive: true });
    const backup = `${staging}.previous`;
    const hadPrevious = await fs.rename(target, backup).then(
      () => true,
      (error) => {
        if (error.code !== 'ENOENT') {
          throw error;
        }
        return false;
      }
    );
    try {
      await fs.rename(staging, target);
    } catch (error) {
      if (hadPrevious) {
        await fs.rename(backup, target);
      }
      throw error;
    }
    if (hadPrevious) {
      await fs.rm(backup, { recursive: true, force: true });
    }
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

module.exports = {
  findManifestRoot,
  containedFile,
  copyExtension,
  MAX_INSTALL_FILES,
  MAX_INSTALL_BYTES,
};
