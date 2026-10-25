const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { parseCanvas, serializeCanvas } = require('./canvas.mjs');
const { parseFlow } = require('./flow.mjs');

const DEFAULT_RETENTION = 50;
const MAX_RETENTION = 5000;
const SNAPSHOT_ID = /^\d{13}-[0-9a-f-]{36}\.snapshot$/;
const DOCUMENT = /\.(md|flow|canvas)$/i;
const HISTORY_TYPES = 'Revision history supports Markdown, flow and Canvas documents only.';

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
    if (!DOCUMENT.test(rel)) throw new Error(HISTORY_TYPES);
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

  async function snapshot(relativePath, nextContent, retention = DEFAULT_RETENTION, canvasMode = 'complete') {
    validateRetention(retention);
    if (!['complete', 'data'].includes(canvasMode)) throw new Error('Canvas history mode must be complete or data.');
    if (typeof nextContent !== 'string') throw new Error('Document content must be text.');
    const currentPath = resolveInVault(relativePath);
    if (!DOCUMENT.test(currentPath)) return;
    let previous;
    try {
      previous = await fs.readFile(currentPath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    if (previous === nextContent) return;
    const directory = historyDir(relativePath);
    let snapshotContent = previous;
    if (/\.canvas$/i.test(currentPath)) {
      const layoutPath = path.join(directory, 'layout.json');
      let layout = null;
      try { layout = JSON.parse(await fs.readFile(layoutPath, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      let before;
      let after;
      try { before = parseCanvas(previous); } catch { /* Preserve invalid source as a complete revision. */ }
      try { after = parseCanvas(nextContent); } catch { /* Preserve invalid source as a complete revision. */ }
      if (after && (canvasMode === 'data' || layout)) {
        const positions = Object.fromEntries([...(before?.nodes || []), ...after.nodes].map((node) =>
          [node.id, { x: node.x, y: node.y, width: node.width, height: node.height }]));
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(`${layoutPath}.tmp`, JSON.stringify({ ...layout, ...positions }), 'utf8');
        await fs.rename(`${layoutPath}.tmp`, layoutPath);
      }
      if (canvasMode === 'data' && before && after) {
        const dataOnly = (canvas) => ({ ...canvas, nodes: canvas.nodes.map(({ x, y, width, height, ...node }) => node) });
        const data = dataOnly(before);
        if (isDeepStrictEqual(data, dataOnly(after))) return;
        snapshotContent = JSON.stringify({ taglineCanvasRevision: 1, mode: 'data', data });
      }
    }
    await fs.mkdir(directory, { recursive: true });
    const existing = await listFiles(directory);
    const lastTimestamp = existing.length ? Number(existing[0].slice(0, existing[0].indexOf('-'))) : 0;
    const id = `${Math.max(Date.now(), lastTimestamp + 1)}-${randomUUID()}.snapshot`;
    await fs.writeFile(path.join(directory, id), snapshotContent, { encoding: 'utf8', flag: 'wx' });
    const snapshots = await listFiles(directory);
    await Promise.all(snapshots.slice(retention).map((file) => fs.unlink(path.join(directory, file))));
  }

  async function list(relativePath) {
    const documentPath = resolveInVault(relativePath);
    if (!DOCUMENT.test(documentPath)) throw new Error(HISTORY_TYPES);
    const directory = historyDir(relativePath);
    return (await listFiles(directory)).map((id) => ({
      id,
      createdAt: Number(id.slice(0, id.indexOf('-'))),
    }));
  }

  async function read(relativePath, id) {
    if (typeof id !== 'string' || !SNAPSHOT_ID.test(id)) throw new Error('Invalid revision history entry.');
    const documentPath = resolveInVault(relativePath);
    if (!DOCUMENT.test(documentPath)) throw new Error(HISTORY_TYPES);
    const directory = historyDir(relativePath);
    const content = await fs.readFile(path.join(directory, id), 'utf8');
    if (/\.canvas$/i.test(documentPath)) {
      let saved;
      try { saved = JSON.parse(content); } catch { return content; }
      if (saved?.taglineCanvasRevision === 1 && saved.mode === 'data') {
        const layout = JSON.parse(await fs.readFile(path.join(directory, 'layout.json'), 'utf8'));
        return serializeCanvas({ ...saved.data, nodes: saved.data.nodes.map((node) => ({ ...node, ...layout[node.id] })) });
      }
    }
    return content;
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
      const files = await listFiles(source);
      try { await fs.access(path.join(source, 'layout.json')); files.push('layout.json'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      for (const id of files) {
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

  async function latestWorking(relativePath) {
    const documentPath = resolveInVault(relativePath);
    const validate = /\.canvas$/i.test(documentPath) ? parseCanvas : /\.flow$/i.test(documentPath) ? parseFlow : null;
    if (!validate) throw new Error('Working-save recovery supports flow and Canvas documents only.');
    const working = (content) => {
      try { validate(content); return true; }
      catch { return false; } // Invalid revisions are deliberately skipped, newest first.
    };
    try {
      const content = await fs.readFile(documentPath, 'utf8');
      if (working(content)) return { content };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const revision of await list(relativePath)) {
      const content = await read(relativePath, revision.id);
      if (working(content)) return { ...revision, content };
    }
    return null;
  }

  return { snapshot, list, read, rename, latestWorking };
}

module.exports = { DEFAULT_RETENTION, MAX_RETENTION, createRevisionHistory, validateRetention };
