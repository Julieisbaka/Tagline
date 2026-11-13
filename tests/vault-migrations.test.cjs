const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fssync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const {
  migrations,
  migrationPlan,
  readManifest,
  migrateVault,
  prepareVault,
  recoverMigration,
  journalPath,
} = require('../electron/vaultMigrations.cjs');
const { createVault } = require('../electron/main/vault.cjs');
const { registerVaultIpc } = require('../electron/main/ipcVault.cjs');

async function fixture(t) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-migrations-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'Vault');
  await fs.mkdir(root);
  return { root, parent };
}

async function seed(root, version) {
  await fs.writeFile(path.join(root, 'Note.md'), '# Original\n');
  await fs.writeFile(path.join(root, 'Round.flow'), '{"version":1,"sheets":[]}');
  await fs.writeFile(path.join(root, 'Image.bin'), Buffer.from([0, 255, 17]));
  await fs.mkdir(path.join(root, '.tagline', 'history'), { recursive: true });
  await fs.writeFile(path.join(root, '.tagline', 'history', 'revision'), 'history');
  if (version !== undefined) {
    await fs.writeFile(
      path.join(root, '.tagline', 'vault.json'),
      JSON.stringify({ version, custom: 'preserve' })
    );
  }
}

function step(version, up = async () => {}, validate = async () => {}) {
  return {
    version,
    title: `Upgrade ${version}`,
    description: `Data change ${version}`,
    up,
    validate,
  };
}

test('registry covers consecutive versions and refuses invalid or future versions', () => {
  assert.equal(migrationPlan(0).length, migrations.length);
  assert.deepEqual(migrationPlan(migrations.length), []);
  assert.throws(() => migrationPlan(migrations.length + 1), /newer format/);
  assert.throws(() => migrationPlan(-1), /Invalid/);
  assert.throws(() => migrationPlan(0, [step(2)]), /consecutive/);
  assert.throws(() => migrationPlan(0, [{ version: 1, up() {} }]), /validation/);
});

test('wizard cancellation leaves every file untouched and creates no backup', async (t) => {
  const { root, parent } = await fixture(t);
  await seed(root);
  let prompt;
  assert.equal(
    await prepareVault(root, {
      showMessageBox: async (options) => {
        prompt = options;
        return { response: 1 };
      },
    }),
    false
  );
  assert.equal(prompt.cancelId, 1);
  assert.match(prompt.detail, /Enable vault format tracking/);
  assert.equal((await readManifest(root)).version, 0);
  assert.deepEqual(await fs.readdir(parent), ['Vault']);
  assert.equal(await fs.readFile(path.join(root, 'Note.md'), 'utf8'), '# Original\n');
});

test('wizard backs up the whole vault, including binary data and hidden history; current vault does not prompt again', async (t) => {
  const { root } = await fixture(t);
  await seed(root);
  const prompts = [];
  await prepareVault(root, {
    showMessageBox: async (options) => {
      prompts.push(options);
      return { response: 0 };
    },
  });
  assert.equal(prompts.length, 2);
  const backup = prompts[1].detail.match(/Original backup: (.+)\n/)[1];
  for (const file of ['Note.md', 'Round.flow', 'Image.bin', '.tagline/history/revision']) {
    assert.deepEqual(
      await fs.readFile(path.join(root, file)),
      await fs.readFile(path.join(backup, file))
    );
  }
  assert.equal((await readManifest(root)).version, migrations.length);
  assert.equal((await readManifest(backup)).version, 0);
  assert.equal(
    await prepareVault(root, { showMessageBox: () => assert.fail('Unexpected prompt') }),
    true
  );
});

test('empty new vault is initialized without an upgrade prompt', async (t) => {
  const { root, parent } = await fixture(t);
  await prepareVault(root);
  assert.equal((await readManifest(root)).version, migrations.length);
  assert.deepEqual(await fs.readdir(parent), ['Vault']);
});

