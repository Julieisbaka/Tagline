const test = require('node:test');
const assert = require('node:assert/strict');
const { registerSpellcheck } = require('../electron/spellcheck.cjs');

test('spellcheck IPC routes main-frame actions to Electron spellchecker APIs', async () => {
  const handlers = new Map();
  const calls = [];
  const session = {
    listWordsInSpellCheckerDictionary: async () => ['Tagline'],
    addWordToSpellCheckerDictionary: (word) => (calls.push(['add', word]), true),
    removeWordFromSpellCheckerDictionary: (word) => (calls.push(['remove', word]), true),
  };
  const frame = {};
  const event = {
    senderFrame: frame,
    sender: {
      mainFrame: frame,
      session,
      replaceMisspelling: (word) => calls.push(['replace', word]),
    },
  };
  const ipcMain = { handle: (name, handler) => handlers.set(name, handler) };
  const assertMainFrame = (actual) => {
    if (actual.senderFrame !== actual.sender.mainFrame) {
      throw new Error('Untrusted sender.');
    }
  };
  registerSpellcheck({ ipcMain, assertMainFrame });

  assert.deepEqual(await handlers.get('spellcheck:listWords')(event), ['Tagline']);
  assert.equal(await handlers.get('spellcheck:addWord')(event, 'Tagline'), true);
  assert.equal(await handlers.get('spellcheck:removeWord')(event, 'Tagline'), true);
  await handlers.get('spellcheck:replace')(event, 'Tagline');
  assert.deepEqual(calls, [
    ['add', 'Tagline'],
    ['remove', 'Tagline'],
    ['replace', 'Tagline'],
  ]);
});

test('spellcheck IPC rejects invalid words and untrusted frames', async () => {
  const handlers = new Map();
  const ipcMain = { handle: (name, handler) => handlers.set(name, handler) };
  const assertMainFrame = (event) => {
    if (event.senderFrame !== event.sender.mainFrame) {
      throw new Error('Untrusted sender.');
    }
  };
  registerSpellcheck({ ipcMain, assertMainFrame });
  const event = { senderFrame: {}, sender: { mainFrame: {} } };

  await assert.rejects(handlers.get('spellcheck:listWords')(event), /Untrusted sender/);
  event.senderFrame = event.sender.mainFrame;
  await assert.rejects(handlers.get('spellcheck:addWord')(event, ''), /Invalid spelling word/);
  await assert.rejects(
    handlers.get('spellcheck:replace')(event, 'x'.repeat(257)),
    /Invalid spelling word/
  );
});
