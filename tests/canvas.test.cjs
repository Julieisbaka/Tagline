const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

test('Canvas groups move enclosed and nested nodes without moving unrelated nodes', async () => {
  const { canvasGroupMembers, moveCanvasNodes, createCanvasNode } = await import('../src/lib/canvas.js');
  const group = { ...createCanvasNode('group', 0, 'group'), x: 0, y: 0, width: 1000, height: 800 };
  const nested = { ...createCanvasNode('group', 1, 'nested'), x: 100, y: 100 };
  const inside = { ...createCanvasNode('text', 2, 'inside'), x: 150, y: 150 };
  const outside = { ...createCanvasNode('text', 3, 'outside'), x: 950, y: 0 };
  const canvas = { nodes: [group, nested, inside, outside], edges: [] };
  assert.deepEqual(canvasGroupMembers(canvas.nodes, group.id), ['nested', 'inside']);
  const moved = moveCanvasNodes(canvas, ['group', ...canvasGroupMembers(canvas.nodes, 'group')], -50, 25);
  assert.deepEqual(moved.nodes.map(({ x, y }) => [x, y]), [[-50, 25], [50, 125], [100, 175], [950, 0]]);
  assert.equal(canvas.nodes[0].x, 0, 'movement does not mutate original data');
});

test('Canvas suggestions match filenames textually, with prefix matches first and bounded results', async () => {
  const { suggestCanvasFiles } = await import('../src/lib/canvas.js');
  const paths = ['Case/Climate.md', 'Climate/Unrelated.md', 'Other/AT Climate.md', 'Case/Climate.canvas', 'Round.flow'];
  assert.deepEqual(suggestCanvasFiles(paths, 'cLiMaTe'), ['Case/Climate.canvas', 'Case/Climate.md', 'Other/AT Climate.md']);
  assert.deepEqual(suggestCanvasFiles(paths, 'Round'), ['Round.flow']);
  assert.equal(suggestCanvasFiles(paths, '', 2).length, 2);
  assert.deepEqual(suggestCanvasFiles(paths, 'unknown'), []);
});

test('Canvas Complete history preserves JSON; Data history shares latest layout and skips movement', async (t) => {
  const { createRevisionHistory } = require('../electron/revisionHistory.cjs');
  const { createCanvasNode, serializeCanvas } = await import('../src/lib/canvas.js');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-canvas-history-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const history = createRevisionHistory({ getVaultRoot: () => root, resolveInVault: (rel) => path.join(root, rel) });
  let canvas = { nodes: [createCanvasNode('text', 0, 'one')], edges: [], extra: { keep: true } };
  let current = serializeCanvas(canvas);
  await fs.writeFile(path.join(root, 'Map.canvas'), current);
  const save = async (next, mode = 'data') => {
    const content = typeof next === 'string' ? next : serializeCanvas(next);
    await history.snapshot('Map.canvas', content, 50, mode);
    await fs.writeFile(path.join(root, 'Map.canvas'), content);
    current = content;
  };
  canvas.nodes[0].x = 600;
  await save(canvas, 'complete');
  const [complete] = await history.list('Map.canvas');
  assert.equal(await history.read('Map.canvas', complete.id),
    serializeCanvas({ ...canvas, nodes: [createCanvasNode('text', 0, 'one')] }), 'Complete preserves the original JSON exactly');
  assert.equal(JSON.parse(await history.read('Map.canvas', complete.id)).nodes[0].x, 80);
  canvas.nodes[0].text = 'Version two';
  await save(canvas);
  const [dataRevision] = await history.list('Map.canvas');
  canvas.nodes[0].x = 900;
  canvas.nodes[0].width = 500;
  await save(canvas);
  assert.equal((await history.list('Map.canvas')).length, 2, 'layout-only save creates no Data revision');
  const restored = JSON.parse(await history.read('Map.canvas', dataRevision.id));
  assert.equal(restored.nodes[0].x, 900);
  assert.equal(restored.nodes[0].width, 500);
  assert.equal(restored.nodes[0].text, '');
  assert.deepEqual(restored.extra, { keep: true });
  const rawSnapshot = JSON.parse(await fs.readFile(path.join(root, '.tagline', 'history', 'Map.canvas', dataRevision.id), 'utf8'));
  assert.equal(rawSnapshot.data.nodes[0].x, undefined, 'Data snapshot does not store positions');
  assert.equal(rawSnapshot.data.nodes[0].width, undefined, 'Data snapshot does not store sizes');
  await save({ ...canvas, nodes: [] });
  assert.equal(JSON.parse(await history.read('Map.canvas', dataRevision.id)).nodes[0].x, 900, 'deleted node keeps its last layout');
  await history.rename('Map.canvas', 'Renamed.canvas');
  assert.equal(JSON.parse(await history.read('Renamed.canvas', dataRevision.id)).nodes[0].x, 900, 'shared layout follows rename');
  await history.rename('Renamed.canvas', 'Map.canvas');
  await save('{unfinished');
  const [invalidBase] = await history.list('Map.canvas');
  assert.ok(JSON.parse(await history.read('Map.canvas', invalidBase.id)).nodes);
  await save(canvas);
  const [invalid] = await history.list('Map.canvas');
  assert.equal(await history.read('Map.canvas', invalid.id), '{unfinished', 'invalid source remains recoverable');
  await assert.rejects(history.snapshot('Map.canvas', current, 50, 'unknown'), /history mode/);
});

