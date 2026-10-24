const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { listVault, readVaultSnapshot } = require('../electron/vaultFiles.cjs');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-vault-files-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('vault snapshots preserve document types, sorting, paths, timestamps and hidden-file rules', async (t) => {
  const dir = await fixture(t);
  for (const folder of ['Z folder', 'Empty', '.hidden']) await fs.mkdir(path.join(dir, folder));
  const documents = { 'b.md': '# Beta', 'A.CANVAS': '{"nodes":[],"edges":[]}',
    'Z folder/Flow.flow': '{"sheets":[]}', 'Z folder/a.md': 'Nested' };
  for (const [name, text] of Object.entries({ ...documents, '.secret.md': 'Hidden',
    '.hidden/Note.md': 'Hidden', 'ignore.txt': 'Not a note' })) await fs.writeFile(path.join(dir, name), text);
  const snapshot = await readVaultSnapshot(dir);
  assert.deepEqual(snapshot.contents, documents);
  assert.deepEqual(snapshot.tree, await listVault(dir));
  assert.deepEqual(snapshot.tree.map((node) => node.name), ['Empty', 'Z folder', 'A.CANVAS', 'b.md']);
  assert.deepEqual(snapshot.tree[1].children.map((node) => node.path), ['Z folder/a.md', 'Z folder/Flow.flow']);
  assert.deepEqual(Object.keys(snapshot.contents), ['Z folder/a.md', 'Z folder/Flow.flow', 'A.CANVAS', 'b.md']);
  assert.equal(snapshot.tree[2].mtime, (await fs.stat(path.join(dir, 'A.CANVAS'))).mtimeMs);
  assert.equal((await listVault(path.join(dir, 'Z folder'), 'Moved'))[0].path, 'Moved/a.md');
});

test('snapshot scans once, reads each file once, and bounds parallel filesystem operations', async (t) => {
  const dir = await fixture(t);
  await fs.mkdir(path.join(dir, 'Folder'));
  for (let i = 0; i < 65; i++) await fs.writeFile(path.join(dir, 'Folder', `${i}.md`), `Note ${i}`);
  let directories = 0, reads = 0, stats = 0, active = 0, peak = 0;
  for (const name of ['readdir', 'readFile', 'stat']) {
    const original = fs[name];
    t.mock.method(fs, name, async (...args) => {
      if (name === 'readdir') directories++;
      if (name === 'readFile') reads++;
      if (name === 'stat') stats++;
      peak = Math.max(peak, ++active);
      try { return await original(...args); }
      finally { active--; }
    });
  }
  assert.equal(Object.keys((await readVaultSnapshot(dir)).contents).length, 65);
  assert.equal(directories, 2);
  assert.equal(reads, 65);
  assert.equal(stats, 65);
  assert.ok(peak > 1 && peak <= 16, `Expected 2–16 concurrent operations, got ${peak}`);
  await listVault(dir);
  assert.equal(reads, 65, 'Listing files never reads their content');
});

test('snapshot propagates filesystem errors instead of returning a partial vault', async (t) => {
  const dir = await fixture(t);
  await assert.rejects(readVaultSnapshot(path.join(dir, 'missing')), { code: 'ENOENT' });
  await fs.writeFile(path.join(dir, 'Note.md'), 'Note');
  const readFile = fs.readFile;
  t.mock.method(fs, 'readFile', async (file, ...args) => {
    if (file === path.join(dir, 'Note.md')) throw new Error('Cannot read note');
    return readFile(file, ...args);
  });
  await assert.rejects(readVaultSnapshot(dir), /Cannot read note/);
});

test('visual fallback checks do not depend on loading the visual editor', async () => {
  const { visualBlocker } = await import('../src/lib/visualHelpers.js');
  assert.equal(visualBlocker('# Markdown\n\n**Evidence**'), null);
  for (const content of ['---\na: b\n---', '<div>HTML</div>', '[^a]: Footnote', '![Image](image.png)', '$$\na+b'])
    assert.equal(typeof visualBlocker(content), 'string');
  assert.equal(visualBlocker('```html\n<div>Example</div>\n```'), null);
});
