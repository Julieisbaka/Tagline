const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { registerVaultIpc } = require('../electron/main/ipcVault.cjs');
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

test('pins writes retry EBUSY rename without deleting the temp file', async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-pins-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const full = path.join(parent, '.tagline', 'pins.json');
  const handlers = {};
  let renameAttempts = 0;
  let tempSurvived = false;
  registerVaultIpc(
    {
      ipcMain: { handle: (name, handler) => (handlers[name] = handler) },
      path,
      fs: {
        ...fs,
        rename: async (source, target) => {
          renameAttempts++;
          if (renameAttempts === 1) {
            await fs.stat(source);
            throw Object.assign(new Error('locked'), { code: 'EBUSY' });
          }
          tempSurvived = await fs.stat(source).then(
            () => true,
            () => false
          );
          return fs.rename(source, target);
        },
      },
      randomUUID,
      resolveInVault: () => full,
      registerMcp: () => ({}),
      assertMainFrameSender() {},
    },
    {},
    {}
  );

  const value = { favorites: ['A.md'], pinnedTabs: [] };
  await handlers['vault:writePins']({}, value);

  assert.equal(renameAttempts, 2);
  assert.equal(tempSurvived, true, 'temp file must remain for the retry rename');
  assert.deepEqual(parsePins(await fs.readFile(full, 'utf8')), value);
});

test('pins operations keep their vault path and reads wait for queued writes', async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-pins-race-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const firstRoot = path.join(parent, 'first');
  const secondRoot = path.join(parent, 'second');
  let currentRoot = firstRoot;
  const handlers = {};
  let firstWriteStarted;
  const started = new Promise((resolve) => {
    firstWriteStarted = resolve;
  });
  let releaseWrite;
  const release = new Promise((resolve) => {
    releaseWrite = resolve;
  });
  let writes = 0;
  registerVaultIpc(
    {
      ipcMain: { handle: (name, handler) => (handlers[name] = handler) },
      path,
      fs: {
        ...fs,
        writeFile: async (...args) => {
          writes++;
          if (writes === 1) {
            firstWriteStarted();
            await release;
          }
          return fs.writeFile(...args);
        },
      },
      randomUUID,
      resolveInVault: (relative) => path.join(currentRoot, relative),
      registerMcp: () => ({}),
      assertMainFrameSender() {},
    },
    {},
    {}
  );

  const value = { favorites: ['First.md'], pinnedTabs: [] };
  const writing = handlers['vault:writePins']({}, value);
  await started;
  const reading = handlers['vault:readPins']({});
  currentRoot = secondRoot;
  releaseWrite();

  await writing;
  assert.deepEqual(await reading, value);
  assert.deepEqual(
    parsePins(await fs.readFile(path.join(firstRoot, '.tagline', 'pins.json'), 'utf8')),
    value
  );
  await assert.rejects(fs.stat(path.join(secondRoot, '.tagline', 'pins.json')), { code: 'ENOENT' });
});
