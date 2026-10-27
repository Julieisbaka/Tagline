const { test } = require('node:test');
const assert = require('node:assert/strict');

test('workspace tabs restore only valid vault-relative paths and known tab kinds', async () => {
  const { restoreTabs } = await import('../src/lib/useTabs.js');
  const restored = restoreTabs({
    tabs: [
      { id: 'one', kind: 'file', path: 'Folder/Note.md', stale: true },
      { id: 'graph', kind: 'graph' },
    ],
    activeId: 'graph',
  });
  assert.deepEqual(restored, {
    tabs: [{ id: 'one', kind: 'file', path: 'Folder/Note.md' }, { id: 'graph', kind: 'graph' }],
    activeId: 'graph',
    warning: null,
  });
  for (const saved of [
    null,
    { tabs: {} },
    { tabs: [{ id: 'one', kind: 'unknown' }], activeId: null },
    { tabs: [{ id: 'one', kind: 'file', path: '../outside.md' }], activeId: null },
    { tabs: [{ id: 'one', kind: 'file', path: 'C:\\outside.md' }], activeId: null },
    { tabs: [{ id: 'same', kind: 'graph' }, { id: 'same', kind: 'file', path: 'Note.md' }], activeId: null },
    { tabs: [{ id: 'one', kind: 'graph' }, { id: 'two', kind: 'graph' }], activeId: null },
  ]) assert.throws(() => restoreTabs(saved));
});

test('workspace tabs recover when the saved active ID no longer exists', async () => {
  const { restoreTabs } = await import('../src/lib/useTabs.js');
  const expected = {
    tabs: [{ id: 'one', kind: 'file', path: 'Note.md' }],
    activeId: 'one',
    warning: 'The saved active tab was unavailable; the first open tab was selected.',
  };
  assert.deepEqual(restoreTabs({
    tabs: [{ id: 'one', kind: 'file', path: 'Note.md' }],
    activeId: 'deleted',
  }), expected);
  assert.deepEqual(restoreTabs({
    tabs: [{ id: 'one', kind: 'file', path: 'Note.md' }],
    activeId: '',
  }), expected);
});

test('tabs reorder by destination index without mutating the existing order', async () => {
  const { reorderTabs } = await import('../src/lib/useTabs.js');
  const tabs = [{ id: 'one' }, { id: 'two' }, { id: 'three' }];
  assert.deepEqual(reorderTabs(tabs, 'one', 2), [{ id: 'two' }, { id: 'three' }, { id: 'one' }]);
  assert.deepEqual(tabs, [{ id: 'one' }, { id: 'two' }, { id: 'three' }]);
  assert.deepEqual(reorderTabs(tabs, 'three', 0), [{ id: 'three' }, { id: 'one' }, { id: 'two' }]);
  assert.equal(reorderTabs(tabs, 'missing', 0), tabs);
});
