const { test } = require('node:test');
const assert = require('node:assert/strict');

test('pinned note and folder paths follow file and folder renames without changing siblings', async () => {
  const { renameFavorites, removeFavorites } = await import('../src/lib/vault/useFavorites.js');
  const paths = ['Folder', 'Folder/Note.md', 'Folder/Nested/Other.md', 'Folder2/Note.md'];
  assert.deepEqual(renameFavorites(paths, 'Folder', 'Moved'), [
    'Moved',
    'Moved/Note.md',
    'Moved/Nested/Other.md',
    'Folder2/Note.md',
  ]);
  assert.deepEqual(renameFavorites(paths, 'Folder/Note.md', 'Folder/Renamed.md'), [
    'Folder',
    'Folder/Renamed.md',
    'Folder/Nested/Other.md',
    'Folder2/Note.md',
  ]);
  assert.deepEqual(removeFavorites(paths, 'Folder'), ['Folder2/Note.md']);
  assert.deepEqual(paths, [
    'Folder',
    'Folder/Note.md',
    'Folder/Nested/Other.md',
    'Folder2/Note.md',
  ]);
});

test('pins read results tell missing, saved and corrupted files apart', async () => {
  const { parsePinsResult } = await import('../src/lib/vault/useFavorites.js');
  assert.deepEqual(parsePinsResult(null), {
    favorites: null,
    pinnedTabs: null,
    corrupted: false,
  });
  assert.deepEqual(parsePinsResult({ favorites: ['a.md'], pinnedTabs: ['b.md'] }), {
    favorites: ['a.md'],
    pinnedTabs: ['b.md'],
    corrupted: false,
  });
  assert.deepEqual(parsePinsResult({ favorites: [], pinnedTabs: [], corrupted: true }), {
    favorites: [],
    pinnedTabs: [],
    corrupted: true,
  });
});

test('pin failures report read and write errors separately', async () => {
  const { pinErrorDetail } = await import('../src/lib/vault/useFavorites.js');
  const error = new Error('disk gone');
  assert.equal(pinErrorDetail('load', error), 'Could not load pinned items: disk gone');
  assert.equal(pinErrorDetail('save', error), 'Could not save pinned items: disk gone');
});

test('pin writes drop entries the writer rejects and cap the list', async () => {
  const { sanitizePinPaths } = await import('../src/lib/vault/useFavorites.js');
  assert.deepEqual(
    sanitizePinPaths([
      'a.md',
      '',
      '  ',
      '/abs.md',
      'C:/win.md',
      'a\\b.md',
      '../up.md',
      'a/../b.md',
    ]),
    ['a.md']
  );
  assert.deepEqual(sanitizePinPaths(['a.md', 'a.md', ' b.md ']), ['a.md', 'b.md']);
  assert.deepEqual(sanitizePinPaths(['a.md', 'b.md', 'c.md'], 2), ['b.md', 'c.md']);
});
