const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createGoogleDocs, validateEndpoint, MAX_BYTES, DOCX } = require('../electron/googleDocs.cjs');

const ENDPOINT = 'https://script.google.com/macros/s/test-deployment/exec';
const SECRET = 'test-only-secret-'.repeat(3);
const ACCOUNT = { email: 'personal@example.com', displayName: 'Personal account' };
const DOCUMENT = { id: 'new-doc-id', title: 'Evidence', url: 'https://docs.google.com/document/d/new-doc-id/edit' };
const success = (account = ACCOUNT) => new Response(JSON.stringify({ ok: true, code: 201, message: 'Created', document: DOCUMENT, account }));
const identity = (account = ACCOUNT) => new Response(JSON.stringify({ ok: true, code: 200, message: 'Verified', document: null, account }));

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
      About: {
        get: () => {
          if (overrides.identityError) throw overrides.identityError;
          return { user: { emailAddress: (overrides.account || ACCOUNT).email, displayName: (overrides.account || ACCOUNT).displayName } };
        },
      },
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
    secret: SECRET, expectedAccount: ACCOUNT.email, title: 'Evidence', mimeType: 'text/html',
    contentBase64: Buffer.from('<h1>Evidence</h1><p>Unicode: \u00e9</p>').toString('base64'),
  };
  const post = (data = payload, type = 'application/json') => {
    const output = context.doPost({ postData: { type, contents: typeof data === 'string' ? data : JSON.stringify(data) } });
    assert.equal(output.mimeType, 'application/json');
    const reply = JSON.parse(output.text);
    assert.deepEqual(Object.keys(reply).sort(), ['account', 'code', 'document', 'message', 'ok']);
    assert.equal(Number.isInteger(reply.code), true);
    assert.equal(reply.ok, reply.code === 200 || reply.code === 201);
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
    assert.deepEqual(reply.account, ACCOUNT);
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

test('Apps Script account lookup is authenticated, read-only, and never reveals the browser user', async () => {
  const mock = await webhook();
  const reply = mock.post({ action: 'account', secret: SECRET });
  assert.equal(reply.code, 200);
  assert.deepEqual(reply.account, ACCOUNT);
  assert.equal(reply.document, null);
  assert.equal(mock.post({ action: 'account', secret: 'wrong' }).code, 401);
  assert.equal(mock.post({ ...mock.payload, expectedAccount: 'school@example.com' }).code, 409);
  assert.equal(mock.post({ ...mock.payload, expectedAccount: undefined }).code, 409);
  assert.equal(mock.post({ ...mock.payload, action: 'unknown' }).code, 400);
  assert.equal(mock.calls.length, 0);
  const unavailable = await webhook({ identityError: new Error('private account details') });
  assert.equal(unavailable.post({ action: 'account', secret: SECRET }).code, 502);
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
  const accounts = new Map([[ENDPOINT, ACCOUNT]]);
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
      showMessageBox: async (_win, settings) => {
        confirmations.push(settings);
        return { response: settings.message === 'Connect to this Google account?' ? options.connectConfirm ?? 1 : options.confirm ?? 1 };
      },
      showOpenDialog: async () => ({ canceled: !options.file, filePaths: [options.file] }),
      showSaveDialog: async () => ({ canceled: !options.savePath, filePath: options.savePath }),
    },
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (init.body && JSON.parse(init.body).action === 'account') {
        if (options.identityResponse) return options.identityResponse(url, init);
        return identity(accounts.get(url) || ACCOUNT);
      }
      return options.response ? options.response(url, init) : success();
    },
  };
  const service = createGoogleDocs(dependencies);
  return { service, root, requests, confirmations, opened, dependencies, accounts };
}

test('Google Docs configuration is encrypted, persists, hides secrets, and can be removed', async (t) => {
  const mock = await client(t);
  assert.equal((await mock.service.status()).configured, false);
  await mock.service.save(ENDPOINT, SECRET);
  const status = await createGoogleDocs(mock.dependencies).status();
  assert.equal(status.configured, true);
  assert.equal(status.connections.length, 1);
  assert.equal(status.connections[0].endpoint, ENDPOINT);
  assert.deepEqual(status.connections[0].account, ACCOUNT);
  assert.ok(!JSON.stringify(status).includes(SECRET));
  const persisted = await fs.readFile(path.join(mock.root, 'google-docs.json'), 'utf8');
  assert.ok(!persisted.includes(SECRET));
  assert.ok(JSON.parse(persisted).connections[0].encryptedSecret);
  await mock.service.save(ENDPOINT, '', status.connections[0].id);
  await mock.service.disconnect(status.connections[0].id);
  assert.equal((await mock.service.status()).configured, false);
  await assert.rejects(mock.service.save(ENDPOINT, ''), /Enter the WEBHOOK_SECRET/);
});

