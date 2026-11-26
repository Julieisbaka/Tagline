const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

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
