const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { parseCanvas, serializeCanvas } = require('./canvas.mjs');
const { parseFlow } = require('./flow.mjs');

const DEFAULT_RETENTION = 50;
const MAX_RETENTION = 5000;
const SNAPSHOT_ID = /^\d{13}-[0-9a-f-]{36}\.(snapshot|delta)$/;
const MAX_DELTA_DEPTH = 9;
const hash = (content) => createHash('sha256').update(content, 'utf8').digest('hex');
const DOCUMENT = /\.(md|flow|canvas)$/i;
const HISTORY_TYPES = 'Revision history supports Markdown, flow, and Canvas documents only.';

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

  async function readStored(directory, id, seen = new Set()) {
    if (!SNAPSHOT_ID.test(id) || seen.has(id) || seen.size > MAX_DELTA_DEPTH) {
      throw new Error('Invalid revision history dependency chain.');
    }
    seen.add(id);
    const stored = await fs.readFile(path.join(directory, id), 'utf8');
    if (id.endsWith('.snapshot')) return { content: stored, depth: 0 };
    const delta = JSON.parse(stored);
    if (delta?.version !== 1 || typeof delta.hash !== 'string') {
      throw new Error('Invalid revision history delta.');
    }
    let content;
    let depth = 0;
    if (delta.base === null && typeof delta.content === 'string') {
      content = delta.content;
    } else {
      if (typeof delta.base !== 'string' || !SNAPSHOT_ID.test(delta.base) ||
          !Number.isSafeInteger(delta.start) || delta.start < 0 ||
          !Number.isSafeInteger(delta.deleteCount) || delta.deleteCount < 0 ||
          typeof delta.insert !== 'string') throw new Error('Invalid revision history delta.');
      const base = await readStored(directory, delta.base, seen);
      if (hash(base.content) !== delta.baseHash ||
          delta.start + delta.deleteCount > base.content.length) {
        throw new Error('Revision history delta base is damaged.');
      }
      content = base.content.slice(0, delta.start) + delta.insert +
        base.content.slice(delta.start + delta.deleteCount);
      depth = base.depth + 1;
    }
    if (hash(content) !== delta.hash) throw new Error('Revision history checksum does not match.');
    return { content, depth };
  }

  async function snapshot(relativePath, nextContent, retention = DEFAULT_RETENTION, canvasMode = 'complete', experimentalHistoryDeltas = false) {
    validateRetention(retention);
    if (typeof experimentalHistoryDeltas !== 'boolean') throw new Error('Experimental history deltas must be enabled or disabled.');
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
    let stored = snapshotContent;
    let extension = 'snapshot';
    if (experimentalHistoryDeltas && existing.length && retention > 1) {
      const base = await readStored(directory, existing[0]);
      if (base.depth < MAX_DELTA_DEPTH) {
        let start = 0;
        while (start < base.content.length && start < snapshotContent.length &&
            base.content[start] === snapshotContent[start]) start++;
        let end = 0;
        while (end < base.content.length - start && end < snapshotContent.length - start &&
            base.content[base.content.length - end - 1] === snapshotContent[snapshotContent.length - end - 1]) end++;
        const delta = JSON.stringify({
          version: 1, base: existing[0], baseHash: hash(base.content), hash: hash(snapshotContent),
          start, deleteCount: base.content.length - start - end,
          insert: snapshotContent.slice(start, snapshotContent.length - end),
        });
        if (Buffer.byteLength(delta) < Buffer.byteLength(snapshotContent)) {
          stored = delta;
          extension = 'delta';
        }
      }
    }
    const id = `${Math.max(Date.now(), lastTimestamp + 1)}-${randomUUID()}.${extension}`;
    await fs.writeFile(path.join(directory, id), stored, { encoding: 'utf8', flag: 'wx' });
    const snapshots = await listFiles(directory);
    const oldestKept = snapshots[retention - 1];
    if (snapshots.length > retention && oldestKept.endsWith('.delta')) {
      // Rebase the retention boundary before deleting anything it could depend on.
      const { content } = await readStored(directory, oldestKept);
      const temporary = path.join(directory, `${randomUUID()}.tmp`);
      try {
        await fs.writeFile(temporary, JSON.stringify({ version: 1, base: null, content, hash: hash(content) }),
          { encoding: 'utf8', flag: 'wx' });
        await fs.rename(temporary, path.join(directory, oldestKept));
      } finally {
        await fs.rm(temporary, { force: true });
      }
    }
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
    const { content } = await readStored(directory, id);
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
    if (!DOCUMENT.test(documentPath)) throw new Error(HISTORY_TYPES);
    const validate = /\.canvas$/i.test(documentPath) ? parseCanvas : /\.flow$/i.test(documentPath) ? parseFlow : null;
    const working = (content) => {
      if (!validate) return true;
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
