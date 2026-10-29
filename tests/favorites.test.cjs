const { test } = require('node:test');
const assert = require('node:assert/strict');

test('pinned note paths follow file and folder renames without changing siblings', async () => {
  const { renameFavorites, removeFavorites } = await import('../src/lib/useFavorites.js');
  const paths = ['Folder/Note.md', 'Folder/Nested/Other.md', 'Folder2/Note.md'];
  assert.deepEqual(renameFavorites(paths, 'Folder', 'Moved'), ['Moved/Note.md', 'Moved/Nested/Other.md', 'Folder2/Note.md']);
  assert.deepEqual(renameFavorites(paths, 'Folder/Note.md', 'Folder/Renamed.md'), ['Folder/Renamed.md', 'Folder/Nested/Other.md', 'Folder2/Note.md']);
  assert.deepEqual(removeFavorites(paths, 'Folder'), ['Folder2/Note.md']);
  assert.deepEqual(paths, ['Folder/Note.md', 'Folder/Nested/Other.md', 'Folder2/Note.md']);
});
