const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');

const adapter = require.resolve('../electron/rustVaultProbe.cjs');

function loadWithDirectoryResult(t, result) {
  t.mock.method(fs, 'readdirSync', () => {
    if (result instanceof Error) {
      throw result;
    }
    return result;
  });
  delete require.cache[adapter];
  t.after(() => delete require.cache[adapter]);
  return require(adapter);
}

test('rust vault probe reports an unbuilt addon for a missing or empty dist directory', (t) => {
  for (const result of [Object.assign(new Error('missing'), { code: 'ENOENT' }), []]) {
    const { listNotePaths } = loadWithDirectoryResult(t, result);
    assert.throws(() => listNotePaths('.'), /Rust vault probe is not built/);
    t.mock.restoreAll();
  }
});

test('rust vault probe preserves other dist directory errors', (t) => {
  const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });
  const { listNotePaths } = loadWithDirectoryResult(t, error);
  assert.throws(() => listNotePaths('.'), (actual) => actual === error);
});

test('rust vault probe rejects multiple native addons', (t) => {
  const { listNotePaths } = loadWithDirectoryResult(t, ['probe.linux-x64-gnu.node', 'probe.win32-x64-msvc.node']);
  assert.throws(() => listNotePaths('.'), /Multiple Rust vault probe addons found/);
});

test('vault contract adapter rejects when the native addon is unavailable', async (t) => {
  const { listVault, readVaultSnapshot } = loadWithDirectoryResult(t, []);
  await assert.rejects(listVault('.'), /Rust vault probe is not built/);
  await assert.rejects(readVaultSnapshot('.'), /Rust vault probe is not built/);
});

test('all probe APIs normalize native filesystem errors', async (t) => {
  let encodedError = 'TAGLINE_VAULT_ERROR:ELOOP:0: symlink loop';
  const nativeError = () => Object.assign(new Error(encodedError), {
    code: 'GenericFailure',
  });
  const load = Module._load;
  t.mock.method(Module, '_load', function (request, ...args) {
    if (request.endsWith('probe.node')) {
      return {
        listNotePaths() { throw nativeError(); },
        async loadVault() { throw nativeError(); },
      };
    }
    return load.call(this, request, ...args);
  });
  const { listNotePaths, listVault, readVaultSnapshot } = loadWithDirectoryResult(t, ['probe.node']);
  const expected = { code: 'ELOOP', message: 'symlink loop' };
  assert.throws(() => listNotePaths('.'), expected);
  await assert.rejects(listVault('.'), expected);
  await assert.rejects(readVaultSnapshot('.'), expected);
  encodedError = 'TAGLINE_VAULT_ERROR:UNKNOWN:2147483647: unknown';
  assert.throws(() => listNotePaths('.'), { code: 'UNKNOWN', message: 'unknown' });
});
