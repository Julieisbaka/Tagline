const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { registerVaultIpc } = require('../electron/main/ipcVault.cjs');

test('vault file writes serialize so later content always wins', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-write-race-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const note = path.join(root, 'Note.md');
  await fs.writeFile(note, 'initial');
  const handlers = {};
  let firstRenameStarted;
  const started = new Promise((resolve) => {
    firstRenameStarted = resolve;
  });
  let releaseRename;
  const release = new Promise((resolve) => {
    releaseRename = resolve;
  });
  let secondRenameStarted = false;
  const state = { vaultRoot: root };
  registerVaultIpc(
    {
      app: {},
      ipcMain: { handle: (name, handler) => (handlers[name] = handler) },
      path,
      fs: {
        ...fs,
        rename: async (source, destination) => {
          const content = await fs.readFile(source, 'utf8');
          if (content === 'first') {
            firstRenameStarted();
            await release;
          } else if (content === 'second') {
            secondRenameStarted = true;
          }
          return fs.rename(source, destination);
        },
      },
      randomUUID,
      resolveInVault: (relative) => path.join(root, relative),
      registerMcp: () => ({}),
      assertMainFrameSender() {},
    },
    state,
    { snapshot: async () => {} }
  );

  const first = handlers['fs:write']({}, 'Note.md', 'first');
  const second = handlers['fs:write']({}, 'Note.md', 'second');
  await started;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(secondRenameStarted, false);
  releaseRename();
  await Promise.all([first, second]);
  assert.equal(await fs.readFile(note, 'utf8'), 'second');
});

test('queued vault writes reject instead of targeting a newly opened vault', async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-write-vault-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const firstRoot = path.join(parent, 'first');
  const secondRoot = path.join(parent, 'second');
  await Promise.all([fs.mkdir(firstRoot), fs.mkdir(secondRoot)]);
  const handlers = {};
  const state = { vaultRoot: firstRoot };
  registerVaultIpc(
    {
      app: {},
      ipcMain: { handle: (name, handler) => (handlers[name] = handler) },
      path,
      fs,
      randomUUID,
      resolveInVault: (relative) => path.join(state.vaultRoot, relative),
      registerMcp: () => ({}),
      assertMainFrameSender() {},
    },
    state,
    { snapshot: async () => {} }
  );

  const writing = handlers['fs:write']({}, 'Note.md', 'old vault');
  state.vaultRoot = secondRoot;
  await assert.rejects(writing, /vault changed/i);
  await assert.rejects(fs.stat(path.join(secondRoot, 'Note.md')), { code: 'ENOENT' });
});