test('invalid endpoints, weak secrets, and unavailable OS encryption cannot save a connection', async (t) => {
  const mock = await client(t);
  assert.equal(validateEndpoint('https://script.google.com/macros/u/2/s/test-deployment/exec?authuser=2'), ENDPOINT);
  assert.equal(validateEndpoint(`${ENDPOINT}?authuser=personal%40example.com`), ENDPOINT);
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
  const saved = await mock.service.save(ENDPOINT, SECRET);
  assert.deepEqual(await mock.service.sendNote({ title: 'Evidence', html: '<p>Hello \u00e9</p>', connectionId: saved.savedConnectionId }),
    { canceled: false, code: 201, account: ACCOUNT, document: { ...DOCUMENT, accountEmail: ACCOUNT.email } });
  assert.equal(mock.confirmations.length, 2);
  assert.match(mock.confirmations[1].detail, /creates a new Google Doc/);
  assert.ok(mock.confirmations[1].detail.includes(ACCOUNT.email));
  const [post, get] = mock.requests.slice(2);
  assert.equal(post.url, ENDPOINT);
  assert.equal(post.init.redirect, 'manual');
  assert.equal(post.init.credentials, 'omit');
  const payload = JSON.parse(post.init.body);
  assert.equal(payload.secret, SECRET);
  assert.equal(payload.mimeType, 'text/html');
  assert.equal(payload.expectedAccount, ACCOUNT.email);
  assert.equal(Buffer.from(payload.contentBase64, 'base64').toString('utf8'), '<p>Hello \u00e9</p>');
  assert.equal(get.init.method, 'GET');
  assert.equal(get.init.body, undefined);
  assert.equal(get.init.headers, undefined);
  assert.equal(get.init.credentials, 'omit');
  assert.ok(!get.url.includes(SECRET));
});

test('canceling a transfer never uploads or creates documents', async (t) => {
  const mock = await client(t, { confirm: 0 });
  const saved = await mock.service.save(ENDPOINT, SECRET);
  assert.deepEqual(await mock.service.sendNote({ title: 'Evidence', html: 'document', connectionId: saved.savedConnectionId }), { canceled: true });
  assert.equal(mock.requests.filter(({ init }) => JSON.parse(init.body || '{}').action === 'upload').length, 0);
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
    const saved = await mock.service.save(ENDPOINT, SECRET);
    await assert.rejects(mock.service.sendNote({ title: 'Evidence', html: 'document', connectionId: saved.savedConnectionId }),
      (error) => !error.message.includes(SECRET) && !error.message.includes('private echoed text'));
    assert.equal(mock.requests.length, 3, 'Account lookup on save and upload, then one upload without unsafe redirects or retries');
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
    const saved = await mock.service.save(ENDPOINT, SECRET);
    assert.equal((await mock.service.uploadFile(saved.savedConnectionId)).code, 201);
    const payload = JSON.parse(mock.requests.at(-1).init.body);
    assert.equal(payload.mimeType, mimeType);
    assert.deepEqual(Buffer.from(payload.contentBase64, 'base64'), bytes);
  }
});

test('missing connection, empty/oversized notes, and unsafe document links surface errors', async (t) => {
  const mock = await client(t);
  await assert.rejects(mock.service.sendNote({ title: 'Evidence', html: 'text' }), /Select a saved Google account/);
  await mock.service.save(ENDPOINT, SECRET);
  await assert.rejects(mock.service.sendNote({ title: 'Evidence', html: '' }), /non-empty/);
  await assert.rejects(mock.service.sendNote({ title: 'Evidence', html: 'x'.repeat(MAX_BYTES + 1) }), /5 MiB/);
  await assert.rejects(mock.service.openDocument('https://docs.google.com.attacker.test/document/d/id/edit'), /Invalid/);
  await mock.service.openDocument(DOCUMENT.url, ACCOUNT.email);
  assert.deepEqual(mock.opened, [`${DOCUMENT.url}?authuser=${encodeURIComponent(ACCOUNT.email)}`]);
  assert.equal(mock.requests.length, 1, 'Only account verification when saving');
});

