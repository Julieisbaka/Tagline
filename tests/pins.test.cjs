const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePins, serializePins, staleCorruptBackups } = require('../electron/pinsFile.cjs');

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
  assert.deepEqual(parsePins(JSON.stringify({ favorites: [' Case/Aff.md '], pinnedTabs: [] })), {
    favorites: ['Case/Aff.md'],
    pinnedTabs: [],
  });
  assert.equal(
    JSON.parse(serializePins({ favorites: [' Case/Aff.md '], pinnedTabs: [] })).favorites[0],
    'Case/Aff.md'
  );
});

test('corrupt pins backups keep only the newest copies', () => {
  assert.deepEqual(
    staleCorruptBackups(
      [
        'pins.json',
        'pins.json.corrupt-1',
        'pins.json.corrupt-2',
        'pins.json.corrupt-3',
        'pins.json.corrupt-4',
      ],
      2
    ),
    ['pins.json.corrupt-1', 'pins.json.corrupt-2']
  );
  assert.deepEqual(staleCorruptBackups(['pins.json.corrupt-1'], 3), []);
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
