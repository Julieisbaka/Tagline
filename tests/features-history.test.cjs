const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fsAsync = require('node:fs/promises');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');

const hash = (content) => createHash('sha256').update(content, 'utf8').digest('hex');

// Legacy .delta fixtures: new saves are full snapshots, but revisions written by older
// versions must stay readable.
async function writeLegacyRevision(directory, id, content, base = null) {
  let stored;
  if (!base) {
    stored = { version: 1, base: null, content, hash: hash(content) };
  } else {
    let start = 0;
    while (
      start < base.content.length &&
      start < content.length &&
      base.content[start] === content[start]
    ) {
      start++;
    }
    let end = 0;
    while (
      end < base.content.length - start &&
      end < content.length - start &&
      base.content[base.content.length - end - 1] === content[content.length - end - 1]
    ) {
      end++;
    }
    stored = {
      version: 1,
      base: base.id,
      baseHash: hash(base.content),
      hash: hash(content),
      start,
      deleteCount: base.content.length - start - end,
      insert: content.slice(start, content.length - end),
    };
  }
  await fsAsync.writeFile(path.join(directory, id), JSON.stringify(stored), { flag: 'wx' });
}

test('platform: case-only revision history rename preserves revisions', async (t) => {
  const { createRevisionHistory } = require('../electron/revisionHistory.cjs');
  const root = await fsAsync.mkdtemp(path.join(os.tmpdir(), 'tagline-case-history-'));
  t.after(() => fsAsync.rm(root, { recursive: true, force: true }));
  const resolveInVault = (rel) => path.join(root, rel);
  const history = createRevisionHistory({ getVaultRoot: () => root, resolveInVault });
  await fsAsync.writeFile(path.join(root, 'Note.md'), 'one');
  await history.snapshot('Note.md', 'two', 2);
  await fsAsync.writeFile(path.join(root, 'Note.md'), 'two');
  await history.snapshot('Note.md', 'three', 2);
  const revisions = await history.list('Note.md');
  assert.equal(revisions.length, 2);
  await history.rename('Note.md', 'note.md');
  assert.deepEqual(await history.list('note.md'), revisions);
  assert.equal(await history.read('note.md', revisions[1].id), 'one');
});

test('platform: legacy delta revisions stay readable while new saves are full snapshots', async (t) => {
  const { createRevisionHistory } = require('../electron/revisionHistory.cjs');
  const root = await fsAsync.mkdtemp(path.join(os.tmpdir(), 'tagline-legacy-deltas-'));
  t.after(() => fsAsync.rm(root, { recursive: true, force: true }));
  const history = createRevisionHistory({
    getVaultRoot: () => root,
    resolveInVault: (rel) => path.join(root, rel),
  });
  const file = 'Evidence.md';
  const directory = path.join(root, '.tagline', 'history', file);
  const versions = Array.from(
    { length: 5 },
    (_, i) => '# Evidence\r\n' + 'a'.repeat(200) + ` ${i} 😀 ` + 'z'.repeat(200)
  );
  const stamp = Date.now();
  const ids = versions.map(
    (_, i) => `${stamp + i}-${randomUUID()}.${i === 0 ? 'snapshot' : 'delta'}`
  );
  await fsAsync.mkdir(directory, { recursive: true });
  await fsAsync.writeFile(path.join(directory, ids[0]), versions[0]);
  for (let i = 1; i < versions.length; i++) {
    await writeLegacyRevision(
      directory,
      ids[i],
      versions[i],
      i === 1 ? null : { id: ids[i - 1], content: versions[i - 1] }
    );
  }
  await fsAsync.writeFile(path.join(root, file), versions.at(-1));

  const revisions = await history.list(file);
  assert.deepEqual(
    revisions.map(({ id }) => id),
    ids.toReversed()
  );
  assert.deepEqual(
    await Promise.all(revisions.map(({ id }) => history.read(file, id))),
    versions.toReversed()
  );
  await history.rename(file, 'Renamed.md');
  assert.equal(
    await history.read('Renamed.md', ids[2]),
    versions[2],
    'legacy delta bases follow rename'
  );
  await history.rename('Renamed.md', file);

  // A surviving delta at the retention boundary is rebased instead of stranded.
  await history.snapshot(file, '# Latest', 2);
  const kept = await history.list(file);
  assert.equal(kept.length, 2);
  assert.ok(kept[0].id.endsWith('.snapshot'), 'new saves are full snapshots');
  assert.ok(kept[1].id.endsWith('.delta'));
  // snapshot() stores the previous document contents, so both revisions hold the last legacy version.
  assert.equal(await history.read(file, kept[0].id), versions.at(-1));
  assert.equal(await history.read(file, kept[1].id), versions.at(-1));
});

