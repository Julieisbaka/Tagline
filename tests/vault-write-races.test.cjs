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
const { createMcpService } = require('../electron/mcp.cjs');

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

for (const scenario of ['create', 'append', 'renderer save']) {
  test(`MCP note ${scenario} observes preceding queued writes`, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-mcp-note-race-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const note = path.join(root, 'Note.md');
    if (scenario !== 'create') {
      await fs.writeFile(note, 'initial');
    }
    const state = { vaultRoot: root };
    const handlers = {};
    let service;
    let release;
    const blocked = new Promise((resolve) => (release = resolve));
    let started;
    const waiting = new Promise((resolve) => (started = resolve));
    let snapshots = 0;
    registerVaultIpc(
      {
        app: {},
        ipcMain: { handle: (name, handler) => (handlers[name] = handler) },
        path,
        fs,
        randomUUID,
        resolveInVault: (rel, vaultRoot = state.vaultRoot) => path.join(vaultRoot, rel),
        registerMcp: (options) => {
          service = createMcpService(options);
          return {};
        },
        assertMainFrameSender() {},
      },
      state,
      {
        snapshot: async () => {
          if (++snapshots === 1) {
            started();
            await blocked;
          }
        },
      }
    );
    const call = (name, content) =>
      service.handle({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: { path: 'Note.md', content } },
      });
    const first =
      scenario === 'renderer save'
        ? handlers['fs:write']({}, 'Note.md', 'saved')
        : call(scenario === 'create' ? 'write_note' : 'append_to_note', 'first');
    await waiting;
    const second = call(scenario === 'create' ? 'write_note' : 'append_to_note', 'second');
    await new Promise((resolve) => setImmediate(resolve));
    release();
    const [firstResult, secondResponse] = await Promise.all([first, second]);
    const secondResult = secondResponse.result;
    if (scenario === 'create') {
      assert.equal(firstResult.result.isError, undefined);
      assert.equal(JSON.parse(firstResult.result.content[0].text).created, true);
      assert.equal(secondResult.isError, true);
      assert.match(secondResult.content[0].text, /already exists/i);
      assert.equal(await fs.readFile(note, 'utf8'), 'first');
    } else {
      assert.equal(secondResult.isError, undefined);
      const expected = scenario === 'append' ? 'initial\nfirst\nsecond' : 'saved\nsecond';
      assert.equal(await fs.readFile(note, 'utf8'), expected);
      assert.equal(JSON.parse(secondResult.content[0].text).characters, expected.length);
    }
  });
}

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

for (const name of ['write_note', 'append_to_note', 'rename_path']) {
  test(`MCP ${name} rejects a vault switch during path inspection`, async (t) => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-mcp-switch-'));
    t.after(() => fs.rm(parent, { recursive: true, force: true }));
    const first = path.join(parent, 'first');
    const second = path.join(parent, 'second');
    await Promise.all([fs.mkdir(first), fs.mkdir(second)]);
    await Promise.all([
      fs.writeFile(path.join(first, 'Note.md'), 'first'),
      fs.writeFile(path.join(second, 'Note.md'), 'second'),
    ]);
    const state = { vaultRoot: first };
    const { resolveInVault, toPosix } = createVault(
      { path, fs, fssync, randomUUID, process },
      state
    );
    let service;
    registerVaultIpc(
      {
        app: {},
        ipcMain: { handle() {} },
        path,
        fs,
        fssync,
        randomUUID,
        resolveInVault,
        toPosix,
        NOTE_EXTS: ['.md'],
        registerMcp: (options) => {
          service = createMcpService(options);
          return {};
        },
        assertMainFrameSender() {},
      },
      state,
      { snapshot: async () => {}, rename: async () => {} }
    );
    let release;
    const blocked = new Promise((resolve) => (release = resolve));
    let started;
    const waiting = new Promise((resolve) => (started = resolve));
    const originalStat = fs.stat;
    t.mock.method(fs, 'stat', async (...args) => {
      const result = await originalStat(...args);
      if (args[0] === path.join(first, 'Note.md')) {
        started();
        await blocked;
      }
      return result;
    });
    const args =
      name === 'rename_path'
        ? { from: 'Note.md', to: 'Renamed.md' }
        : { path: 'Note.md', content: 'changed', overwrite: true };
    const operation = service.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    });
    await waiting;
    state.vaultRoot = second;
    release();
    const { result } = await operation;
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /vault changed/i);
    assert.equal(await fs.readFile(path.join(first, 'Note.md'), 'utf8'), 'first');
    assert.equal(await fs.readFile(path.join(second, 'Note.md'), 'utf8'), 'second');
    await assert.rejects(fs.stat(path.join(second, 'Renamed.md')), { code: 'ENOENT' });
  });
}

