const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const DEFAULT_RETENTION = 50;
const MAX_RETENTION = 5000;
const SNAPSHOT_ID = /^\d{13}-[0-9a-f-]{36}\.snapshot$/;

function validateRetention(value) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_RETENTION) {
    throw new Error(`Revision history retention must be between 1 and ${MAX_RETENTION}.`);
  }
  return value;
}

function createRevisionHistory({ getVaultRoot, resolveInVault }) {
  const historyDir = (relativePath) => {
    const full = resolveInVault(relativePath);
    const rel = path.relative(getVaultRoot(), full);
    if (!/\.(md|flow)$/i.test(rel)) throw new Error('Revision history supports Markdown and flow documents only.');
    return path.join(resolveInVault('.tagline/history'), rel);
  };

  const listFiles = async (directory) => {
    try {
      return (await fs.readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && SNAPSHOT_ID.test(entry.name))
        .map((entry) => entry.name)
        .sort((a, b) => b.localeCompare(a));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  };

  async function snapshot(relativePath, nextContent, retention = DEFAULT_RETENTION) {
    validateRetention(retention);
    if (typeof nextContent !== 'string') throw new Error('Document content must be text.');
    const currentPath = resolveInVault(relativePath);
    if (!/\.(md|flow)$/i.test(currentPath)) return;
    let previous;
    try {
      previous = await fs.readFile(currentPath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    if (previous === nextContent) return;
    const directory = historyDir(relativePath);
    await fs.mkdir(directory, { recursive: true });
    const existing = await listFiles(directory);
    const lastTimestamp = existing.length ? Number(existing[0].slice(0, existing[0].indexOf('-'))) : 0;
    const id = `${Math.max(Date.now(), lastTimestamp + 1)}-${randomUUID()}.snapshot`;
    await fs.writeFile(path.join(directory, id), previous, { encoding: 'utf8', flag: 'wx' });
    const snapshots = await listFiles(directory);
    await Promise.all(snapshots.slice(retention).map((file) => fs.unlink(path.join(directory, file))));
  }

  async function list(relativePath) {
    const documentPath = resolveInVault(relativePath);
    if (!/\.(md|flow)$/i.test(documentPath)) throw new Error('Revision history supports Markdown and flow documents only.');
    const directory = historyDir(relativePath);
    return (await listFiles(directory)).map((id) => ({
      id,
      createdAt: Number(id.slice(0, id.indexOf('-'))),
    }));
  }

  async function read(relativePath, id) {
    if (typeof id !== 'string' || !SNAPSHOT_ID.test(id)) throw new Error('Invalid revision history entry.');
    const documentPath = resolveInVault(relativePath);
    if (!/\.(md|flow)$/i.test(documentPath)) throw new Error('Revision history supports Markdown and flow documents only.');
    return fs.readFile(path.join(historyDir(relativePath), id), 'utf8');
  }

  async function rename(from, to) {
    const source = historyDir(from);
    const destination = historyDir(to);
    try {
      await fs.access(source);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    await fs.mkdir(destination, { recursive: true });
    const moved = [];
    try {
      for (const id of await listFiles(source)) {
        await fs.rename(path.join(source, id), path.join(destination, id));
        moved.push(id);
      }
    } catch (error) {
      for (const id of moved.reverse()) {
        await fs.rename(path.join(destination, id), path.join(source, id));
      }
      throw error;
    }
    await fs.rm(source, { recursive: true });
  }

  return { snapshot, list, read, rename };
}

module.exports = { DEFAULT_RETENTION, MAX_RETENTION, createRevisionHistory, validateRetention };