test('extension ribbon declarations require UI permission, valid commands and persistent hidden ordering', async () => {
  const { validateManifest } = require('../electron/extensions.cjs');
  const manifest = {
    manifestVersion: 1, id: 'canvas-tools', name: 'Canvas Tools', version: '1', main: 'main.js',
    permissions: ['ui'], contributes: {
      commands: [{ id: 'new-map', title: 'New map' }],
      ribbonItems: [{ id: 'map-button', title: 'New map', icon: 'canvas', command: 'new-map' }],
    },
  };
  const validated = validateManifest(manifest, process.cwd());
  assert.equal(validated.contributes.ribbonItems[0].icon, 'canvas');
  assert.throws(() => validateManifest({ ...manifest, permissions: [] }, process.cwd()), /ui permission/);
  assert.throws(() => validateManifest({
    ...manifest, contributes: { ...manifest.contributes, ribbonItems: [{ ...manifest.contributes.ribbonItems[0], command: 'missing' }] },
  }, process.cwd()), /declared command/);
  assert.throws(() => validateManifest({
    ...manifest, contributes: { ...manifest.contributes, ribbonItems: Array(11).fill(manifest.contributes.ribbonItems[0]) },
  }, process.cwd()), /at most 10/);
  const { normalizeRibbonItems } = await import('../src/lib/ribbonItems.js');
  const contributions = [{ id: 'ext:canvas-tools.map-button' }];
  assert.deepEqual(normalizeRibbonItems(['graph'], contributions), ['graph', contributions[0].id]);
  assert.deepEqual(normalizeRibbonItems(['graph'], contributions, [contributions[0].id]), ['graph']);
  assert.deepEqual(normalizeRibbonItems([contributions[0].id, 'graph'], []), [contributions[0].id, 'graph'],
    'disabled extension ordering survives until re-enabled');
});