test('sample initialization holds the mutation queue and stays in its original vault', async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-sample-race-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const first = path.join(parent, 'Tagline Sample Vault');
  const second = path.join(parent, 'second');
  await Promise.all([fs.mkdir(first), fs.mkdir(second)]);
  const state = { vaultRoot: second };
  const handlers = {};
  let releaseOpen;
  const openBlocked = new Promise((resolve) => (releaseOpen = resolve));
  let opened;
  const openStarted = new Promise((resolve) => (opened = resolve));
  let releaseSample;
  const sampleBlocked = new Promise((resolve) => (releaseSample = resolve));
  let sampling;
  const sampleStarted = new Promise((resolve) => (sampling = resolve));
  registerVaultIpc(
    {
      app: {},
      ipcMain: { handle: (name, handler) => (handlers[name] = handler) },
      dialog: { showOpenDialog: async () => ({ filePaths: [parent] }) },
      path,
      fs: {
        ...fs,
        writeFile: async (file, ...args) => {
          if (file === path.join(first, 'Sample.md')) {
            sampling();
            await sampleBlocked;
          }
          return fs.writeFile(file, ...args);
        },
      },
      fssync,
      randomUUID,
      SAMPLE_VAULT: { 'Sample.md': 'sample', 'Other.md': 'other' },
      resolveInVault: (rel, root = state.vaultRoot) => path.join(root, rel),
      openVault: async (root) => {
        state.vaultRoot = root;
        opened();
        await openBlocked;
        return { root };
      },
      registerMcp: () => ({}),
      assertMainFrameSender() {},
    },
    state,
    { snapshot: async () => {} }
  );
  const sample = handlers['vault:createSample']({});
  await openStarted;
  const writing = handlers['fs:write']({}, 'Sample.md', 'saved');
  releaseOpen();
  await sampleStarted;
  assert.equal(fssync.existsSync(path.join(first, 'Sample.md')), false);
  releaseSample();
  await Promise.all([sample, writing]);
  assert.equal(await fs.readFile(path.join(first, 'Sample.md'), 'utf8'), 'saved');
  assert.equal(await fs.readFile(path.join(first, 'Other.md'), 'utf8'), 'other');
});

test('sample initialization preserves files created concurrently and propagates other errors', async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-sample-exclusive-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'Tagline Sample Vault');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'Existing.md'), 'existing');
  const state = {};
  const handlers = {};
  let fail = false;
  registerVaultIpc(
    {
      app: {},
      ipcMain: { handle: (name, handler) => (handlers[name] = handler) },
      dialog: { showOpenDialog: async () => ({ filePaths: [parent] }) },
      path,
      fs: {
        ...fs,
        writeFile: async (file, ...args) => {
          if (file === path.join(root, 'Raced.md')) {
            if (fail) {
              throw Object.assign(new Error('write failed'), { code: 'EIO' });
            }
            await fs.writeFile(file, 'concurrent', { flag: 'wx' });
          }
          return fs.writeFile(file, ...args);
        },
      },
      fssync,
      SAMPLE_VAULT: { 'Existing.md': 'sample', 'Raced.md': 'sample', 'New.md': 'new' },
      resolveInVault: (rel, vaultRoot = state.vaultRoot) => path.join(vaultRoot, rel),
      openVault: async (vaultRoot) => {
        state.vaultRoot = vaultRoot;
        return { root: vaultRoot };
      },
      registerMcp: () => ({}),
      assertMainFrameSender() {},
    },
    state,
    {}
  );
  await handlers['vault:createSample']({});
  assert.equal(await fs.readFile(path.join(root, 'Existing.md'), 'utf8'), 'existing');
  assert.equal(await fs.readFile(path.join(root, 'Raced.md'), 'utf8'), 'concurrent');
  assert.equal(await fs.readFile(path.join(root, 'New.md'), 'utf8'), 'new');
  fail = true;
  await assert.rejects(handlers['vault:createSample']({}), { code: 'EIO' });
});

