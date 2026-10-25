const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createGoogleDocs, validateEndpoint, MAX_BYTES, DOCX } = require('../electron/googleDocs.cjs');

const ENDPOINT = 'https://script.google.com/macros/s/test-deployment/exec';
const SECRET = 'test-only-secret-'.repeat(3);
const DOCUMENT = { id: 'new-doc-id', title: 'Evidence', url: 'https://docs.google.com/document/d/new-doc-id/edit' };
const success = () => new Response(JSON.stringify({ ok: true, code: 201, message: 'Created', document: DOCUMENT }));

async function webhook(overrides = {}) {
  const calls = [];
  const properties = { WEBHOOK_SECRET: SECRET, ...overrides.properties };
  const context = vm.createContext({
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({
        text, mimeType: null,
        setMimeType(mimeType) { this.mimeType = mimeType; return this; },
      }),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties[key] || null }) },
    Utilities: {
      base64Decode: (text) => [...Buffer.from(text, 'base64')],
      newBlob: (bytes, mimeType, name) => ({ bytes, mimeType, name }),
    },
    Drive: overrides.noDrive ? undefined : {
      Files: {
        create: (...args) => {
          calls.push(args);
          if (overrides.error) throw overrides.error;
          return overrides.file === undefined ? { id: DOCUMENT.id } : overrides.file;
        },
      },
    },
  });
  vm.runInContext(await fs.readFile(path.join(__dirname, '..', 'electron', 'google-docs-webhook.gs'), 'utf8'), context);
  const payload = {
    secret: SECRET, title: 'Evidence', mimeType: 'text/html',
    contentBase64: Buffer.from('<h1>Evidence</h1><p>Unicode: \u00e9</p>').toString('base64'),
  };
  const post = (data = payload, type = 'application/json') => {
    const output = context.doPost({ postData: { type, contents: typeof data === 'string' ? data : JSON.stringify(data) } });
    assert.equal(output.mimeType, 'application/json');
    const reply = JSON.parse(output.text);
    assert.deepEqual(Object.keys(reply).sort(), ['code', 'document', 'message', 'ok']);
    assert.equal(Number.isInteger(reply.code), true);
    assert.equal(reply.ok, reply.code === 201);
    if (!reply.ok) assert.equal(reply.document, null);
    return reply;
  };
  return { context, calls, payload, post };
}

test('Apps Script converts HTML and DOCX directly into new Google Docs with stable JSON results', async () => {
  for (const mimeType of ['text/html', DOCX]) {
    const mock = await webhook({ properties: { TARGET_FOLDER_ID: 'destination-folder' } });
    const reply = mock.post({ ...mock.payload, mimeType });
    assert.equal(reply.code, 201);
    assert.deepEqual(reply.document, DOCUMENT);
    const [metadata, blob, options] = mock.calls[0];
    assert.equal(metadata.mimeType, 'application/vnd.google-apps.document');
    assert.equal(metadata.name, 'Evidence');
    assert.deepEqual([...metadata.parents], ['destination-folder']);
    assert.equal(blob.mimeType, mimeType);
    assert.equal(Buffer.from(blob.bytes).toString('utf8'), Buffer.from(mock.payload.contentBase64, 'base64').toString('utf8'));
    assert.equal(options.fields, 'id');
    assert.equal(options.supportsAllDrives, true);
  }
  const mock = await webhook();
  mock.post();
  assert.equal(mock.calls[0][0].parents, undefined);
  assert.equal(JSON.parse(mock.context.doGet().text).code, 405);
});

test('Apps Script rejects invalid requests with specific codes without creating files or exposing secrets', async () => {
  const mock = await webhook();
  const cases = [
    ['{', 400], [null, 400], [[], 400],
    [{ ...mock.payload, secret: 'wrong' }, 401],
    [{ ...mock.payload, secret: undefined }, 401],
    [{ ...mock.payload, title: '' }, 400],
    [{ ...mock.payload, title: 'x'.repeat(201) }, 400],
    [{ ...mock.payload, title: 'bad\nname' }, 400],
    [{ ...mock.payload, mimeType: 'application/pdf' }, 415],
    [{ ...mock.payload, mimeType: '__proto__' }, 415],
    [{ ...mock.payload, mimeType: ['text/html'] }, 415],
    [{ ...mock.payload, contentBase64: '' }, 422],
    [{ ...mock.payload, contentBase64: 'a===' }, 422],
    [{ ...mock.payload, contentBase64: '====' }, 422],
    [{ ...mock.payload, contentBase64: 'YW Jj' }, 422],
    [{ ...mock.payload, contentBase64: 'YWJj!' }, 422],
  ];
  for (const [payload, expected] of cases) {
    const reply = mock.post(payload);
    assert.equal(reply.code, expected);
    assert.ok(!JSON.stringify(reply).includes(SECRET));
  }
  assert.equal(mock.post(mock.payload, 'text/plain').code, 415);
  assert.equal(JSON.parse(mock.context.doPost().text).code, 400);
  assert.equal(mock.calls.length, 0);
});

