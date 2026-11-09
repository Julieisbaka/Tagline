const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const Ajv = require('ajv');
const {
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  validateNetworkHosts,
  validateNetworkRequest,
  requestExtensionNetwork,
  downloadExtensionNetwork,
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
    ['https://api.example.com/', { method: 'TRACE' }],
    ['https://api.example.com/', { method: 'GET', body: 'data' }],
    ['https://api.example.com/', { method: 'HEAD', body: 'data' }],
    ['https://api.example.com/', { timeoutMs: 15001 }],
    ['https://api.example.com/', { timeoutMs: 0 }],
    ['https://api.example.com/', { responseType: 'binary' }],
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
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
    assert.equal(validateNetworkRequest(['api.example.com'], 'https://api.example.com', { method }).method, method);
  }
  assert.equal(validateNetworkRequest(['api.example.com'], 'https://api.example.com', { method: 'delete', body: 'x', timeoutMs: 20000 }, 30000).body, 'x');
});

test('network requests use the public DNS guard and return bounded response data', async () => {
  const originalRequest = https.request;
  let captured;
  let responseBody = '{"ready":true}';
  let contentLength;
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
          ...(contentLength && { 'content-length': contentLength }),
        },
      });
      onResponse(response);
      process.nextTick(() => {
        if (options.method !== 'HEAD') {
          response.emit('data', Buffer.from(responseBody));
        }
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
    assert.deepEqual((await requestExtensionNetwork(['api.example.com'], 'https://api.example.com', { responseType: 'json' })).body, { ready: true });
    assert.equal((await requestExtensionNetwork(['api.example.com'], 'https://api.example.com', { responseType: 'base64' })).body, Buffer.from('{"ready":true}').toString('base64'));
    responseBody = 'not JSON';
    await assert.rejects(requestExtensionNetwork(['api.example.com'], 'https://api.example.com', { responseType: 'json' }), /not valid JSON/);
    contentLength = String(MAX_RESPONSE_BYTES + 1);
    assert.equal((await requestExtensionNetwork(['api.example.com'], 'https://api.example.com', { method: 'HEAD' })).body, '');
  } finally {
    https.request = originalRequest;
  }
});

