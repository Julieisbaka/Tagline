const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createGoogleDocs, registerGoogleDocs, DOCX } = require('../electron/googleDocs.cjs');
const { createGoogleOAuth, CLIENT_ID, SCOPES, TOKEN_URL, USERINFO_URL, UPLOAD_URL } = require('../electron/googleOAuth.cjs');

const ACCESS = 'private-access-token';
const REFRESH = 'private-refresh-token';
const account = { sub: 'subject-123', email: 'test@example.com', email_verified: true };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const validTokens = { access_token: ACCESS, refresh_token: REFRESH, token_type: 'Bearer', scope: SCOPES.join(' ') };

async function setup(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-oauth-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const requests = [], opened = [], confirmations = [], callbacks = [];
  let authUrl;
  const dependencies = {
    app: Object.assign(new EventEmitter(), { getPath: () => root }),
    safeStorage: {
      isAsyncEncryptionAvailable: async () => options.encryption !== false,
      encryptStringAsync: async (value) => Buffer.from(`encrypted:${value}`),
      decryptStringAsync: async (value) => ({ result: value.toString().slice('encrypted:'.length) }),
    },
    shell: {
      openExternal: async (url) => {
        opened.push(url);
        if (!url.startsWith('https://accounts.google.com/')) return;
        authUrl = new URL(url);
        if (options.browser) return options.browser(authUrl);
        const callback = new URL(authUrl.searchParams.get('redirect_uri'));
        callback.search = new URLSearchParams({ code: 'test-auth-code', state: authUrl.searchParams.get('state') });
        callbacks.push(callback.href);
        const result = await fetch(callback);
        assert.equal(result.status, 200);
        assert.ok(!(await result.text()).includes('test-auth-code'));
      }
    },
    getWindow: () => ({}),
    dialog: {
      showMessageBox: async (_win, settings) => {
        confirmations.push(settings);
        return { response: options.confirm ? await options.confirm(settings) : 1 };
      },
      showOpenDialog: async () => ({ canceled: !options.file, filePaths: [options.file] }),
    },
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      assert.equal(init.redirect, url.startsWith('https://script.google.com/') ? 'manual' : 'error');
      assert.equal(init.credentials, 'omit');
      if (options.response) {
        const response = await options.response(url, init);
        if (response) return response;
      }
      if (url === TOKEN_URL) return json(validTokens);
      if (url === USERINFO_URL) return json(account);
      if (url === UPLOAD_URL) return json({ id: 'new-doc', mimeType: 'application/vnd.google-apps.document' });
      if (url === 'https://script.google.com/macros/s/legacy/exec') return json({
        ok: true, code: 200, account: { email: 'legacy@example.com', displayName: 'Legacy' },
      });
      assert.fail(`Unexpected endpoint: ${url}`);
    },
  };
  const service = createGoogleDocs(dependencies);
  t.after(() => service.cancelConnect());
  return { service, dependencies, root, requests, opened, confirmations, callbacks, get authUrl() { return authUrl; } };
}

test('desktop OAuth uses a system browser, random loopback callback, state and S256 PKCE with minimal scopes', async (t) => {
  const mock = await setup(t);
  const saved = await mock.service.connect();
  const url = mock.authUrl;
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.deepEqual(url.searchParams.get('scope').split(' '), SCOPES);
  const redirect = new URL(url.searchParams.get('redirect_uri'));
  assert.equal(redirect.hostname, '127.0.0.1');
  assert.ok(Number(redirect.port) > 0);
  const exchange = new URLSearchParams(mock.requests[0].init.body);
  assert.equal(exchange.get('grant_type'), 'authorization_code');
  assert.equal(exchange.get('client_id'), CLIENT_ID);
  assert.equal(exchange.get('code'), 'test-auth-code');
  assert.equal(exchange.get('redirect_uri'), redirect.href);
  assert.equal(createHash('sha256').update(exchange.get('code_verifier')).digest('base64url'), url.searchParams.get('code_challenge'));
  assert.equal(mock.requests[1].init.headers.Authorization, `Bearer ${ACCESS}`);
  assert.equal(saved.connections[0].type, 'oauth');
  assert.equal(saved.connections[0].endpoint, undefined);
  assert.deepEqual(saved.connections[0].account, { email: account.email, displayName: '' });
  assert.ok(!JSON.stringify(saved).includes(ACCESS));
  assert.ok(!JSON.stringify(saved).includes(REFRESH));
  const contents = await fs.readFile(path.join(mock.root, 'google-docs.json'), 'utf8');
  assert.ok(!contents.includes(ACCESS));
  assert.ok(!contents.includes(REFRESH));
  const stored = JSON.parse(contents);
  assert.ok(stored.connections[0].encryptedTokens);
  assert.equal(stored.connections[0].subject, account.sub);
  assert.equal((await createGoogleDocs(mock.dependencies).status()).configured, true);
  await assert.rejects(fetch(mock.callbacks[0]), /fetch failed/, 'Callback listener is closed after connection');
});

