const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseTaglineUri, uriArguments, noteUri } = require('../electron/uri.cjs');
const { registerExtensions } = require('../electron/extensions.cjs');

test('tagline:// links open vault notes and reject unsafe targets', () => {
  assert.deepEqual(parseTaglineUri('tagline://note/Cases/Round%201.md#Plan%20A'), {
    action: 'open',
    path: 'Cases/Round 1.md',
    heading: 'Plan A',
  });
  assert.equal(noteUri('Cases/Round 1.md', 'Plan A'), 'tagline://note/Cases/Round%201.md#Plan%20A');
  for (const bad of [
    'tagline://note/a%2F..%2Fb.md',
    'tagline://note/.hidden/a.md',
    'tagline://note/C:/Windows/x.md',
    'tagline://note/a%5Cb.md',
    'tagline://note/',
    'tagline://settings/x',
    'https://note/a.md',
    'tagline://user@note/a.md',
    'not a url',
  ]) {
    assert.equal(parseTaglineUri(bad), null, bad);
  }
  assert.deepEqual(uriArguments(['app', '--x', 'TAGLINE://note/a.md', 'file.flow']), [
    'TAGLINE://note/a.md',
  ]);
});

test('platform: extension secrets are encrypted, permission-gated and per extension', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-secrets-'));
  try {
    const folder = path.join(root, 'extensions', 'vault-key');
    await fs.mkdir(folder, { recursive: true });
    const write = (permissions) =>
      fs.writeFile(
        path.join(folder, 'manifest.json'),
        JSON.stringify({
          manifestVersion: 1,
          id: 'vault-key',
          name: 'Vault key',
          version: '1.0.0',
          main: 'main.js',
          permissions,
        })
      );
    await fs.writeFile(path.join(folder, 'main.js'), 'void 0;');
    await write(['secrets']);
    let config = {};
    const handlers = {};
    const safeStorage = {
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async (text) => Buffer.from(`enc:${Buffer.from(text).toString('hex')}`),
      decryptStringAsync: async (buffer) => ({
        result: Buffer.from(buffer.toString().slice(4), 'hex').toString(),
      }),
    };
    registerExtensions({
      app: { getPath: () => root },
      shell: {},
      ipcMain: { handle: (name, handler) => (handlers[name] = handler) },
      readConfig: () => config,
      writeConfig: (patch) => (config = { ...config, ...patch }),
      dialog: {},
      getWindow: () => null,
      safeStorage,
    });
    const call = (...args) => handlers['extensions:secret'](null, 'vault-key', ...args);
    await assert.rejects(call('get', 'token'), /no longer enabled/);

    const [item] = await handlers['extensions:list']();
    assert.ok(item.reviewToken);
    await handlers['extensions:setEnabled'](null, 'vault-key', true, item.reviewToken);

    assert.equal(await call('get', 'token'), null);
    await call('set', 'token', 'hunter2');
    assert.equal(await call('get', 'token'), 'hunter2');
    assert.equal(await call('has', 'token'), true);
    const stored = await fs.readFile(path.join(root, 'extension-secrets', 'vault-key.bin'));
    assert.ok(!stored.toString().includes('hunter2'));
    await assert.rejects(call('set', 'token', 42), /strings/);
    await assert.rejects(call('set', 'x'.repeat(201), 'v'), /Key must be/);
    await call('set', 'token', null);
    assert.equal(await call('has', 'token'), false);
    await assert.rejects(fs.access(path.join(root, 'extension-secrets', 'vault-key.bin')));

    await call('set', 'token', 'again');
    await handlers['extensions:clearSecrets'](null, 'vault-key');
    assert.equal(await call('get', 'token'), null);

    const [enabledItem] = await handlers['extensions:list']();
    await handlers['extensions:setPermissions'](
      null,
      'vault-key',
      [],
      enabledItem.reviewToken
    );
    await assert.rejects(call('get', 'token'), /Secrets permission is required/);
    await handlers['extensions:setPermissions'](
      null,
      'vault-key',
      ['secrets'],
      enabledItem.reviewToken
    );

    await write([]);
    await assert.rejects(call('get', 'token'), /no longer enabled|Secrets permission/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
