const { test } = require('node:test');
const assert = require('node:assert/strict');

test('platform settings provide complete localized instructions', () => {
  for (const target of ['win32', 'darwin', 'linux']) {
    const copy = require(`../src/platform/${target}.json`);
    assert.deepEqual(Object.keys(copy).sort(), ['en', 'es', 'fr']);
    for (const language of Object.values(copy)) {
      assert.deepEqual(Object.keys(language).sort(), Object.keys(copy.en).sort());
      for (const [key, value] of Object.entries(language)) {
        assert.equal(typeof value, 'string');
        assert.equal(
          Boolean(value.trim()),
          !(key.startsWith('manualUninstall') && target === 'win32')
        );
      }
    }
  }
});
