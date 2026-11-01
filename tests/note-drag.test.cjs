const { test } = require('node:test');
const assert = require('node:assert/strict');

test('note drags accept only existing Markdown files and use exact vault paths', async () => {
  const { draggedNotePath, draggedNoteLink, hasNoteDrag, VAULT_PATH_TYPE, NOTE_LINK_TYPE } =
    await import('../src/lib/noteDrag.js');
  const transfer = (type, value) => ({ types: [type], getData: (key) => key === type ? value : '' });
  const paths = ['Beta.md', 'Nested/Beta.md', 'Round.flow'];
  assert.equal(draggedNotePath(transfer(VAULT_PATH_TYPE, 'Nested/Beta.md'), paths), 'Nested/Beta.md');
  assert.equal(draggedNotePath(transfer(NOTE_LINK_TYPE, 'Beta.md'), paths), 'Beta.md');
  assert.equal(draggedNotePath(transfer(VAULT_PATH_TYPE, 'Round.flow'), paths), null);
  assert.equal(draggedNotePath(transfer(VAULT_PATH_TYPE, 'Nested'), paths), null);
  assert.equal(draggedNotePath(transfer(VAULT_PATH_TYPE, 'Other.md'), paths), null);
  assert.equal(hasNoteDrag(transfer('text/plain', 'Beta.md')), false);
  assert.equal(draggedNoteLink('Nested/Beta.md'), '[[Nested/Beta.md]]');
  assert.throws(() => draggedNoteLink('a#b.md'), /Cannot link/);
  assert.throws(() => draggedNoteLink('a|b.md'), /Cannot link/);
  assert.throws(() => draggedNoteLink('a]b.md'), /Cannot link/);
});
