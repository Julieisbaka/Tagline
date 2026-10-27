const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const fsAsync = require('node:fs/promises');
const os = require('node:os');
const { promisify } = require('node:util');

test('argument-map relations are JSON Canvas edges and do not affect note links', async () => {
  const { createArgumentEdge, parseCanvas, serializeCanvas } = await import('../src/lib/canvas.js');
  const { extractLinks } = await import('../src/lib/vault.js');
  const nodes = [
    { id: 'claim', type: 'text', x: 0, y: 0, width: 280, height: 180, text: 'Claim [[Evidence]]' },
    { id: 'evidence', type: 'text', x: 320, y: 0, width: 280, height: 180, text: 'Evidence' },
  ];
  for (const [relation, label, color] of [
    ['supports', 'Supports', '4'],
    ['answers', 'Answers', '2'],
    ['contradicts', 'Contradicts', '1'],
  ]) {
    const canvas = { nodes, edges: [createArgumentEdge('claim', 'evidence', relation, `${relation}-edge`)] };
    const [edge] = parseCanvas(serializeCanvas(canvas)).edges;
    assert.deepEqual(edge, {
      id: `${relation}-edge`, fromNode: 'claim', toNode: 'evidence',
      fromSide: 'right', toSide: 'left', toEnd: 'arrow', label, color,
    });
  }
  assert.deepEqual(extractLinks('Claim [[Evidence]]'), ['Evidence']);
  assert.throws(() => createArgumentEdge('claim', 'evidence', 'unknown'), /Unsupported argument relation/);
});

test('vault indexing preserves link resolution precedence with indexed path lookups', async () => {
  const { buildIndex, resolveLink } = await import('../src/lib/vault.js');
  const targets = [
    'folder/exact.md', 'exact', 'shared', 'first/shared', 'SHARED.MD', 'plain',
    'name', 'name.flow', 'tail/x', 'missing',
  ];
  const contents = {
    'Source.md': targets.map((target) => `[[${target}]]`).join(' '),
    'First/Shared.md': '',
    'Shared.md': '',
    'Folder/Exact.md': '',
    'exact.md': '',
    'first/shared.flow': '',
    'second/shared.canvas': '',
    'plain.canvas': '',
    'a/name.md': '',
    'name.flow': '',
    'tail/x.md': '',
  };
  const paths = Object.keys(contents);
  const expected = [...new Set(targets.map((target) => resolveLink(target, paths)).filter(Boolean))];
  const index = buildIndex(contents);
  assert.deepEqual(index.links['Source.md'], expected);
  assert.deepEqual(index.unresolved.missing, ['Source.md']);
  for (const resolved of expected) assert.deepEqual(index.backlinks[resolved], ['Source.md']);
});

test('JSON Canvas validates spec fields and round-trips unknown properties', async () => {
  const { EMPTY_CANVAS, parseCanvas, serializeCanvas, createCanvasNode } = await import('../src/lib/canvas.js');
  const canvas = parseCanvas(JSON.stringify({
    nodes: [
      { id: 'a', type: 'text', x: -20, y: 5, width: 280, height: 180, text: '**Claim**', pluginData: { keep: true } },
      { id: 'b', type: 'link', x: 320, y: 5, width: 280, height: 180, url: 'https://example.com', color: '6' },
    ],
    edges: [{ id: 'edge', fromNode: 'a', toNode: 'b', fromSide: 'right', toSide: 'left', toEnd: 'arrow', label: 'supports' }],
  }));
  const serialized = serializeCanvas(canvas);
  assert.equal(parseCanvas(serialized).nodes[0].pluginData.keep, true);
  assert.equal(parseCanvas(serialized).edges[0].label, 'supports');
  assert.deepEqual(parseCanvas(EMPTY_CANVAS), { nodes: [], edges: [] });
  assert.equal(createCanvasNode('group', 0, 'group').type, 'group');
  for (const invalid of [
    '{"nodes":[{"id":"x","type":"text","x":0,"y":0,"width":0,"height":10,"text":""}]}',
    '{"nodes":[{"id":"x","type":"file","x":0,"y":0,"width":10,"height":10,"file":""}],"edges":[{"id":"e","fromNode":"x","toNode":"missing"}]}',
    '{"nodes":[{"id":"x","type":"other","x":0,"y":0,"width":10,"height":10}]}',
  ]) assert.throws(() => parseCanvas(invalid));
});

test('canvas extension helpers share resolution, suggestion and movement behavior without file access', async () => {
  const { ExtensionHost } = await import('../src/lib/extensions.js');
  const host = new ExtensionHost({ id: 'canvas-test', permissions: [], contributes: { commands: [] } }, '', {});
  const call = (name, ...args) => host.handle(`helpers.canvas.${name}`, args);
  const paths = ['Cards/Evidence.md', 'Round.flow', 'Map.canvas', 'OtherEvidence.md'];
  assert.deepEqual(await call('resolveLink', '[[Round.flow#Speech|Round]]', paths),
    { type: 'file', path: 'Round.flow', heading: 'Speech', label: 'Round' });
  assert.deepEqual(await call('resolveLink', 'https://example.com', paths), { type: 'web', url: 'https://example.com/' });
  for (const target of ['missing.md', 'javascript:alert(1)', 'file:///secret']) {
    assert.equal(await call('resolveLink', target, paths), null);
  }
  assert.deepEqual(await call('suggestFiles', paths, 'evidence', 1), ['Cards/Evidence.md']);
  const id = await call('createId');
  assert.ok(typeof id === 'string' && id.length > 0);
  assert.notEqual(await call('createId'), id);
  const node = { id, type: 'text', x: 5, y: 8, width: 100, height: 100, text: 'Claim', custom: 'keep' };
  const data = { nodes: [node, { ...node, id: 'other' }], edges: [], metadata: { keep: true } };
  const moved = await call('moveNodes', data, [id], 40, -20);
  assert.deepEqual(moved.nodes[0], { ...node, x: 45, y: -12 });
  assert.deepEqual(moved.nodes[1], data.nodes[1]);
  assert.deepEqual(moved.metadata, data.metadata);
  assert.equal(data.nodes[0].x, 5, 'pure helper never mutates its input');
  for (const limit of [0, -1, 1.5, 1001]) await assert.rejects(call('suggestFiles', paths, '', limit), /limit/);
  await assert.rejects(call('resolveLink', 'Round.flow', [null]), /Paths/);
  await assert.rejects(call('resolveLink', null, paths), /Link target/);
  await assert.rejects(call('moveNodes', data, [id], 1.5, 0), /safe integers/);
  await assert.rejects(call('moveNodes', { nodes: {} }, [], 0, 0), /arrays/);
  await assert.rejects(call('moveNodes', data, [id], Number.MAX_SAFE_INTEGER, 0), /integer/);
});

