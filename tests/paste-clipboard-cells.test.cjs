const { test } = require('node:test');
const assert = require('node:assert/strict');

const loadHelper = () => import('../src/lib/pasteClipboardCells.js');

test('context-menu paste reads through Electron IPC when available', async () => {
  const { pasteClipboardCells } = await loadHelper();
  const calls = [];
  let ipcReads = 0;
  await pasteClipboardCells({
    api: {
      clipboardRead: async () => {
        ipcReads += 1;
        return 'a\tb\nc';
      },
    },
    navigator: {
      clipboard: {
        readText: async () => {
          throw new Error('Web clipboard should not be used when IPC is available.');
        },
      },
    },
    paste: (text, row, column) => calls.push([text, row, column]),
    onError: (error) => {
      throw error;
    },
    row: 2,
    column: 1,
  });
  assert.equal(ipcReads, 1);
  assert.deepEqual(calls, [['a\tb\nc', 2, 1]]);
});

test('context-menu paste falls back to the web clipboard', async () => {
  const { pasteClipboardCells } = await loadHelper();
  const calls = [];
  await pasteClipboardCells({
    api: null,
    navigator: { clipboard: { readText: async () => 'x\ty' } },
    paste: (text, row, column) => calls.push([text, row, column]),
    onError: (error) => {
      throw error;
    },
    row: 0,
    column: 0,
  });
  assert.deepEqual(calls, [['x\ty', 0, 0]]);
});

test('a failed clipboard read is reported instead of rejecting', async () => {
  const { pasteClipboardCells } = await loadHelper();
  const errors = [];
  let pasted = false;
  await pasteClipboardCells({
    api: { clipboardRead: async () => Promise.reject(new Error('Clipboard permission denied')) },
    navigator: { clipboard: { readText: async () => '' } },
    paste: () => {
      pasted = true;
    },
    onError: (error) => errors.push(error),
    row: 0,
    column: 0,
  });
  assert.equal(pasted, false);
  assert.deepEqual(
    errors.map((error) => error.message),
    ['Clipboard permission denied']
  );
});

test('malformed cell data is reported through the same error path as native paste', async () => {
  const { pasteClipboardCells } = await loadHelper();
  const { parseFlowCells } = await import('../src/lib/flowCells.js');
  const errors = [];
  await pasteClipboardCells({
    api: { clipboardRead: async () => '"unclosed quote' },
    navigator: { clipboard: { readText: async () => '' } },
    paste: (text) => parseFlowCells(text),
    onError: (error) => errors.push(error),
    row: 0,
    column: 0,
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /unclosed quoted value/);
});
