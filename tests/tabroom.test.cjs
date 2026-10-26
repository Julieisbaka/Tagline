const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createTabroom, registerTabroom, tournamentId, PARTITION } = require('../electron/tabroom.cjs');

const tournament = { id: 123, name: 'Test Tournament', start: '2026-10-26', events: [{ name: 'Policy' }], schools: [] };
const json = (data = tournament, status = 200) => new Response(JSON.stringify(data), { status });

function setup(options = {}) {
  let cookies = options.cookies || [];
  const requests = [], windows = [];
  const session = {
    cookies: { get: async () => cookies, flushStore: async () => {} },
    clearStorageData: async () => { cookies = []; },
    fetch: async (url, init) => { requests.push({ url, init }); return options.response ? options.response() : json(); },
  };
  class Window extends EventEmitter {
    constructor(config) {
      super();
      this.config = config;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = (handler) => { this.popup = handler; };
      windows.push(this);
    }
    async loadURL(url) { this.url = url; if (options.loginError) throw new Error('offline'); }
    close() { this.emit('closed'); }
    focus() { this.focused = true; }
  }
  const getWindow = () => options.window || {};
  const service = createTabroom({
    session, BrowserWindow: Window, getWindow,
    dialog: { showSaveDialog: options.save || (async () => ({ canceled: true })) },
  });
  return { service, session, requests, windows, setCookies: (value) => { cookies = value; } };
}

test('Tabroom accepts IDs and official tournament URLs but never arbitrary request destinations', () => {
  for (const input of [123, '123', ' 00123 ', 'https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=123',
    'https://www.tabroom.com/api/download_data.mhtml?tourn_id=123&other=ignored'])
    assert.equal(tournamentId(input), '123');
  for (const input of ['', 0, -1, 1.5, null, {}, '1e3', '9007199254740993', 'https://evil.test/?tourn_id=123',
    'http://www.tabroom.com/?tourn_id=123', 'https://www.tabroom.com.evil.test/?tourn_id=123',
    'https://user:pass@www.tabroom.com/?tourn_id=123', 'https://www.tabroom.com/?tourn_id=123&tourn_id=456',
    'https://www.tabroom.com/?tourn_id=../private', 'https://www.tabroom.com/', 'x'.repeat(2049)])
    assert.throws(() => tournamentId(input), /valid|https/);
});

test('Tabroom loads public data through the isolated cookie jar and returns paged JSON', async () => {
  const data = { ...tournament, description: 'x'.repeat(45000) };
  const mock = setup({ response: () => json(data) });
  const result = await mock.service.load('https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=123');
  assert.equal(mock.requests[0].url, 'https://www.tabroom.com/api/download_data.mhtml?tourn_id=123');
  assert.equal(mock.requests[0].init.credentials, 'include');
  assert.equal(mock.requests[0].init.method, 'GET');
  assert.equal(mock.requests[0].init.redirect, 'error');
  assert.equal(result.name, tournament.name);
  assert.deepEqual(result.sections, [{ name: 'events', count: 1 }, { name: 'schools', count: 0 }]);
  assert.equal(result.pages, 3);
  const pages = Array.from({ length: result.pages }, (_, i) => mock.service.page(result.id, i));
  assert.equal(pages[0], result.preview);
  assert.deepEqual(JSON.parse(pages.join('')), data);
  for (const index of [-1, 3, 0.5, '0']) assert.throws(() => mock.service.page('123', index), /Invalid/);
  assert.throws(() => mock.service.page('456', 0), /again/);
});

test('Tabroom surfaces network, permissions, HTML, invalid JSON and wrong-tournament errors', async () => {
  for (const [response, message] of [
    [() => { throw new Error('offline'); }, /offline/],
    [() => json({}, 401), /denied/],
    [() => json({}, 403), /denied/],
    [() => json({}, 404), /404/],
    [() => new Response('<html>Sign in</html>'), /valid JSON/],
    [() => json({ error: 'not available' }), /unexpected/],
    [() => json({ ...tournament, id: 456 }), /unexpected/],
    [() => json([]), /unexpected/],
    [() => new Response(null), /empty response/],
  ]) {
    const mock = setup({ response });
    await assert.rejects(mock.service.load(123), message);
    await assert.rejects(mock.service.download(123), /Load/);
  }
});

test('Tabroom bounds both declared and streamed response sizes', async () => {
  const declared = setup({ response: () => new Response('{}', { headers: { 'content-length': 33 * 1024 * 1024 } }) });
  await assert.rejects(declared.service.load(123), /32 MiB/);
  let cancelled = false;
  const streamed = setup({ response: () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(17 * 1024 * 1024)); },
    cancel() { cancelled = true; },
  })) });
  await assert.rejects(streamed.service.load(123), /32 MiB/);
  assert.equal(cancelled, true);
});

