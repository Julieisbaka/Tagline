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

test('command palette scores come from the keybindings, not from dead call arguments', async () => {
  const { buildCommands } = await import('../src/lib/commands.js');
  const list = buildCommands(base);
  assert.equal(list.find((item) => item.id === 'switcher').hotkey, 'Ctrl+O');
  assert.equal(list.find((item) => item.id === 'search').hotkey, 'Ctrl+Shift+F');
  assert.equal(list.find((item) => item.id === 'graph').hotkey, 'Ctrl+G');
  assert.equal(list.find((item) => item.id === 'settings').hotkey, 'Ctrl+,');
  assert.equal(list.find((item) => item.id === 'toggle-mode').hotkey, 'Ctrl+E');
  assert.equal(list.find((item) => item.id === 'close-tab').hotkey, 'Ctrl+W');
});

test('a punctuation-only palette query matches nothing', async () => {
  const { commandScore } = await import('../src/lib/commands.js');
  const item = {
    label: 'Pin current tab',
    detail: 'Pin the active file tab',
    hotkey: 'Ctrl+Shift+P',
  };
  assert.equal(commandScore('...', item), -1);
  assert.equal(commandScore(' - ', item), -1);
  assert.ok(commandScore('pin', item) > 0);
  assert.equal(commandScore('', item), 1);
});