test('old script connections and OAuth coexist and reconnecting updates only the same Google subject', async (t) => {
  const mock = await setup(t);
  const old = await mock.service.save('https://script.google.com/macros/s/legacy/exec', 'legacy-secret-'.repeat(4));
  const oauth = await mock.service.connect();
  assert.equal(oauth.connections.length, 2);
  assert.equal(oauth.connections.find((item) => item.id === old.savedConnectionId).type, 'script');
  const reconnected = await mock.service.connect();
  assert.equal(reconnected.connections.length, 2);
  assert.equal(reconnected.savedConnectionId, oauth.savedConnectionId);
  await assert.rejects(mock.service.save('https://script.google.com/macros/s/legacy/exec', '', oauth.savedConnectionId), /Apps Script/);
  const after = await mock.service.disconnect(oauth.savedConnectionId);
  assert.equal(after.connections.length, 1);
  assert.equal(after.connections[0].id, old.savedConnectionId);
  assert.equal(mock.requests.filter(({ url }) => url === UPLOAD_URL).length, 0);
});

test('direct uploads refresh authorization, verify the account and preserve bytes in a new Doc without permission changes', async (t) => {
  const mock = await setup(t);
  const saved = await mock.service.connect();
  const result = await mock.service.sendNote({ title: 'Evidence', html: '<p>Unicode \u00e9</p>', connectionId: saved.savedConnectionId });
  assert.deepEqual(result, {
    canceled: false, code: 201, account: { email: account.email, displayName: '' },
    document: { id: 'new-doc', title: 'Evidence', url: 'https://docs.google.com/document/d/new-doc/edit', accountEmail: account.email },
  });
  const refresh = new URLSearchParams(mock.requests[2].init.body);
  assert.equal(refresh.get('grant_type'), 'refresh_token');
  assert.equal(refresh.get('refresh_token'), REFRESH);
  const upload = mock.requests.at(-1);
  assert.equal(upload.url, UPLOAD_URL);
  assert.equal(upload.init.headers.Authorization, `Bearer ${ACCESS}`);
  assert.equal(upload.init.method, 'POST');
  assert.match(upload.init.headers['Content-Type'], /^multipart\/related; boundary=tagline_/);
  assert.ok(upload.init.body.includes(Buffer.from('<p>Unicode \u00e9</p>')));
  assert.match(upload.init.body.toString(), /"mimeType":"application\/vnd.google-apps.document"/);
  assert.match(upload.init.body.toString(), /Content-Type: text\/html/);
  assert.ok(!upload.init.body.includes(Buffer.from(REFRESH)));
  assert.equal(mock.confirmations.at(-1).defaultId, 0);
  assert.match(mock.confirmations.at(-1).detail, /test@example.com/);
  assert.match(mock.confirmations.at(-1).detail, /directly to Google Drive/);
});

test('direct DOCX uploads preserve binary bytes and use the same result contract', async (t) => {
  const mock = await setup(t);
  const file = path.join(mock.root, 'Evidence.docx');
  const bytes = Buffer.from([80, 75, 0, 255, 128, 13, 10]);
  await fs.writeFile(file, bytes);
  mock.dependencies.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  const saved = await mock.service.connect();
  assert.equal((await mock.service.uploadFile(saved.savedConnectionId)).code, 201);
  assert.ok(mock.requests.at(-1).init.body.includes(bytes));
  assert.ok(mock.requests.at(-1).init.body.includes(Buffer.from(`Content-Type: ${DOCX}`)));
});

test('canceling connection confirmation or upload never creates a document', async (t) => {
  const noConnection = await setup(t, { confirm: () => 0 });
  assert.equal((await noConnection.service.connect()).canceled, true);
  assert.deepEqual((await noConnection.service.status()).connections, []);
  const noUpload = await setup(t, { confirm: (settings) => settings.message.startsWith('Connect') ? 1 : 0 });
  const saved = await noUpload.service.connect();
  assert.deepEqual(await noUpload.service.sendNote({ title: 'Evidence', html: 'x', connectionId: saved.savedConnectionId }), { canceled: true });
  assert.equal(noUpload.requests.some(({ url }) => url === UPLOAD_URL), false);
});