test('Tabroom exports exact original bytes and never accepts renderer-supplied paths or data', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-tabroom-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'backup.json');
  const raw = JSON.stringify(tournament) + '\n';
  let picker;
  const mock = setup({
    response: () => new Response(raw),
    save: async (_win, options) => { picker = options; return { filePath: file }; },
  });
  await assert.rejects(mock.service.download(123), /Load/);
  await mock.service.load(123);
  assert.deepEqual(await mock.service.download(123), { path: file });
  assert.equal(picker.defaultPath, 'tabroom-123.json');
  assert.equal(await fs.readFile(file, 'utf8'), raw);
  assert.equal(mock.requests.length, 1);
  await assert.rejects(mock.service.download(456), /Load/);
  const cancelled = setup();
  await cancelled.service.load(123);
  assert.deepEqual(await cancelled.service.download(123), { cancelled: true });
});

test('Tabroom clears loaded data on session changes and rejects stale requests and saves', async () => {
  const mock = setup({ cookies: [{ value: 'secret', expirationDate: Date.now() / 1000 + 1000 }] });
  assert.deepEqual(await mock.service.status(), { hasSession: true });
  mock.setCookies([{ value: 'expired', expirationDate: 1 }]);
  assert.deepEqual(await mock.service.status(), { hasSession: false });
  await mock.service.load(123);
  await mock.service.logout();
  assert.throws(() => mock.service.page(123, 0), /again/);
  let respond;
  const pending = setup({ response: () => new Promise((resolve) => { respond = resolve; }) });
  const load = pending.service.load(123);
  await pending.service.logout();
  respond(json());
  await assert.rejects(load, /changed/);
  let choose;
  const saving = setup({ save: () => new Promise((resolve) => { choose = resolve; }) });
  await saving.service.load(123);
  const download = saving.service.download(123);
  await saving.service.logout();
  choose({ filePath: 'must-not-be-written.json' });
  await assert.rejects(download, /changed/);
});

test('Tabroom sign-in is sandboxed, same-origin only, and never claims cookies prove authentication', async () => {
  const mock = setup();
  const login = mock.service.login();
  const win = mock.windows[0];
  assert.equal(win.url, 'https://www.tabroom.com/user/login/login.mhtml');
  assert.deepEqual(win.config.webPreferences, {
    session: mock.session, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
  });
  assert.deepEqual(win.popup({ url: 'https://evil.test' }), { action: 'deny' });
  for (const type of ['will-navigate', 'will-redirect']) {
    for (const url of ['https://evil.test', 'file:///secret', 'javascript:alert(1)', 'invalid',
      'https://user:pass@www.tabroom.com/']) {
      let blocked = false;
      win.webContents.emit(type, { preventDefault: () => { blocked = true; } }, url);
      assert.ok(blocked);
    }
    win.webContents.emit(type, { preventDefault: () => assert.fail('Official navigation blocked') }, 'https://www.tabroom.com/');
  }
  await assert.rejects(mock.service.login(), /already open/);
  assert.equal(win.focused, true);
  win.close();
  assert.deepEqual(await login, { hasSession: false });
  const failed = setup({ loginError: true });
  await assert.rejects(failed.service.login(), /offline/);
});

test('Tabroom IPC is restricted to the application main frame and uses its own persistent partition', async () => {
  const handlers = {};
  const webContents = { mainFrame: {} };
  let partition;
  const isolated = setup().session;
  isolated.setPermissionRequestHandler = (handler) => handler(null, null, (allowed) => assert.equal(allowed, false));
  isolated.setPermissionCheckHandler = (handler) => assert.equal(handler(), false);
  isolated.setDevicePermissionHandler = (handler) => assert.equal(handler(), false);
  isolated.on = (name, handler) => { assert.equal(name, 'will-download'); handler({ preventDefault() {} }); };
  registerTabroom({
    ipcMain: { handle: (name, handler) => { handlers[name] = handler; } },
    session: { fromPartition: (name) => { partition = name; return isolated; } },
    getWindow: () => ({ webContents }),
  });
  assert.equal(Object.keys(handlers).length, 6);
  assert.throws(() => handlers['tabroom:status']({ sender: {} }), /application/);
  assert.throws(() => handlers['tabroom:status']({ sender: webContents, senderFrame: {} }), /application/);
  assert.equal(partition, undefined);
  assert.deepEqual(await handlers['tabroom:status']({ sender: webContents, senderFrame: webContents.mainFrame }),
    { hasSession: false });
  assert.equal(partition, PARTITION);
  assert.equal(partition, 'persist:tabroom');
});