test('sample initialization rejects a vault switch while opening', async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-sample-switch-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const first = path.join(parent, 'Tagline Sample Vault');
  const second = path.join(parent, 'second');
  await Promise.all([fs.mkdir(first), fs.mkdir(second)]);
  const state = { vaultRoot: second };
  const handlers = {};
  let release;
  const blocked = new Promise((resolve) => (release = resolve));
  let opened;
  const waiting = new Promise((resolve) => (opened = resolve));
  registerVaultIpc(
    {
      app: {},
      ipcMain: { handle: (name, handler) => (handlers[name] = handler) },
      dialog: { showOpenDialog: async () => ({ filePaths: [parent] }) },
      path,
      fs,
      fssync,
      SAMPLE_VAULT: { 'Sample.md': 'sample' },
      resolveInVault: (rel, root = state.vaultRoot) => path.join(root, rel),
      openVault: async (root) => {
        state.vaultRoot = root;
        opened();
        await blocked;
        return { root };
      },
      registerMcp: () => ({}),
      assertMainFrameSender() {},
    },
    state,
    {}
  );
  const sample = handlers['vault:createSample']({});
  await waiting;
  state.vaultRoot = second;
  release();
  await assert.rejects(sample, /vault changed/i);
  await assert.rejects(fs.stat(path.join(second, 'Sample.md')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(first, 'Sample.md')), { code: 'ENOENT' });
});

test('sample initialization remains in its original vault after population starts', async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-sample-populate-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const first = path.join(parent, 'Tagline Sample Vault');
  const second = path.join(parent, 'second');
  await Promise.all([fs.mkdir(first), fs.mkdir(second)]);
  const state = { vaultRoot: second };
  const handlers = {};
  let release;
  const blocked = new Promise((resolve) => (release = resolve));
  let started;
  const waiting = new Promise((resolve) => (started = resolve));
  registerVaultIpc(
    {
      app: {},
      ipcMain: { handle: (name, handler) => (handlers[name] = handler) },
      dialog: { showOpenDialog: async () => ({ filePaths: [parent] }) },
      path,
      fs: {
        ...fs,
        writeFile: async (file, ...args) => {
          if (file === path.join(first, 'Sample.md')) {
            started();
            await blocked;
          }
          return fs.writeFile(file, ...args);
        },
      },
      fssync,
      SAMPLE_VAULT: { 'Sample.md': 'sample', 'Other.md': 'other' },
      resolveInVault: (rel, root = state.vaultRoot) => path.join(root, rel),
      openVault: async (root) => {
        state.vaultRoot = root;
        return { root };
      },
      registerMcp: () => ({}),
      assertMainFrameSender() {},
    },
    state,
    {}
  );
  const sample = handlers['vault:createSample']({});
  await waiting;
  state.vaultRoot = second;
  release();
  await sample;
  assert.equal(await fs.readFile(path.join(first, 'Other.md'), 'utf8'), 'other');
  await assert.rejects(fs.stat(path.join(second, 'Other.md')), { code: 'ENOENT' });
});
