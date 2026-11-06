const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const Ajv = require('ajv');
const {
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  validateNetworkHosts,
  validateNetworkRequest,
  requestExtensionNetwork,
} = require('../electron/extensionNetwork.cjs');
const { registerExtensions, validateManifest } = require('../electron/extensions.cjs');
const { publicLookup } = require('../electron/citationMetadata.cjs');

const manifest = {
  manifestVersion: 1,
  id: 'network-demo',
  name: 'Network demo',
  version: '1',
  main: 'main.js',
  permissions: ['network'],
  networkHosts: ['api.example.com'],
  contributes: {},
};

test('network manifests and host allowlists validate exact public DNS hosts', () => {
  assert.deepEqual(validateNetworkHosts(['api.example.com']), ['api.example.com']);
  assert.deepEqual(validateManifest(manifest, process.cwd()).networkHosts, ['api.example.com']);
  for (const host of [
    'https://api.example.com',
    '*.example.com',
    '127.0.0.1',
    'localhost',
    'api.local',
    'API.example.com',
    'api.example.com:443',
  ]) {
    assert.throws(() => validateNetworkHosts([host]));
  }
  assert.throws(() => validateNetworkHosts(['api.example.com', 'api.example.com']), /unique/);
  assert.throws(
    () => validateManifest({ ...manifest, networkHosts: [] }, process.cwd()),
    /network requires/
  );
  assert.throws(
    () => validateManifest({ ...manifest, permissions: [] }, process.cwd()),
    /networkHosts requires/
  );

  const schema = JSON.parse(
    require('node:fs').readFileSync(
      path.join(__dirname, '..', 'schemas', 'extension-manifest.schema.json'),
      'utf8'
    )
  );
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  assert.equal(validate(manifest), true);
  assert.equal(validate({ ...manifest, networkHosts: [] }), false);
  assert.equal(validate({ ...manifest, networkHosts: ['*.example.com'] }), false);
});

test('network request validation bounds destinations, methods, headers and bodies', () => {
  const request = validateNetworkRequest(
    ['api.example.com'],
    'https://api.example.com/v1/debates?format=json#fragment',
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: '{}',
    }
  );
  assert.equal(request.url.href, 'https://api.example.com/v1/debates?format=json');
  assert.equal(request.method, 'POST');
  assert.equal(request.body, '{}');
  assert.equal(request.headers['Accept-Encoding'], 'identity');

  for (const [url, options] of [
    ['http://api.example.com/', {}],
    ['https://other.example.com/', {}],
    ['https://user:pass@api.example.com/', {}],
    ['https://api.example.com:8443/', {}],
    ['https://api.example.com/', { method: 'DELETE' }],
    ['https://api.example.com/', { method: 'GET', body: 'data' }],
    ['https://api.example.com/', { headers: { Cookie: 'session=secret' } }],
    ['https://api.example.com/', { headers: { 'X-Test': 'bad\r\nheader' } }],
    ['https://api.example.com/', { unexpected: true }],
  ]) {
    assert.throws(() => validateNetworkRequest(['api.example.com'], url, options));
  }
  assert.throws(
    () =>
      validateNetworkRequest(['api.example.com'], 'https://api.example.com/', {
        method: 'POST',
        body: 'x'.repeat(MAX_REQUEST_BYTES + 1),
      }),
    /may not exceed/
  );
  assert.equal(MAX_RESPONSE_BYTES, 1_000_000);
});

test('network requests use the public DNS guard and return bounded response data', async () => {
  const originalRequest = https.request;
  let captured;
  https.request = (url, options, onResponse) => {
    captured = { url: url.href, options };
    const outgoing = new EventEmitter();
    outgoing.write = (body) => {
      captured.body = body;
    };
    outgoing.end = () => {
      const response = new EventEmitter();
      Object.assign(response, {
        statusCode: 200,
        statusMessage: 'OK',
        headers: {
          'content-type': 'application/json',
          'set-cookie': ['not returned to extensions'],
        },
      });
      onResponse(response);
      process.nextTick(() => {
        response.emit('data', Buffer.from('{"ready":true}'));
        response.emit('end');
        outgoing.emit('close');
      });
    };
    outgoing.destroy = (error) => {
      if (error) {
        process.nextTick(() => outgoing.emit('error', error));
      }
    };
    return outgoing;
  };
  try {
    const response = await requestExtensionNetwork(
      ['api.example.com'],
      'https://api.example.com/v1',
      { method: 'POST', body: 'payload' }
    );
    assert.deepEqual(response, {
      status: 200,
      statusText: 'OK',
      ok: true,
      headers: { 'content-type': 'application/json' },
      body: '{"ready":true}',
    });
    assert.equal(captured.url, 'https://api.example.com/v1');
    assert.equal(captured.options.lookup, publicLookup);
    assert.equal(captured.body, 'payload');
  } finally {
    https.request = originalRequest;
  }
});

test('network API requires its permission and uses the host-mediated bridge', async () => {
  const { ExtensionHost } = await import('../src/lib/extensions.js');
  const calls = [];
  const host = new ExtensionHost(
    { ...manifest, contributes: { commands: [], panels: [], webviews: [] } },
    '',
    {
      networkFetch: (...args) => {
        calls.push(args);
        return { status: 200, ok: true, body: '{}' };
      },
    }
  );
  const result = await host.handle('network.fetch', ['https://api.example.com/v1', {}]);
  assert.deepEqual(result, { status: 200, ok: true, body: '{}' });
  assert.deepEqual(calls, [['network-demo', 'https://api.example.com/v1', {}]]);

  const denied = new ExtensionHost({ id: 'no-network', permissions: [] }, '', {});
  await assert.rejects(
    denied.handle('network.fetch', ['https://api.example.com/', {}]),
    /Permission/
  );
});

test('main process requires an enabled reviewed extension and enforces host changes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-network-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const folder = path.join(root, 'extensions', manifest.id);
  await fs.mkdir(folder, { recursive: true });
  const manifestPath = path.join(folder, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  await fs.writeFile(path.join(folder, 'main.js'), 'void 0;');
  const handlers = {};
  let config = { enabledExtensions: [manifest.id] };
  registerExtensions({
    app: { getPath: () => root },
    ipcMain: {
      handle: (name, handler) => {
        handlers[name] = handler;
      },
    },
    shell: {},
    readConfig: () => config,
    writeConfig: (patch) => {
      config = { ...config, ...patch };
    },
    dialog: {},
    getWindow: () => null,
  });

  const [unreviewed] = await handlers['extensions:list']();
  assert.equal(unreviewed.reviewRequired, true);
  await assert.rejects(
    handlers['extensions:networkFetch'](null, manifest.id, 'https://api.example.com/', {}),
    /no longer enabled/
  );
  await handlers['extensions:setEnabled'](null, manifest.id, true, unreviewed.reviewToken);
  await handlers['extensions:setPermissions'](null, manifest.id, [], unreviewed.reviewToken);
  await assert.rejects(
    handlers['extensions:networkFetch'](null, manifest.id, 'https://api.example.com/', {}),
    /Network permission is required/
  );
  await handlers['extensions:setPermissions'](
    null,
    manifest.id,
    ['network'],
    unreviewed.reviewToken
  );
  await assert.rejects(
    handlers['extensions:networkFetch'](null, manifest.id, 'https://other.example.com/', {}),
    /exact host declared/
  );

  await fs.writeFile(
    manifestPath,
    JSON.stringify({ ...manifest, networkHosts: ['other.example.com'] })
  );
  const [changed] = await handlers['extensions:list']();
  assert.equal(changed.reviewRequired, true);
  assert.equal(changed.enabled, false);
});