test('Apps Script enforces the exact decoded upload limit, including padding', async () => {
  const mock = await webhook();
  const exact = Buffer.alloc(MAX_BYTES, 65).toString('base64');
  assert.equal(mock.post({ ...mock.payload, contentBase64: exact }).code, 201);
  const over = Buffer.alloc(MAX_BYTES + 1, 65).toString('base64');
  assert.equal(exact.length, over.length, 'One extra byte fits in the same encoded size');
  assert.equal(mock.post({ ...mock.payload, contentBase64: over }).code, 413);
  assert.equal(mock.post({ ...mock.payload, contentBase64: 'A'.repeat(exact.length + 4) }).code, 413);
  assert.equal(mock.post(' '.repeat(exact.length + 4097)).code, 413);
  assert.equal(mock.calls.length, 1);
});

test('Apps Script reports configuration and Drive failures without leaking internal errors', async () => {
  for (const options of [
    { properties: { WEBHOOK_SECRET: '' } },
    { properties: { WEBHOOK_SECRET: 'short' } },
    { properties: { TARGET_FOLDER_ID: 'https://drive.google.com/folders/private' } },
    { noDrive: true },
  ]) {
    const mock = await webhook(options);
    assert.equal(mock.post().code, 503);
    assert.equal(mock.calls.length, 0);
  }
  for (const options of [{ error: new Error(SECRET) }, { file: {} }]) {
    const mock = await webhook(options);
    const reply = mock.post();
    assert.equal(reply.code, 502);
    assert.ok(!JSON.stringify(reply).includes(SECRET));
  }
  const mock = await webhook();
  mock.context.PropertiesService.getScriptProperties = () => { throw new Error(SECRET); };
  const reply = mock.post();
  assert.equal(reply.code, 500);
  assert.ok(!JSON.stringify(reply).includes(SECRET));
});

async function client(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-google-docs-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const requests = [], confirmations = [], opened = [];
  const fakeEncryption = {
    isAsyncEncryptionAvailable: async () => options.encryption !== false,
    encryptStringAsync: async (value) => Buffer.from(`encrypted:${value}`),
    decryptStringAsync: async (value) => ({ result: value.toString().slice('encrypted:'.length) }),
  };
  const dependencies = {
    app: { getPath: () => root },
    safeStorage: fakeEncryption,
    getWindow: () => ({}),
    shell: { openExternal: async (url) => { opened.push(url); } },
    dialog: {
      showMessageBox: async (_win, settings) => { confirmations.push(settings); return { response: options.confirm ?? 1 }; },
      showOpenDialog: async () => ({ canceled: !options.file, filePaths: [options.file] }),
      showSaveDialog: async () => ({ canceled: !options.savePath, filePath: options.savePath }),
    },
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return options.response ? options.response(url, init) : success();
    },
  };
  const service = createGoogleDocs(dependencies);
  return { service, root, requests, confirmations, opened, dependencies };
}

test('Google Docs configuration is encrypted, persists, hides secrets, and can be removed', async (t) => {
  const mock = await client(t);
  assert.equal((await mock.service.status()).configured, false);
  await mock.service.save(ENDPOINT, SECRET);
  const status = await createGoogleDocs(mock.dependencies).status();
  assert.deepEqual(status, { endpoint: ENDPOINT, configured: true, encryptionAvailable: true });
  assert.ok(!JSON.stringify(status).includes(SECRET));
  const persisted = await fs.readFile(path.join(mock.root, 'google-docs.json'), 'utf8');
  assert.ok(!persisted.includes(SECRET));
  assert.ok(JSON.parse(persisted).encryptedSecret);
  await mock.service.save(ENDPOINT, '');
  await mock.service.disconnect();
  assert.equal((await mock.service.status()).configured, false);
  await assert.rejects(mock.service.save(ENDPOINT, ''), /Enter the WEBHOOK_SECRET/);
});

test('invalid endpoints, weak secrets, and unavailable OS encryption cannot save a connection', async (t) => {
  const mock = await client(t);
  for (const url of [
    'http://script.google.com/macros/s/id/exec', 'https://script.google.com.evil.test/macros/s/id/exec',
    'https://script.google.com/macros/s/id/dev', `${ENDPOINT}?secret=private`,
    'https://user:password@script.google.com/macros/s/id/exec', 'https://localhost/exec',
  ]) assert.throws(() => validateEndpoint(url), /URL/);
  await assert.rejects(mock.service.save(ENDPOINT, 'weak'), /32-256/);
  const unavailable = await client(t, { encryption: false });
  await assert.rejects(unavailable.service.save(ENDPOINT, SECRET), /encryption is unavailable/);
});