test('all missing upgrades run in order, supporting edits, additions, deletion, and rename', async (t) => {
  const { root } = await fixture(t);
  await seed(root, 1);
  const order = [];
  const steps = [
    step(1, () => assert.fail('Already applied')),
    step(2, async (stage) => {
      order.push(2);
      await fs.rename(path.join(stage, 'Note.md'), path.join(stage, 'Renamed.md'));
      await fs.unlink(path.join(stage, 'Round.flow'));
      await fs.writeFile(path.join(stage, 'New.canvas'), '{"nodes":[]}');
    }),
    step(
      3,
      async (stage) => {
        order.push(3);
        await fs.appendFile(path.join(stage, 'Renamed.md'), 'Upgraded\n');
      },
      async (stage) => {
        assert.equal(
          await fs.readFile(path.join(stage, 'Renamed.md'), 'utf8'),
          '# Original\nUpgraded\n'
        );
      }
    ),
  ];
  const { backup } = await migrateVault(root, steps);
  assert.deepEqual(order, [2, 3]);
  assert.equal((await readManifest(root)).version, 3);
  assert.equal((await readManifest(root)).custom, 'preserve');
  assert.equal((await readManifest(backup)).version, 1);
  assert.equal(await fs.readFile(path.join(backup, 'Note.md'), 'utf8'), '# Original\n');
  await assert.rejects(fs.stat(path.join(root, 'Note.md')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(root, 'Round.flow')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(root, 'New.canvas'), 'utf8'), '{"nodes":[]}');
});

test('migration can evolve manifest metadata without losing unknown fields', async (t) => {
  const { root } = await fixture(t);
  await seed(root, 1);
  await migrateVault(root, [
    step(1),
    step(2, async (stage) => {
      const manifest = await readManifest(stage);
      await fs.writeFile(
        path.join(stage, '.tagline', 'vault.json'),
        JSON.stringify({ ...manifest, added: true })
      );
    }),
  ]);
  assert.deepEqual(await readManifest(root), { version: 2, custom: 'preserve', added: true });
});

test('copy failures preserve original data and leave no partial upgrade', async (t) => {
  const { root, parent } = await fixture(t);
  await seed(root);
  t.mock.method(fs, 'cp', async (_source, stage) => {
    await fs.mkdir(stage);
    await fs.writeFile(path.join(stage, 'partial'), 'partial copy');
    throw new Error('disk full');
  });
  await assert.rejects(migrateVault(root), /original data is unchanged.*disk full/);
  assert.equal((await readManifest(root)).version, 0);
  assert.equal(await fs.readFile(path.join(root, 'Note.md'), 'utf8'), '# Original\n');
  assert.deepEqual(await fs.readdir(parent), ['Vault']);
});

test('manifest write failure cannot commit partially upgraded documents', async (t) => {
  const { root } = await fixture(t);
  await seed(root);
  const writeFile = fs.writeFile;
  t.mock.method(fs, 'writeFile', async (file, ...args) => {
    if (file.includes('.tagline-stage-') && file.endsWith('vault.json')) {
      throw new Error('metadata write denied');
    }
    return writeFile(file, ...args);
  });
  await assert.rejects(migrateVault(root), /original data is unchanged.*metadata write denied/);
  assert.equal((await readManifest(root)).version, 0);
});

test('failed automatic rollback retains backup and journal for recovery on next open', async (t) => {
  const { root, parent } = await fixture(t);
  await seed(root);
  const originalRename = fs.rename;
  const rename = t.mock.method(fs, 'rename', async (source, destination) => {
    if (destination === root) {
      throw new Error('directory locked');
    }
    return originalRename(source, destination);
  });
  await assert.rejects(migrateVault(root), /Automatic recovery failed.*Original vault is at/);
  await assert.rejects(fs.stat(root), { code: 'ENOENT' });
  const backup = (await fs.readdir(parent)).find((name) => name.includes('.tagline-backup-'));
  assert.equal(await fs.readFile(path.join(parent, backup, 'Note.md'), 'utf8'), '# Original\n');
  rename.mock.restore();
  await recoverMigration(root);
  assert.equal(await fs.readFile(path.join(root, 'Note.md'), 'utf8'), '# Original\n');
});

