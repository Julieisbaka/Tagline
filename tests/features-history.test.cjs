const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const fsAsync = require('node:fs/promises');
const os = require('node:os');
const { promisify } = require('node:util');

test('platform: experimental history deltas round-trip, checkpoint, prune safely and survive disabling', async (t) => {
  const { createRevisionHistory } = require('../electron/revisionHistory.cjs');
  assert.equal(require('../src/lib/defaultSettings.json').experimentalHistoryDeltas, false);
  const root = await fsAsync.mkdtemp(path.join(os.tmpdir(), 'tagline-deltas-'));
  t.after(() => fsAsync.rm(root, { recursive: true, force: true }));
  const history = createRevisionHistory({ getVaultRoot: () => root, resolveInVault: (rel) => path.join(root, rel) });
  const file = 'Evidence.md';
  const directory = path.join(root, '.tagline', 'history', file);
  const versions = Array.from({ length: 26 }, (_, i) => '# Evidence\r\n' + 'a'.repeat(4000) + ` ${i} 😀 ` + 'z'.repeat(4000));
  await fsAsync.writeFile(path.join(root, file), versions[0]);
  for (let i = 1; i <= 21; i++) {
    await history.snapshot(file, versions[i], 50, 'complete', true);
    await fsAsync.writeFile(path.join(root, file), versions[i]);
  }
  const revisions = await history.list(file);
  assert.deepEqual(await Promise.all(revisions.map(({ id }) => history.read(file, id))), versions.slice(0, 21).reverse());
  const chronological = revisions.toReversed();
  assert.ok(chronological[0].id.endsWith('.snapshot'));
  assert.ok(chronological[1].id.endsWith('.delta'));
  assert.ok(chronological[10].id.endsWith('.snapshot'), 'checkpoint after at most nine deltas');
  assert.ok(chronological[20].id.endsWith('.snapshot'));
  const deltaSize = (await fsAsync.stat(path.join(directory, chronological[1].id))).size;
  assert.ok(deltaSize < Buffer.byteLength(versions[1]) / 4, 'small edits measurably reduce storage');
  for (let i = 22; i <= 24; i++) {
    await history.snapshot(file, versions[i], 3, 'complete', true);
    await fsAsync.writeFile(path.join(root, file), versions[i]);
    const kept = await history.list(file);
    assert.equal(kept.length, 3);
    assert.deepEqual(await Promise.all(kept.map(({ id }) => history.read(file, id))), versions.slice(i - 3, i).reverse());
  }
  await history.snapshot(file, versions[25], 3, 'complete', false);
  let kept = await history.list(file);
  assert.ok(kept[0].id.endsWith('.snapshot'), 'disabling writes full snapshots');
  assert.deepEqual(await Promise.all(kept.map(({ id }) => history.read(file, id))), versions.slice(22, 25).reverse());
  await history.rename(file, 'Renamed.md');
  assert.equal(await history.read('Renamed.md', kept[1].id), versions[23], 'delta bases follow rename');
  await history.rename('Renamed.md', file);
  await fsAsync.writeFile(path.join(root, file), versions[25]);
  await history.snapshot(file, 'short', 1, 'complete', true);
  kept = await history.list(file);
  assert.equal(kept.length, 1);
  assert.equal(await history.read(file, kept[0].id), versions[25]);
  await fsAsync.writeFile(path.join(root, file), 'short');
  await history.snapshot(file, '', 50, 'complete', true);
  assert.ok((await history.list(file))[0].id.endsWith('.snapshot'), 'deltas larger than full content are not stored');
  await assert.rejects(history.snapshot(file, 'next', 50, 'complete', 'true'), /enabled or disabled/);
});

test('platform: experimental delta history detects missing, corrupt and circular dependencies', async (t) => {
  const { createRevisionHistory } = require('../electron/revisionHistory.cjs');
  const root = await fsAsync.mkdtemp(path.join(os.tmpdir(), 'tagline-delta-errors-'));
  t.after(() => fsAsync.rm(root, { recursive: true, force: true }));
  const history = createRevisionHistory({ getVaultRoot: () => root, resolveInVault: (rel) => path.join(root, rel) });
  const directory = path.join(root, '.tagline', 'history', 'Note.md');
  const first = 'a'.repeat(5000);
  await fsAsync.writeFile(path.join(root, 'Note.md'), first);
  await history.snapshot('Note.md', first + '1', 50, 'complete', true);
  await fsAsync.writeFile(path.join(root, 'Note.md'), first + '1');
  await history.snapshot('Note.md', first + '2', 50, 'complete', true);
  const [delta, base] = await history.list('Note.md');
  assert.ok(delta.id.endsWith('.delta'));
  const raw = await fsAsync.readFile(path.join(directory, delta.id), 'utf8');
  const parsed = JSON.parse(raw);
  await fsAsync.writeFile(path.join(directory, base.id), 'damaged');
  await assert.rejects(history.read('Note.md', delta.id), /base is damaged/);
  await fsAsync.writeFile(path.join(directory, base.id), first);
  await fsAsync.writeFile(path.join(directory, delta.id), JSON.stringify({ ...parsed, insert: 'wrong' }));
  await assert.rejects(history.read('Note.md', delta.id), /checksum/);
  await fsAsync.writeFile(path.join(directory, delta.id), JSON.stringify({ ...parsed, base: delta.id }));
  await assert.rejects(history.read('Note.md', delta.id), /dependency chain/);
  await fsAsync.writeFile(path.join(directory, delta.id), JSON.stringify({ ...parsed, base: '../outside.snapshot' }));
  await assert.rejects(history.read('Note.md', delta.id), /Invalid revision/);
  await fsAsync.writeFile(path.join(directory, delta.id), raw);
  await fsAsync.unlink(path.join(directory, base.id));
  await assert.rejects(history.read('Note.md', delta.id), /ENOENT/);
});

test('platform: revision history snapshots changed documents, enforces retention, and follows renames', async (t) => {
  const { createRevisionHistory } = require('../electron/revisionHistory.cjs');
  const root = await fsAsync.mkdtemp(path.join(os.tmpdir(), 'tagline-history-'));
  t.after(() => fsAsync.rm(root, { recursive: true, force: true }));
  const resolveInVault = (rel) => {
    const full = path.resolve(root, rel);
    const relative = path.relative(root, full);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Path escapes vault');
    return full;
  };
  const history = createRevisionHistory({ getVaultRoot: () => root, resolveInVault });
  const note = path.join(root, 'Evidence.md');
  await fsAsync.writeFile(note, 'Version one');

  const save = async (content) => {
    await history.snapshot('Evidence.md', content, 2);
    await fsAsync.writeFile(note, content);
  };
  await save('Version one');
  assert.deepEqual(await history.list('Evidence.md'), []);
  await save('Version two');
  await save('Version three');
  await save('Version four');
  let revisions = await history.list('Evidence.md');
  assert.equal(revisions.length, 2);
  assert.deepEqual(await Promise.all(revisions.map(({ id }) => history.read('Evidence.md', id))),
    ['Version three', 'Version two']);

  await fsAsync.rename(note, path.join(root, 'Renamed.md'));
  await history.rename('Evidence.md', 'Renamed.md');
  revisions = await history.list('Renamed.md');
  assert.equal(revisions.length, 2);
  assert.equal(await history.read('Renamed.md', revisions[0].id), 'Version three');
  await assert.rejects(history.list('../outside.md'), /Path escapes vault/);
  await assert.rejects(history.snapshot('Evidence.md', 'next version', 0), /retention must be between/);
});
