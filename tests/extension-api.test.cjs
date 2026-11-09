const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateManifest,
  needsReview,
  reviewSignature,
} = require('../electron/extensions/manifest.cjs');

const manifestValue = (permissions = ['api']) => ({
  manifestVersion: 1,
  id: 'api-provider',
  name: 'API Provider',
  version: '1.0.0',
  main: 'main.js',
  permissions,
});

test('api permission is review-gated and changes the review signature', () => {
  const manifest = validateManifest(manifestValue(), __dirname);
  assert.equal(needsReview(manifest, {}), true);
  assert.equal(
    needsReview(manifest, { extensionReviews: { [manifest.id]: reviewSignature(manifest) } }),
    false
  );
  assert.notEqual(
    reviewSignature(manifest),
    reviewSignature(validateManifest(manifestValue([]), __dirname))
  );
});

test('extension API export, discovery, calls and JSON payload limits are enforced', async () => {
  const { ExtensionHost } = await import('../src/lib/extensions.js');
  const provider = new ExtensionHost(
    { id: 'api-provider', name: 'Provider', permissions: ['api'], contributes: {} },
    '',
    {}
  );
  const calls = [];
  const consumer = new ExtensionHost(
    { id: 'api-consumer', permissions: ['api'], contributes: {} },
    '',
    {
      getExtensionApi: (requester, id, version) => {
        assert.equal(requester, consumer);
        assert.equal(id, 'api-provider');
        return provider.getApiDescriptor(version);
      },
      callExtensionApi: (requester, ...args) => {
        calls.push([requester, ...args]);
        return Promise.resolve({ answer: 42 });
      },
    }
  );

  assert.equal(await provider.handle('extensions.export', [2, ['lookup']]), true);
  assert.deepEqual(await consumer.handle('extensions.getApi', ['api-provider']), {
    version: 2,
    methods: ['lookup'],
  });
  await assert.rejects(consumer.handle('extensions.getApi', ['api-provider', 1]), /version 1/);
  assert.deepEqual(
    await consumer.handle('extensions.call', ['api-provider', 2, 'lookup', { query: 'debate' }]),
    { answer: 42 }
  );
  assert.equal(calls[0][0], consumer);
  assert.deepEqual(calls[0].slice(1), ['api-provider', 2, 'lookup', { query: 'debate' }]);
  await assert.rejects(
    consumer.handle('extensions.call', ['api-provider', 2, 'lookup', 'x'.repeat(65537)]),
    /65,536 bytes/
  );
  await assert.rejects(provider.handle('extensions.export', [2, ['other']]), /Export one/);
  await assert.rejects(
    new ExtensionHost({ id: 'no-api', permissions: [] }, '', {}).handle('extensions.getApi', [
      'api-provider',
    ]),
    /Permission "api"/
  );
});

test('provider invokes only an exported method and returns validated JSON', async () => {
  const { ExtensionHost } = await import('../src/lib/extensions.js');
  const provider = new ExtensionHost(
    { id: 'api-provider', name: 'Provider', permissions: ['api'], contributes: {} },
    '',
    {}
  );
  const consumer = new ExtensionHost(
    { id: 'api-consumer', permissions: ['api'], contributes: {} },
    '',
    {}
  );
  provider.exportedApi = { version: 1, methods: ['lookup'] };
  provider.frame = { remove() {} };
  let response = null;
  provider.port = {
    postMessage({ id, method, payload }) {
      queueMicrotask(() =>
        provider.onMessage({
          data: { type: 'api-result', id, value: response ?? { method, payload } },
        })
      );
    },
    close() {},
  };
  assert.deepEqual(await provider.invokeApi(consumer, 1, 'lookup', { query: 'case' }), {
    method: 'lookup',
    payload: { query: 'case' },
  });
  await assert.rejects(provider.invokeApi(consumer, 1, 'deleteAll', null), /Unknown/);
  await assert.rejects(provider.invokeApi(consumer, 2, 'lookup', null), /version 2/);
  response = 'x'.repeat(65537);
  await assert.rejects(provider.invokeApi(consumer, 1, 'lookup', null), /65,536 bytes/);
  provider.dispose();
});
