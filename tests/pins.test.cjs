const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePins, serializePins } = require('../electron/pinsFile.cjs');

test('pins files round-trip favorites and pinned tabs', () => {
  const value = { favorites: ['Case', 'Case/Aff.md'], pinnedTabs: ['Case/Aff.md'] };
  const parsed = parsePins(serializePins(value));
  assert.deepEqual(parsed, value);
  assert.deepEqual(parsePins(JSON.stringify(['Case', 'Case/Aff.md'])), {
    favorites: ['Case', 'Case/Aff.md'],
    pinnedTabs: [],
  });
  assert.deepEqual(parsePins(JSON.stringify({ favorites: ['A.md', 'A.md'], tabs: ['B.md'] })), {
    favorites: ['A.md'],
    pinnedTabs: ['B.md'],
  });
});

test('pins files reject unsafe paths and malformed documents', () => {
  for (const raw of [
    '{',
    'null',
    '{}',
    JSON.stringify({ favorites: ['../outside.md'] }),
    JSON.stringify({ favorites: ['/outside.md'] }),
    JSON.stringify({ favorites: ['C:\\outside.md'] }),
    JSON.stringify({ favorites: ['a\\b.md'] }),
    JSON.stringify({ pinnedTabs: 'B.md' }),
  ]) {
    assert.equal(parsePins(raw), null, raw);
  }
  assert.throws(() => serializePins({ favorites: ['../outside.md'] }), /Invalid pinned items/);
});