test('wrong or missing scopes, refresh tokens and verified identities cannot save connections', async (t) => {
  for (const tokens of [
    { ...validTokens, refresh_token: undefined }, { ...validTokens, token_type: 1 },
    { ...validTokens, scope: 'openid email' }, { ...validTokens, access_token: 'bad\r\nvalue' },
  ]) {
    const mock = await setup(t, { response: (url) => url === TOKEN_URL ? json(tokens) : undefined });
    await assert.rejects(mock.service.connect(), /Google/);
    assert.equal((await mock.service.status()).configured, false);
  }
  const unverified = await setup(t, { response: (url) => url === USERINFO_URL ? json({ ...account, email_verified: false }) : undefined });
  await assert.rejects(unverified.service.connect(), /verified account/);
  const noEncryption = await setup(t, { encryption: false });
  await assert.rejects(noEncryption.service.connect(), /encryption/);
  assert.equal(noEncryption.opened.length, 0);
});

test('OAuth callback rejects forged state, Unicode state, duplicate codes, unexpected paths and denied consent', async (t) => {
  const mock = await setup(t, {
    browser: async (url) => {
      const callback = new URL(url.searchParams.get('redirect_uri'));
      for (const state of ['wrong', '\u00e9'.repeat(43), '']) {
        callback.search = new URLSearchParams({ code: 'code', state });
        assert.equal((await fetch(callback)).status, 400);
      }
      callback.pathname = '/wrong-path';
      callback.search = new URLSearchParams({ code: 'code', state: url.searchParams.get('state') });
      assert.equal((await fetch(callback)).status, 400);
      callback.pathname = '/oauth2callback';
      callback.search = new URLSearchParams({ error: 'access_denied', state: url.searchParams.get('state') });
      assert.equal((await fetch(callback)).status, 200);
    }
  });
  await assert.rejects(mock.service.connect(), /declined/);
  assert.equal(mock.requests.length, 0);
  const duplicates = await setup(t, {
    browser: async (url) => {
      const callback = new URL(url.searchParams.get('redirect_uri'));
      callback.search = new URLSearchParams({ code: 'one', state: url.searchParams.get('state') });
      callback.searchParams.append('code', 'two');
      assert.equal((await fetch(callback)).status, 400);
    }
  });
  await assert.rejects(duplicates.service.connect(), /authorization code/);
});

test('pending Google sign-in can be canceled or timed out and closes its loopback server', async (t) => {
  let ready;
  const opened = new Promise((resolve) => { ready = resolve; });
  const mock = await setup(t, { browser: (url) => { ready(url); } });
  const pending = mock.service.connect();
  const url = await opened;
  await assert.rejects(mock.service.connect(), /in progress/);
  await assert.rejects(mock.service.disconnect('missing'), /in progress/);
  mock.service.cancelConnect();
  await assert.rejects(pending, /canceled/);
  await assert.rejects(fetch(url.searchParams.get('redirect_uri')), /fetch failed/);
  const oauth = createGoogleOAuth({ shell: { openExternal: async () => { } }, authorizationTimeout: 20 });
  await assert.rejects(oauth.authorize(), /timed out/);
});

test('canceling during the token exchange aborts the request and cannot persist authorization', async (t) => {
  let started;
  const exchanging = new Promise((resolve) => { started = resolve; });
  const mock = await setup(t, {
    response: (url, init) => {
      if (url !== TOKEN_URL) return;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        started();
      });
    }
  });
  const pending = mock.service.connect();
  await exchanging;
  mock.service.cancelConnect();
  await assert.rejects(pending, /canceled/);
  assert.equal((await mock.service.status()).configured, false);
  await assert.rejects(fetch(mock.callbacks[0]), /fetch failed/);
});

test('rotated refresh tokens are encrypted and persisted before a confirmed upload', async (t) => {
  const mock = await setup(t, {
    response: (url, init) => url === TOKEN_URL &&
      new URLSearchParams(init.body).get('grant_type') === 'refresh_token'
      ? json({ ...validTokens, refresh_token: 'rotated-refresh-token' }) : undefined
  });
  const saved = await mock.service.connect();
  await mock.service.sendNote({ title: 'Evidence', html: 'x', connectionId: saved.savedConnectionId });
  const config = JSON.parse(await fs.readFile(path.join(mock.root, 'google-docs.json'), 'utf8'));
  const encrypted = config.connections[0].encryptedTokens;
  const plaintext = await mock.dependencies.safeStorage.decryptStringAsync(Buffer.from(encrypted, 'base64'));
  assert.equal(JSON.parse(plaintext.result).refreshToken, 'rotated-refresh-token');
  assert.ok(!JSON.stringify(config).includes('rotated-refresh-token'));
  const restarted = createGoogleDocs(mock.dependencies);
  await restarted.sendNote({ title: 'Evidence', html: 'x', connectionId: saved.savedConnectionId });
  const exchanges = mock.requests.filter(({ url }) => url === TOKEN_URL);
  assert.equal(new URLSearchParams(exchanges.at(-1).init.body).get('refresh_token'), 'rotated-refresh-token');
});