test('flow and Canvas extension document APIs validate structures and enforce vault permissions', async () => {
  const { ExtensionHost } = await import('../src/lib/extensions.js');
  const { createCanvasNode } = await import('../src/lib/canvas.js');
  const { EMPTY_FLOW } = await import('../electron/flow.mjs');
  const files = new Map([['Round.flow', EMPTY_FLOW], ['Map.canvas', '{"nodes":[],"edges":[]}']]);
  const manifest = { id: 'doc-tools', name: 'Documents', permissions: [], contributes: { commands: [] } };
  const host = new ExtensionHost(manifest, '', {
    read: (path) => files.get(path), write: (path, text) => { files.set(path, text); return path; },
  });
  for (const kind of ['canvas', 'flow']) {
    await assert.rejects(host.handle(`${kind}.read`, [`Test.${kind}`]), /vault:read/);
    await assert.rejects(host.handle(`${kind}.write`, [`Test.${kind}`, {}]), /vault:write/);
  }
  manifest.permissions = ['vault:read', 'vault:write'];
  const flow = await host.handle('flow.read', ['Round.flow']);
  const updated = await host.handle('helpers.flow.setCell', [flow, 0, 0, 0, 'Evidence']);
  assert.equal(await host.handle('flow.write', ['Round.flow', updated]), 'Round.flow');
  assert.equal((await host.handle('flow.read', ['Round.flow'])).sheets[0].rows[0][0], 'Evidence');
  const canvas = await host.handle('canvas.read', ['Map.canvas']);
  canvas.nodes.push(createCanvasNode('text', 0, 'claim'));
  await host.handle('canvas.write', ['Map.canvas', canvas]);
  assert.equal((await host.handle('canvas.read', ['Map.canvas'])).nodes[0].id, 'claim');
  await assert.rejects(host.handle('canvas.write', ['Card.md', canvas]), /\.canvas/);
  await assert.rejects(host.handle('canvas.write', ['Map.canvas', { nodes: [{}] }]), /Node/);
  await assert.rejects(host.handle('flow.write', ['Round.flow', { sheets: [] }]), /flow structure/);
  await assert.rejects(host.handle('helpers.flow.setCell', [flow, 1, 0, 0, 'bad']), /valid sheet/);
  assert.equal((await host.handle('helpers.flow.create', [])).version, 1);
  assert.equal((await host.handle('helpers.canvas.createNode', ['group', 0])).type, 'group');
  assert.equal((await host.handle('helpers.canvas.createArgumentEdge', ['one', 'two', 'supports'])).label, 'Supports');
  await assert.rejects(host.handle('helpers.canvas.createArgumentEdge', ['one', 'two', 'constructor']), /Unsupported argument relation/);
});

test('extension message limits use a rolling second instead of allowing boundary bursts', async () => {
  const { ExtensionHost } = await import('../src/lib/extensions.js');
  const host = new ExtensionHost({ id: 'rate-test', permissions: [] }, '', {}, { extensionMessagesPerSecond: 10 });
  for (let i = 0; i < 10; i++) assert.equal(host.acceptMessage(990 + i), true);
  assert.equal(host.acceptMessage(1001), false, 'fixed-window boundary does not reset capacity');
  assert.equal(host.acceptMessage(1990), true, 'only the oldest message expires');
  assert.equal(host.acceptMessage(1990), false);
  assert.equal(host.acceptMessage(3000), true);
});

test('invalid semantic index documents and vectors are detected for rebuilding', () => {
  const { parseEmbeddingCache, validCachedVectors } = require('../electron/embeddingMath.cjs');
  assert.throws(() => parseEmbeddingCache('{broken', 'model'), SyntaxError);
  assert.throws(() => parseEmbeddingCache('{"model":"model","documents":[]}', 'model'), /index documents/);
  assert.deepEqual(parseEmbeddingCache('{"model":"other"}', 'model'), {});
  const good = { hash: 'hash', vectors: [[1, 0, 0], [0, 1, 0]] };
  assert.equal(validCachedVectors(good, 'hash', 2, 3), true);
  for (const entry of [null, {}, { ...good, hash: 'stale' }, { ...good, vectors: [[NaN, 0, 0], [0, 1, 0]] },
    { ...good, vectors: [[1, 0, 0]] }, { ...good, vectors: [[1, 0], [0, 1]] }]) {
    assert.equal(validCachedVectors(entry, 'hash', 2, 3), false);
  }
});

test('malformed expanded-folder data is reset without affecting other saved keys', async (t) => {
  const { readStoredJson } = await import('../src/lib/storedJson.js');
  const original = { storage: global.localStorage, window: global.window };
  const data = new Map([['expanded', '{broken'], ['unrelated', 'keep']]);
  const messages = [];
  global.localStorage = { getItem: (key) => data.get(key) ?? null, removeItem: (key) => data.delete(key) };
  global.window = { dispatchEvent: (event) => messages.push(event.detail) };
  t.after(() => { global.localStorage = original.storage; global.window = original.window; });
  const valid = (value) => Array.isArray(value) && value.every((path) => typeof path === 'string');
  assert.deepEqual(readStoredJson('expanded', [], valid), []);
  await new Promise(queueMicrotask);
  assert.equal(messages.length, 1);
  assert.equal(data.get('unrelated'), 'keep');
  for (const malformed of ['null', '{}', '["Folder",5]']) {
    data.set('expanded', malformed);
    assert.deepEqual(readStoredJson('expanded', [], valid), []);
  }
  await new Promise(queueMicrotask);
});