test('fetchToFile streams binary data to a new vault path with authorization and bounds', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-download-'));
  const vault = path.join(root, 'vault');
  const extension = path.join(root, 'extensions', manifest.id);
  await fs.mkdir(extension, { recursive: true });
  await fs.mkdir(path.join(vault, 'Files'), { recursive: true });
  const downloadable = { ...manifest, permissions: ['network', 'vault:write'] };
  await fs.writeFile(path.join(extension, 'manifest.json'), JSON.stringify(downloadable));
  await fs.writeFile(path.join(extension, 'main.js'), 'void 0;');
  const handlers = {};
  let config = { enabledExtensions: [manifest.id], customizationLimits: { networkDownloadBytes: 1000 } };
  let currentVault = vault;
  registerExtensions({
    app: { getPath: () => root }, ipcMain: { handle: (name, handler) => { handlers[name] = handler; } },
    shell: {}, readConfig: () => config, writeConfig: (patch) => { config = { ...config, ...patch }; },
    dialog: {}, getWindow: () => null, getVaultRoot: () => currentVault,
  });
  const [unreviewed] = await handlers['extensions:list']();
  await handlers['extensions:setEnabled'](null, manifest.id, true, unreviewed.reviewToken);
  const original = https.request;
  t.after(async () => { https.request = original; await fs.rm(root, { recursive: true, force: true }); });
  let chunks = [Buffer.from([0, 255, 7])];
  let status = 200;
  let headers = {};
  let onRequest = () => {};
  https.request = (_url, requestOptions, respond) => {
    assert.equal(requestOptions.lookup, publicLookup);
    const outgoing = new EventEmitter();
    outgoing.write = () => {};
    outgoing.end = () => {
      onRequest();
      const response = Readable.from(chunks);
      Object.assign(response, { statusCode: status, statusMessage: 'OK', headers });
      respond(response);
      response.on('end', () => outgoing.emit('close'));
    };
    outgoing.destroy = (error) => { if (error) { process.nextTick(() => outgoing.emit('error', error)); } };
    return outgoing;
  };
  const download = (rel, options) => handlers['extensions:networkFetchToFile'](null, manifest.id, 'https://api.example.com/file', rel, options);
  const result = await download('Files/test.bin');
  assert.equal(result.path, 'Files/test.bin');
  assert.equal(result.bytes, 3);
  assert.deepEqual(await fs.readFile(path.join(vault, result.path)), chunks[0]);
  await assert.rejects(download('Files/test.bin'), /exist/i);
  assert.deepEqual(await fs.readFile(path.join(vault, result.path)), chunks[0]);
  for (const bad of ['../escape', '/absolute', 'Files/../../escape', 'Files\\escape', 'Files/con.txt']) {
    await assert.rejects(download(bad), /destination/i);
  }
  try {
    await fs.symlink(root, path.join(vault, 'linked'), 'junction');
    await assert.rejects(download('linked/escape.bin'), /without links/);
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      throw error;
    }
  }
  chunks = [Buffer.alloc(1001)];
  await assert.rejects(download('Files/oversized.bin'), /exceed 1000/);
  await assert.rejects(fs.stat(path.join(vault, 'Files/oversized.bin')), { code: 'ENOENT' });
  chunks = [Buffer.from('data')];
  headers = { 'content-length': '1001' };
  await assert.rejects(download('Files/declared.bin'), /exceed 1000/);
  headers = {};
  status = 302;
  await assert.rejects(download('Files/redirect.bin'), /HTTP 302/);
  status = 200;
  headers = { 'content-encoding': 'gzip' };
  await assert.rejects(download('Files/compressed.bin'), /Compressed/);
  headers = { 'content-encoding': 'gzip', 'content-length': '1001' };
  await assert.rejects(download('Files/compressed-head.bin', { method: 'HEAD' }), /Compressed/);
  headers = {};
  onRequest = () => { currentVault = root; };
  await assert.rejects(download('Files/switched.bin'), /vault changed/i);
  currentVault = vault;
  onRequest = () => { config.extensionPermissions = { [manifest.id]: ['network'] }; };
  await assert.rejects(download('Files/revoked.bin'), /Vault write permission/);
  config.extensionPermissions = { [manifest.id]: ['network', 'vault:write'] };
  onRequest = () => {};
  await assert.rejects(download('Files/type.bin', { responseType: 'base64' }), /responseType/);
  await handlers['extensions:setPermissions'](null, manifest.id, ['network'], unreviewed.reviewToken);
  await assert.rejects(download('Files/denied.bin'), /Vault write permission/);
  assert.deepEqual(await fs.readdir(path.join(root, 'extension-downloads', manifest.id)), []);
});

test('network timeouts abort both buffered and streamed requests', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-timeout-'));
  const original = https.request;
  t.after(async () => { https.request = original; await fs.rm(root, { recursive: true, force: true }); });
  let streaming = false;
  https.request = (_url, _options, respond) => {
    const outgoing = new EventEmitter();
    outgoing.end = () => {
      if (streaming) {
        const response = new Readable({ read() {} });
        Object.assign(response, { statusCode: 200, statusMessage: 'OK', headers: {} });
        respond(response);
      }
    };
    outgoing.destroy = (error) => { queueMicrotask(() => { outgoing.emit('error', error); outgoing.emit('close'); }); };
    return outgoing;
  };
  await assert.rejects(requestExtensionNetwork(['api.example.com'], 'https://api.example.com/', { timeoutMs: 20 }), /timed out/);
  streaming = true;
  const file = await fs.open(path.join(root, 'partial'), 'wx');
  try {
    await assert.rejects(downloadExtensionNetwork(['api.example.com'], 'https://api.example.com/', { timeoutMs: 20 }, 15000, 1000, file), /timed out/);
  } finally {
    await file.close();
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
      networkFetchToFile: (...args) => { calls.push(args); return { path: args[2], bytes: 3 }; },
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
  await assert.rejects(host.handle('network.fetchToFile', ['https://api.example.com/', 'file.bin']), /vault:write/);
  host.manifest.permissions = [...host.manifest.permissions, 'vault:write'];
  assert.deepEqual(await host.handle('network.fetchToFile', ['https://api.example.com/', 'file.bin', {}]), { path: 'file.bin', bytes: 3 });
  assert.deepEqual(calls[1], ['network-demo', 'https://api.example.com/', 'file.bin', {}]);
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