test('an upload confirmation locks connection changes and cancellation leaves the account connected', async (t) => {
  let showConfirmation, finish;
  const shown = new Promise((resolve) => { showConfirmation = resolve; });
  const mock = await setup(t, {
    confirm: (settings) => {
      if (settings.message.startsWith('Connect')) return 1;
      return new Promise((resolve) => { finish = resolve; showConfirmation(); });
    }
  });
  const saved = await mock.service.connect();
  const pending = mock.service.sendNote({ title: 'Evidence', html: 'x', connectionId: saved.savedConnectionId });
  await shown;
  await assert.rejects(mock.service.disconnect(saved.savedConnectionId), /in progress/);
  await assert.rejects(mock.service.connect(), /in progress/);
  finish(0);
  assert.deepEqual(await pending, { canceled: true });
  assert.equal((await mock.service.status()).configured, true);
  assert.equal(mock.requests.some(({ url }) => url === UPLOAD_URL), false);
});

test('revoked authorization and account mismatch fail before upload without leaking provider errors', async (t) => {
  const mock = await setup(t);
  const saved = await mock.service.connect();
  const expired = createGoogleDocs({ ...mock.dependencies, fetchImpl: async () => json({ error: 'invalid_grant', error_description: REFRESH }, 400) });
  await assert.rejects(expired.sendNote({ title: 'Evidence', html: 'x', connectionId: saved.savedConnectionId }),
    (error) => /Reconnect/.test(error.message) && !error.message.includes(REFRESH));
  const mismatch = createGoogleDocs({
    ...mock.dependencies, fetchImpl: async (url) =>
      url === TOKEN_URL ? json(validTokens) : json({ ...account, sub: 'someone-else' })
  });
  await assert.rejects(mismatch.sendNote({ title: 'Evidence', html: 'x', connectionId: saved.savedConnectionId }), /different account/);
});

test('direct upload failures never retry document creation or return success-shaped results', async (t) => {
  for (const failure of [
    () => json({ error: { message: REFRESH } }, 403),
    () => new Response(null, { status: 302, headers: { location: 'https://attacker.test/' } }),
    () => json({ id: 'doc', mimeType: 'text/html' }),
    () => new Response('<html>Error</html>'),
    () => { throw new Error(ACCESS); },
  ]) {
    const mock = await setup(t, { response: (url) => url === UPLOAD_URL ? failure() : undefined });
    const saved = await mock.service.connect();
    await assert.rejects(mock.service.sendNote({ title: 'Evidence', html: 'x', connectionId: saved.savedConnectionId }),
      (error) => !error.message.includes(ACCESS) && !error.message.includes(REFRESH));
    assert.equal(mock.requests.filter(({ url }) => url === UPLOAD_URL).length, 1);
  }
});

test('declared and streamed OAuth responses are bounded and canceled without saving credentials', async (t) => {
  for (const declared of [true, false]) {
    let canceled = false;
    const mock = await setup(t, {
      response: (url) => {
        if (url !== TOKEN_URL) return;
        return new Response(new ReadableStream({
          pull(controller) { controller.enqueue(new Uint8Array(40000)); },
          cancel() { canceled = true; },
        }), declared ? { headers: { 'content-length': '70000' } } : undefined);
      }
    });
    await assert.rejects(mock.service.connect(), /Cannot read/);
    assert.equal(canceled, true);
    assert.equal((await mock.service.status()).configured, false);
  }
});

test('invalid encrypted OAuth credentials fail closed without contacting Google', async (t) => {
  const mock = await setup(t);
  const saved = await mock.service.connect();
  const file = path.join(mock.root, 'google-docs.json');
  const config = JSON.parse(await fs.readFile(file, 'utf8'));
  config.connections[0].encryptedTokens = Buffer.from('encrypted:{"refreshToken":null}').toString('base64');
  await fs.writeFile(file, JSON.stringify(config));
  const requestsBefore = mock.requests.length;
  await assert.rejects(mock.service.sendNote({ title: 'Evidence', html: 'x', connectionId: saved.savedConnectionId }), /Invalid saved/);
  assert.equal(mock.requests.length, requestsBefore);
});

test('Google connector IPC is restricted to the application main frame', () => {
  const handlers = {};
  const contents = { mainFrame: {} };
  const service = registerGoogleDocs({
    app: Object.assign(new EventEmitter(), { getPath: () => os.tmpdir() }),
    ipcMain: { handle: (name, handler) => { handlers[name] = handler; } },
    getWindow: () => ({ webContents: contents }), shell: {},
  });
  for (const handler of Object.values(handlers)) {
    assert.throws(() => handler({ sender: {} }), /main frame/);
    assert.throws(() => handler({ sender: contents, senderFrame: {} }), /main frame/);
  }
  assert.equal(typeof handlers['googleDocs:connect'], 'function');
  service.cancelConnect();
});