for (const failure of ['upgrade', 'validation']) {
  test(`${failure} failure after an earlier step preserves original data and version`, async (t) => {
    const { root, parent } = await fixture(t);
    await seed(root, 1);
    const fail = async () => {
      throw new Error('injected failure');
    };
    const steps = [
      step(1),
      step(2, async (stage) => {
        await fs.writeFile(path.join(stage, 'Note.md'), 'changed');
      }),
      step(
        3,
        failure === 'upgrade' ? fail : undefined,
        failure === 'validation' ? fail : undefined
      ),
    ];
    await assert.rejects(migrateVault(root, steps), /original data is unchanged.*injected failure/);
    assert.equal((await readManifest(root)).version, 1);
    assert.equal(await fs.readFile(path.join(root, 'Note.md'), 'utf8'), '# Original\n');
    assert.deepEqual(await fs.readdir(parent), ['Vault']);
  });
}

test('commit failure restores the original directory', async (t) => {
  const { root } = await fixture(t);
  await seed(root);
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (source, destination) => {
    if (source.includes('.tagline-stage-') && destination === root) {
      throw new Error('rename denied');
    }
    return rename(source, destination);
  });
  await assert.rejects(migrateVault(root), /original data is unchanged.*rename denied/);
  assert.equal((await readManifest(root)).version, 0);
  assert.equal(await fs.readFile(path.join(root, 'Note.md'), 'utf8'), '# Original\n');
});

test('interrupted directory swap is recovered before opening', async (t) => {
  const { root } = await fixture(t);
  await seed(root);
  const id = randomUUID();
  await fs.writeFile(journalPath(root), JSON.stringify({ id }));
  await fs.rename(root, `${root}.tagline-backup-${id}`);
  await prepareVault(root, { showMessageBox: async () => ({ response: 1 }) });
  assert.equal(await fs.readFile(path.join(root, 'Note.md'), 'utf8'), '# Original\n');
  await assert.rejects(fs.stat(journalPath(root)), { code: 'ENOENT' });
});

test('recovery after a completed swap retains both upgraded vault and backup', async (t) => {
  const { root } = await fixture(t);
  await seed(root);
  const { backup } = await migrateVault(root);
  const id = backup.slice(`${root}.tagline-backup-`.length);
  await fs.writeFile(journalPath(root), JSON.stringify({ id }));
  await recoverMigration(root);
  assert.equal((await readManifest(root)).version, migrations.length);
  assert.equal((await readManifest(backup)).version, 0);
});

test('future and corrupt manifests never prompt or change vault data', async (t) => {
  const { root } = await fixture(t);
  await seed(root, 99);
  const options = { showMessageBox: () => assert.fail('Unexpected prompt') };
  await assert.rejects(prepareVault(root, options), /newer format/);
  for (const text of ['{"version":"1"}', 'null', '{broken']) {
    await fs.writeFile(path.join(root, '.tagline', 'vault.json'), text);
    await assert.rejects(prepareVault(root, options));
    assert.equal(await fs.readFile(path.join(root, '.tagline', 'vault.json'), 'utf8'), text);
  }
});

