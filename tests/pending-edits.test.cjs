const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');

test('pending edit flushers commit drafts until unregistered', async () => {
  const { flushPendingEdits, registerPendingFlush } = await import(
    pathToFileURL(path.join(root, 'src', 'lib', 'vault', 'pendingEdits.js')).href
  );
  let commits = 0;
  const unregister = registerPendingFlush(() => {
    commits += 1;
  });
  flushPendingEdits();
  flushPendingEdits();
  assert.equal(commits, 2);
  unregister();
  flushPendingEdits();
  assert.equal(commits, 2);
});

test('vault reload commits pending drafts before reading the disk snapshot', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'lib', 'vault', 'useVault.js'), 'utf8');
  const start = source.indexOf('const reload = useCallback');
  const end = source.indexOf('const open = useCallback', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const reloadSource = source.slice(start, end);
  const flushAt = reloadSource.indexOf('flushPendingEdits()');
  const snapshotAt = reloadSource.indexOf('api.readSnapshot()');
  assert.notEqual(flushAt, -1, 'reload must commit local drafts');
  assert.notEqual(snapshotAt, -1);
  assert.ok(flushAt < snapshotAt, 'reload must commit drafts before reading the snapshot');
  assert.match(
    source,
    /snapshotEpoch\.current\s*\+=\s*1;[\s\S]*?api\.write\(/,
    'starting a save must invalidate snapshots already in flight'
  );
  assert.match(
    reloadSource,
    /while \(writes\.current\.size\)[\s\S]*?snapshotEpoch\.current !== snapshot/,
    'reload must drain active writes and reject snapshots invalidated by newer saves'
  );

  const canvas = fs.readFileSync(
    path.join(root, 'src', 'components', 'canvas', 'CanvasNode.jsx'),
    'utf8'
  );
  assert.match(
    canvas,
    /registerPendingFlush\(\(\) => commitRef\.current\(\)\)/,
    'canvas textarea drafts must be registered as pending edits'
  );
});