test('note uploads require confirmation and follow only the expected redirect without forwarding credentials', async (t) => {
  const mock = await client(t, {
    response: (_url, init) => init.method === 'POST'
      ? new Response(null, { status: 302, headers: { location: 'https://script.googleusercontent.com/macros/echo?user_content_key=test' } })
      : success(),
  });
  await mock.service.save(ENDPOINT, SECRET);
  assert.deepEqual(await mock.service.sendNote({ title: 'Evidence', html: '<p>Hello \u00e9</p>' }),
    { canceled: false, code: 201, document: DOCUMENT });
  assert.equal(mock.confirmations.length, 1);
  assert.match(mock.confirmations[0].detail, /creates a new Google Doc/);
  const [post, get] = mock.requests;
  assert.equal(post.url, ENDPOINT);
  assert.equal(post.init.redirect, 'manual');
  const payload = JSON.parse(post.init.body);
  assert.equal(payload.secret, SECRET);
  assert.equal(payload.mimeType, 'text/html');
  assert.equal(Buffer.from(payload.contentBase64, 'base64').toString('utf8'), '<p>Hello \u00e9</p>');
  assert.equal(get.init.method, 'GET');
  assert.equal(get.init.body, undefined);
  assert.equal(get.init.headers, undefined);
  assert.ok(!get.url.includes(SECRET));
});

test('canceling a transfer never uploads or creates documents', async (t) => {
  const mock = await client(t, { confirm: 0 });
  await mock.service.save(ENDPOINT, SECRET);
  assert.deepEqual(await mock.service.sendNote({ title: 'Evidence', html: 'document' }), { canceled: true });
  assert.equal(mock.requests.length, 0);
});

test('uploads reject external redirects, authentication pages, and malformed replies', async (t) => {
  for (const response of [
    () => new Response(null, { status: 302, headers: { location: 'https://attacker.test/collect' } }),
    () => new Response(null, { status: 307, headers: { location: 'https://script.googleusercontent.com/collect' } }),
    () => new Response('<html>Sign in</html>'),
    () => new Response('{"ok":true}'),
    () => new Response('{"ok":true,"code":200}'),
    () => new Response(JSON.stringify({ ok: true, code: 201, document: { ...DOCUMENT, url: 'https://attacker.test/' } })),
    () => new Response('{"ok":false,"code":401,"message":"private echoed text"}'),
    () => new Response('x'.repeat(65537)),
    () => { throw new Error(SECRET); },
  ]) {
    const mock = await client(t, { response });
    await mock.service.save(ENDPOINT, SECRET);
    await assert.rejects(mock.service.sendNote({ title: 'Evidence', html: 'document' }),
      (error) => !error.message.includes(SECRET) && !error.message.includes('private echoed text'));
    assert.equal(mock.requests.length, 1, 'No unsafe redirects or automatic retries');
  }
});

test('DOCX and HTML file uploads preserve bytes and share the result contract', async (t) => {
  for (const [extension, mimeType] of [['docx', DOCX], ['html', 'text/html']]) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-google-docs-file-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const file = path.join(dir, `Evidence.${extension}`);
    const bytes = Buffer.from(extension === 'docx' ? [80, 75, 3, 4, 0, 255] : '<p>HTML evidence</p>');
    await fs.writeFile(file, bytes);
    const mock = await client(t, { file });
    await mock.service.save(ENDPOINT, SECRET);
    assert.equal((await mock.service.uploadFile()).code, 201);
    const payload = JSON.parse(mock.requests[0].init.body);
    assert.equal(payload.mimeType, mimeType);
    assert.deepEqual(Buffer.from(payload.contentBase64, 'base64'), bytes);
  }
});

test('missing connection, empty/oversized notes, and unsafe document links surface errors', async (t) => {
  const mock = await client(t);
  await assert.rejects(mock.service.sendNote({ title: 'Evidence', html: 'text' }), /Set up Google Docs/);
  await mock.service.save(ENDPOINT, SECRET);
  await assert.rejects(mock.service.sendNote({ title: 'Evidence', html: '' }), /non-empty/);
  await assert.rejects(mock.service.sendNote({ title: 'Evidence', html: 'x'.repeat(MAX_BYTES + 1) }), /5 MiB/);
  await assert.rejects(mock.service.openDocument('https://docs.google.com.attacker.test/document/d/id/edit'), /Invalid/);
  await mock.service.openDocument(DOCUMENT.url);
  assert.deepEqual(mock.opened, [DOCUMENT.url]);
  assert.equal(mock.requests.length, 0);
});