test('linked directories cannot redirect migrations outside the vault', async (t) => {
  const { root, parent } = await fixture(t);
  const outside = path.join(parent, 'Outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'secret'), 'untouched');
  await fs.symlink(
    outside,
    path.join(root, 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  await assert.rejects(migrateVault(root), /regular file/);
  assert.equal(await fs.readFile(path.join(outside, 'secret'), 'utf8'), 'untouched');
});

test('invalid recovery paths are refused', async (t) => {
  const { root } = await fixture(t);
  await fs.writeFile(journalPath(root), JSON.stringify({ id: '../other' }));
  await assert.rejects(recoverMigration(root), /Invalid migration recovery record/);
});

test('overlapping opens cannot launch two migrations', async (t) => {
  const { root } = await fixture(t);
  await seed(root);
  let release;
  let entered;
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  const opening = prepareVault(root, {
    showMessageBox: () => {
      entered();
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  await waiting;
  await assert.rejects(prepareVault(root), /already in progress/);
  release({ response: 1 });
  assert.equal(await opening, false);
});

test('cancelled open preserves the active vault and saved recent vaults', async (t) => {
  const { root, parent } = await fixture(t);
  await seed(root);
  const profile = path.join(parent, 'Profile');
  await fs.mkdir(profile);
  const config = { lastVault: 'previous', recentVaults: ['previous'] };
  await fs.writeFile(path.join(profile, 'config.json'), JSON.stringify(config));
  const state = { vaultRoot: 'previous' };
  const vault = createVault(
    {
      app: { getPath: () => profile },
      path,
      fs,
      fssync,
      randomUUID,
      process,
      dialog: { showMessageBox: async () => ({ response: 1 }) },
    },
    state
  );
  assert.equal(await vault.openVault(root), null);
  assert.equal(state.vaultRoot, 'previous');
  assert.deepEqual(vault.readConfig(), config);
});

test('active vault changes only after the migration wizard completes', async (t) => {
  const { root, parent } = await fixture(t);
  await seed(root);
  const profile = path.join(parent, 'Profile');
  await fs.mkdir(profile);
  const state = { vaultRoot: 'previous', win: {} };
  await fs.writeFile(path.join(profile, 'config.json'), '{}');
  let dialogs = 0;
  const vault = createVault(
    {
      app: { getPath: () => profile },
      path,
      fs,
      fssync,
      randomUUID,
      process,
      dialog: {
        showMessageBox: async (window, options) => {
          assert.equal(window, state.win);
          assert.equal(state.vaultRoot, 'previous');
          dialogs++;
          if (options.type === 'info') {
            assert.equal((await readManifest(root)).version, migrations.length);
          }
          return { response: 0 };
        },
      },
    },
    state
  );
  const info = await vault.openVault(root);
  assert.equal(dialogs, 2);
  assert.equal(info.root, root);
  assert.equal(state.vaultRoot, root);
  assert.equal(vault.readConfig().lastVault, root);
});

test('startup and recent vaults can recover a missing root; cancelling sample creation never writes files', async (t) => {
  const { root, parent } = await fixture(t);
  await seed(root);
  const profile = path.join(parent, 'Profile');
  await fs.mkdir(profile);
  const state = { vaultRoot: 'previous' };
  await fs.writeFile(path.join(profile, 'config.json'), '{}');
  const dialog = {
    showMessageBox: async () => ({ response: 1 }),
    showOpenDialog: async () => ({ canceled: false, filePaths: [parent] }),
  };
  const vault = createVault(
    { app: { getPath: () => profile }, path, fs, fssync, randomUUID, process, dialog },
    state
  );
  vault.writeConfig({ lastVault: root, recentVaults: [root] });
  const id = randomUUID();
  await fs.writeFile(journalPath(root), JSON.stringify({ id }));
  await fs.rename(root, `${root}.tagline-backup-${id}`);
  assert.equal((await vault.listRecentVaults())[0].exists, true);
  const handlers = {};
  registerVaultIpc(
    {
      ipcMain: {
        handle: (name, handler) => {
          handlers[name] = handler;
        },
      },
      path,
      fs,
      fssync,
      process,
      dialog,
      ...vault,
      SAMPLE_VAULT: { 'Sample.md': 'sample' },
      registerMcp: () => ({}),
      assertMainFrameSender() {},
    },
    state,
    {}
  );
  assert.equal(await handlers['vault:getLast']({}), null);
  assert.equal(await fs.readFile(path.join(root, 'Note.md'), 'utf8'), '# Original\n');
  assert.equal(await handlers['vault:openRecent']({}, root), null);
  const sample = path.join(parent, 'Tagline Sample Vault');
  await fs.mkdir(sample);
  await seed(sample);
  assert.equal(await handlers['vault:createSample']({}), null);
  await assert.rejects(fs.stat(path.join(sample, 'Sample.md')), { code: 'ENOENT' });
  assert.equal(state.vaultRoot, 'previous');
});