test('platform: legacy delta read path detects missing, corrupt and circular dependencies', async (t) => {
  const { createRevisionHistory } = require('../electron/revisionHistory.cjs');
  const root = await fsAsync.mkdtemp(path.join(os.tmpdir(), 'tagline-delta-errors-'));
  t.after(() => fsAsync.rm(root, { recursive: true, force: true }));
  const history = createRevisionHistory({
    getVaultRoot: () => root,
    resolveInVault: (rel) => path.join(root, rel),
  });
  const directory = path.join(root, '.tagline', 'history', 'Note.md');
  const first = 'a'.repeat(5000);
  const base = `${Date.now()}-${randomUUID()}.snapshot`;
  const delta = `${Date.now() + 1}-${randomUUID()}.delta`;
  await fsAsync.mkdir(directory, { recursive: true });
  await fsAsync.writeFile(path.join(directory, base), first);
  await writeLegacyRevision(directory, delta, first + '1', { id: base, content: first });
  await fsAsync.writeFile(path.join(root, 'Note.md'), first + '1');
  const raw = await fsAsync.readFile(path.join(directory, delta), 'utf8');
  const parsed = JSON.parse(raw);
  await fsAsync.writeFile(path.join(directory, base), 'damaged');
  await assert.rejects(history.read('Note.md', delta), /base is damaged/);
  await fsAsync.writeFile(path.join(directory, base), first);
  await fsAsync.writeFile(
    path.join(directory, delta),
    JSON.stringify({ ...parsed, insert: 'wrong' })
  );
  await assert.rejects(history.read('Note.md', delta), /checksum/);
  await fsAsync.writeFile(path.join(directory, delta), JSON.stringify({ ...parsed, base: delta }));
  await assert.rejects(history.read('Note.md', delta), /dependency chain/);
  await fsAsync.writeFile(
    path.join(directory, delta),
    JSON.stringify({ ...parsed, base: '../outside.snapshot' })
  );
  await assert.rejects(history.read('Note.md', delta), /Invalid revision/);
  await fsAsync.writeFile(path.join(directory, delta), raw);
  await fsAsync.unlink(path.join(directory, base));
  await assert.rejects(history.read('Note.md', delta), /ENOENT/);
});

test('platform: revision history rejects symlinks in document directories and Canvas temporary files', async (t) => {
  const { createRevisionHistory } = require('../electron/revisionHistory.cjs');
  const root = await fsAsync.mkdtemp(path.join(os.tmpdir(), 'tagline-history-links-'));
  const outside = await fsAsync.mkdtemp(path.join(os.tmpdir(), 'tagline-history-outside-'));
  t.after(() => fsAsync.rm(root, { recursive: true, force: true }));
  t.after(() => fsAsync.rm(outside, { recursive: true, force: true }));
  const history = createRevisionHistory({
    getVaultRoot: () => root,
    resolveInVault: (rel) => path.join(root, rel),
  });

  await fsAsync.writeFile(path.join(root, 'Note.md'), 'old');
  await fsAsync.mkdir(path.join(root, '.tagline', 'history'), { recursive: true });
  try {
    await fsAsync.symlink(outside, path.join(root, '.tagline', 'history', 'Note.md'), 'dir');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip('creating symlinks needs elevated Windows privileges');
      return;
    }
    throw error;
  }
  await assert.rejects(history.snapshot('Note.md', 'new'), /symbolic links/);

  await fsAsync.unlink(path.join(root, '.tagline', 'history', 'Note.md'));
  await fsAsync.mkdir(path.join(root, '.tagline', 'history', 'Map.canvas'), { recursive: true });
  await fsAsync.writeFile(
    path.join(root, '.tagline', 'history', 'Map.canvas', 'layout.json'),
    '{}'
  );
  const outsideFile = path.join(outside, 'layout.json.tmp');
  await fsAsync.writeFile(outsideFile, 'unrelated');
  await fsAsync.symlink(
    outsideFile,
    path.join(root, '.tagline', 'history', 'Map.canvas', 'layout.json.tmp')
  );
  await fsAsync.writeFile(
    path.join(root, 'Map.canvas'),
    JSON.stringify({
      nodes: [{ id: 'n', type: 'text', x: 0, y: 0, width: 100, height: 100, text: 'old' }],
      edges: [],
    })
  );
  await history.snapshot(
    'Map.canvas',
    JSON.stringify({
      nodes: [{ id: 'n', type: 'text', x: 1, y: 0, width: 100, height: 100, text: 'new' }],
      edges: [],
    }),
    50,
    'complete'
  );
  assert.equal(await fsAsync.readFile(outsideFile, 'utf8'), 'unrelated');
});

test('platform: revision history snapshots changed documents, enforces retention, and follows renames', async (t) => {
  const { createRevisionHistory } = require('../electron/revisionHistory.cjs');
  const root = await fsAsync.mkdtemp(path.join(os.tmpdir(), 'tagline-history-'));
  t.after(() => fsAsync.rm(root, { recursive: true, force: true }));
  const resolveInVault = (rel) => {
    const full = path.resolve(root, rel);
    const relative = path.relative(root, full);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Path escapes vault');
    }
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
  assert.deepEqual(await Promise.all(revisions.map(({ id }) => history.read('Evidence.md', id))), [
    'Version three',
    'Version two',
  ]);

  await fsAsync.rename(note, path.join(root, 'Renamed.md'));
  await history.rename('Evidence.md', 'Renamed.md');
  revisions = await history.list('Renamed.md');
  assert.equal(revisions.length, 2);
  assert.equal(await history.read('Renamed.md', revisions[0].id), 'Version three');
  await assert.rejects(history.list('../outside.md'), /Path escapes vault/);
  await assert.rejects(
    history.snapshot('Evidence.md', 'next version', 0),
    /retention must be between/
  );
});