test('multiple connections keep secrets separate and require an explicit upload destination', async (t) => {
  const mock = await client(t);
  const schoolEndpoint = 'https://script.google.com/macros/s/school-deployment/exec';
  const schoolAccount = { email: 'school@example.edu', displayName: 'School' };
  const schoolSecret = 'school-only-secret-'.repeat(3);
  mock.accounts.set(schoolEndpoint, schoolAccount);
  const personal = await mock.service.save(ENDPOINT, SECRET);
  const school = await mock.service.save(schoolEndpoint, schoolSecret);
  assert.equal(school.connections.length, 2);
  await assert.rejects(mock.service.sendNote({ title: 'Evidence', html: 'text' }), /Select a saved Google account/);
  await assert.rejects(mock.service.sendNote({ title: 'Evidence', html: 'text', connectionId: 'missing' }), /Select a saved Google account/);
  // The mock must return the identity of the actual destination on upload too.
  const service = createGoogleDocs({
    ...mock.dependencies,
    fetchImpl: async (url, init) => {
      const payload = JSON.parse(init.body);
      mock.requests.push({ url, init });
      const account = mock.accounts.get(url);
      if (payload.action === 'account') return identity(account);
      assert.equal(payload.secret, url === schoolEndpoint ? schoolSecret : SECRET);
      assert.equal(payload.expectedAccount, account.email);
      return success(account);
    },
  });
  for (const id of [school.savedConnectionId, personal.savedConnectionId]) {
    const connection = school.connections.find((item) => item.id === id);
    const result = await service.sendNote({ title: 'Evidence', html: 'text', connectionId: id });
    assert.equal(mock.requests.at(-1).url, connection.endpoint);
    assert.equal(result.document.accountEmail, connection.account.email);
  }
  await assert.rejects(mock.service.save(schoolEndpoint, '', personal.savedConnectionId), /secrets cannot be reused/);
  await assert.rejects(mock.service.save(ENDPOINT, SECRET), /already has a saved connection/);
  const remaining = await service.disconnect(personal.savedConnectionId);
  assert.deepEqual(remaining.connections.map((item) => item.id), [school.savedConnectionId]);
  await assert.rejects(service.sendNote({ title: 'Evidence', html: 'text', connectionId: personal.savedConnectionId }), /Select a saved Google account/);
  assert.equal((await createGoogleDocs(mock.dependencies).status()).connections[0].id, school.savedConnectionId);
});

test('account changes block uploads before document contents leave Tagline', async (t) => {
  const mock = await client(t);
  const saved = await mock.service.save(ENDPOINT, SECRET);
  mock.accounts.set(ENDPOINT, { email: 'unexpected@example.com', displayName: 'Unexpected account' });
  await assert.rejects(mock.service.sendNote({ title: 'Private', html: 'private document text', connectionId: saved.savedConnectionId }), /different Google account/);
  assert.equal(mock.requests.length, 2, 'Only read-only account lookups');
  assert.equal(mock.requests.some(({ init }) => init.body.includes('contentBase64')), false);
  assert.equal(mock.confirmations.length, 1, 'No upload confirmation after identity mismatch');
});

test('server-side account binding rejects changes between verification and upload', async (t) => {
  const mock = await client(t, {
    response: () => new Response(JSON.stringify({ ok: false, code: 409, document: null, account: null })),
  });
  const saved = await mock.service.save(ENDPOINT, SECRET);
  await assert.rejects(mock.service.sendNote({ title: 'Evidence', html: 'text', connectionId: saved.savedConnectionId }), /409.*different Google account/);
  const payload = JSON.parse(mock.requests.at(-1).init.body);
  assert.equal(payload.expectedAccount, ACCOUNT.email);
  assert.equal(mock.requests.length, 3, 'No retry after account mismatch');
});

test('versionless Google Docs configurations are rejected without migration or upload', async (t) => {
  const mock = await client(t);
  const encryptedSecret = Buffer.from(`encrypted:${SECRET}`).toString('base64');
  await fs.writeFile(path.join(mock.root, 'google-docs.json'), JSON.stringify({ endpoint: ENDPOINT, encryptedSecret }));
  await assert.rejects(mock.service.status(), /configuration is invalid/);
  await assert.rejects(mock.service.sendNote({ title: 'Private', html: 'text' }), /configuration is invalid/);
  assert.equal(mock.requests.length, 0);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(mock.root, 'google-docs.json'), 'utf8')),
    { endpoint: ENDPOINT, encryptedSecret });
});

test('even a single Google Docs connection requires an explicit destination', async (t) => {
  const mock = await client(t);
  await mock.service.save(ENDPOINT, SECRET);
  await assert.rejects(mock.service.sendNote({ title: 'Evidence', html: 'text' }), /Select a saved Google account/);
  await assert.rejects(mock.service.disconnect(), /Select a saved Google account/);
  assert.equal(mock.requests.length, 1);
});

test('canceling verification preserves saved destinations and old scripts cannot be trusted', async (t) => {
  const canceled = await client(t, { connectConfirm: 0 });
  assert.equal((await canceled.service.save(ENDPOINT, SECRET)).canceled, true);
  assert.deepEqual((await canceled.service.status()).connections, []);
  const oldScript = await client(t, { identityResponse: () => success() });
  await assert.rejects(oldScript.service.save(ENDPOINT, SECRET), /unsupported result code/);
  assert.deepEqual((await oldScript.service.status()).connections, []);
  const noIdentity = await client(t, { identityResponse: () => identity(null) });
  await assert.rejects(noIdentity.service.save(ENDPOINT, SECRET), /did not identify a valid Google account/);
});
