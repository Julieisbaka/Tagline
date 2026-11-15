const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.window = { api: { platform: 'win32', systemLanguages: ['en-US'] } };

const base = {
  hasNote: true,
  isMarkdown: true,
  pinnedTab: false,
  togglePinTab: () => {},
  closeUnpinnedTabs: () => {},
};

test('command palette pins and unpins the active file tab', async () => {
  const { buildCommands } = await import('../src/lib/commands.js');
  const pin = buildCommands(base).find((item) => item.id === 'pin-tab');
  assert.ok(pin, 'pin-tab command is offered for a file tab');
  assert.equal(pin.label, 'Pin current tab');
  const unpin = buildCommands({ ...base, pinnedTab: true }).find((item) => item.id === 'pin-tab');
  assert.equal(unpin.label, 'Unpin current tab');
});

test('command palette hides tab pinning without an open file', async () => {
  const { buildCommands } = await import('../src/lib/commands.js');
  const list = buildCommands({ ...base, hasNote: false });
  assert.equal(
    list.find((item) => item.id === 'pin-tab'),
    undefined
  );
  assert.ok(list.find((item) => item.id === 'close-unpinned-tabs'));
});
