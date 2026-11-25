const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fssync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { registerVaultIpc } = require('../electron/main/ipcVault.cjs');
const { createVault } = require('../electron/main/vault.cjs');
const { createRevisionHistory } = require('../electron/revisionHistory.cjs');

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

test('MCP deletes serialize behind writes and reject after a vault switch', async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-mcp-delete-race-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const firstRoot = path.join(parent, 'first');
  const secondRoot = path.join(parent, 'second');
  await Promise.all([fs.mkdir(firstRoot), fs.mkdir(secondRoot)]);
  const note = path.join(firstRoot, 'Note.md');
  await fs.writeFile(note, 'initial');
  const handlers = {};
  const state = { vaultRoot: firstRoot };
  let mcpTrashItem;
  let firstRenameStarted;
  const started = new Promise((resolve) => {
    firstRenameStarted = resolve;
  });
  let releaseRename;
  const release = new Promise((resolve) => {
    releaseRename = resolve;
  });
  let trashed = false;
  registerVaultIpc(
    {
      app: {},
      ipcMain: { handle: (name, handler) => (handlers[name] = handler) },
      path,
      fs: {
        ...fs,
        rename: async (source, destination) => {
          if ((await fs.readFile(source, 'utf8')) === 'saved') {
            firstRenameStarted();
            await release;
          }
          return fs.rename(source, destination);
        },
      },
      randomUUID,
      resolveInVault: (relative, root = state.vaultRoot) => path.join(root, relative),
      registerMcp: ({ trashItem }) => {
        mcpTrashItem = trashItem;
        return {};
      },
      assertMainFrameSender() {},
      shell: {
        trashItem: async (full) => {
          trashed = true;
          await fs.rm(full);
        },
      },
    },
    state,
    { snapshot: async () => {} }
  );

  const writing = handlers['fs:write']({}, 'Note.md', 'saved');
  await started;
  const deleting = mcpTrashItem(note, firstRoot);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(trashed, false, 'MCP delete must wait for the in-flight write');
  state.vaultRoot = secondRoot;
  releaseRename();
  await writing;
  await assert.rejects(deleting, /vault changed/i);
  assert.equal(trashed, false);
  assert.equal(await fs.readFile(note, 'utf8'), 'saved');
});

test('a vault switch during a save keeps the document and its revision together', async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-history-vault-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const first = path.join(parent, 'first');
  const second = path.join(parent, 'second');
  await Promise.all([fs.mkdir(first), fs.mkdir(second)]);
  await Promise.all([
    fs.writeFile(path.join(first, 'Note.md'), 'first old'),
    fs.writeFile(path.join(second, 'Note.md'), 'second old'),
  ]);
  const state = { vaultRoot: first };
  const { resolveInVault } = createVault({ path, fs, fssync, randomUUID, process }, state);
  const history = createRevisionHistory({ getVaultRoot: () => state.vaultRoot, resolveInVault });
  const handlers = {};
  registerVaultIpc(
    {
      app: {},
      ipcMain: { handle: (name, handler) => (handlers[name] = handler) },
      path,
      fs,
      randomUUID,
      resolveInVault,
      registerMcp: () => ({}),
      assertMainFrameSender() {},
    },
    state,
    history
  );
  const originalRead = fs.readFile;
  let release;
  const blocked = new Promise((resolve) => (release = resolve));
  let started;
  const waiting = new Promise((resolve) => (started = resolve));
  t.mock.method(fs, 'readFile', async (...args) => {
    if (args[0] === path.join(first, 'Note.md')) {
      const result = await originalRead(...args);
      started();
      await blocked;
      return result;
    }
    return originalRead(...args);
  });

  const writing = handlers['fs:write']({}, 'Note.md', 'first new');
  await waiting;
  state.vaultRoot = second;
  release();
  await writing;
  assert.equal(await originalRead(path.join(first, 'Note.md'), 'utf8'), 'first new');
  assert.equal(await originalRead(path.join(second, 'Note.md'), 'utf8'), 'second old');
  const revisions = await fs.readdir(path.join(first, '.tagline', 'history', 'Note.md'));
  assert.equal(revisions.length, 1);
  assert.equal(
    await originalRead(path.join(first, '.tagline', 'history', 'Note.md', revisions[0]), 'utf8'),
    'first old'
  );
  await assert.rejects(fs.stat(path.join(second, '.tagline', 'history')), { code: 'ENOENT' });
});

for (const operation of ['fs:create', 'fs:mkdir', 'fs:rename']) {
  test(`a vault switch during ${operation} keeps the mutation in its original vault`, async (t) => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-mutation-vault-'));
    t.after(() => fs.rm(parent, { recursive: true, force: true }));
    const first = path.join(parent, 'first');
    const second = path.join(parent, 'second');
    await Promise.all([fs.mkdir(first), fs.mkdir(second)]);
    await Promise.all([
      fs.writeFile(path.join(first, 'Note.md'), 'first old'),
      fs.writeFile(path.join(second, 'Note.md'), 'second old'),
    ]);
    const state = { vaultRoot: first };
    const { resolveInVault, uniquePath, toPosix } = createVault(
      { path, fs, fssync, randomUUID, process },
      state
    );
    const history = createRevisionHistory({ getVaultRoot: () => state.vaultRoot, resolveInVault });
    await history.snapshot('Note.md', 'next');
    let release;
    const blocked = new Promise((resolve) => (release = resolve));
    let started;
    const waiting = new Promise((resolve) => (started = resolve));
    const handlers = {};
    const pause = async () => {
      started();
      await blocked;
    };
    registerVaultIpc(
      {
        app: {},
        ipcMain: { handle: (name, handler) => (handlers[name] = handler) },
        path,
        fs: {
          ...fs,
          mkdir: async (...args) => {
            if (operation !== 'fs:rename' && args[0] === first) {
              await pause();
            }
            return fs.mkdir(...args);
          },
          stat: async (...args) => {
            if (operation === 'fs:rename' && args[0] === path.join(first, 'Note.md')) {
              await pause();
            }
            return fs.stat(...args);
          },
        },
        fssync,
        randomUUID,
        resolveInVault,
        uniquePath,
        toPosix,
        NOTE_EXTS: ['.md'],
        registerMcp: () => ({}),
        assertMainFrameSender() {},
      },
      state,
      history
    );

    const mutation =
      operation === 'fs:rename'
        ? handlers[operation]({}, 'Note.md', 'Renamed.md')
        : operation === 'fs:create'
          ? handlers[operation]({}, 'New.md', 'new')
          : handlers[operation]({}, 'New', false);
    await waiting;
    state.vaultRoot = second;
    release();
    await mutation;
    const target =
      operation === 'fs:rename' ? 'Renamed.md' : operation === 'fs:create' ? 'New.md' : 'New';
    await fs.stat(path.join(first, target));
    await assert.rejects(fs.stat(path.join(second, target)), { code: 'ENOENT' });
    if (operation === 'fs:rename') {
      const revisions = await fs.readdir(path.join(first, '.tagline', 'history', target));
      assert.equal(revisions.length, 1);
      assert.equal(
        await fs.readFile(path.join(first, '.tagline', 'history', target, revisions[0]), 'utf8'),
        'first old'
      );
      await assert.rejects(fs.stat(path.join(second, '.tagline', 'history')), { code: 'ENOENT' });
      assert.equal(await fs.readFile(path.join(second, 'Note.md'), 'utf8'), 'second old');
    }
  });
}
