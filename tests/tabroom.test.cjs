const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createTabroom, registerTabroom, tournamentId, PARTITION } = require('../electron/tabroom.cjs');
const { normalizeSnapshot, snapshotRecords } = require('../electron/tabroomData.cjs');

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

test('Tabroom opens local tournament JSON through the same snapshot table normalization without network access', () => {
  const data = {
    ...tournament,
    schools: [{ id: 10, name: 'Example School', code: 'EX' }],
    events: [{ id: 20, name: 'Policy', entries: [{ id: 30, name: 'Example AB', school: 10 }] }],
  };
  const mock = setup();
  const opened = mock.service.openJson(JSON.stringify(data));
  assert.equal(opened.id, '123');
  assert.equal(opened.name, 'Test Tournament');
  assert.equal(opened.collections.teams.count, 1);
  assert.deepEqual(mock.service.snapshotRecordsForJson(opened.token, 'teams', 0, 'Example'), {
    available: true, total: 1, pages: 1, page: 0,
    rows: [{
      id: '30', name: 'Example AB', code: '', recordUrl: 'https://www.tabroom.com/index/tourn/postings/entry_record.mhtml?tourn_id=123&entry_id=30',
      eventId: '20', event: 'Policy', schoolId: '10', school: 'Example School', schoolCode: 'EX',
      chapter: '', hybrid: '', students: [],
    }],
  });
  assert.equal(mock.requests.length, 0);
  assert.throws(() => mock.service.openJson('{'), /valid JSON/);
  assert.throws(() => mock.service.openJson(JSON.stringify({ id: 123 })), /tournament collections/);
  assert.throws(() => mock.service.snapshotRecordsForJson('expired', 'teams', 0, ''), /expired/);
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
  assert.equal(Object.keys(handlers).length, 9);
  assert.throws(() => handlers['tabroom:status']({ sender: {} }), /application/);
  assert.throws(() => handlers['tabroom:status']({ sender: webContents, senderFrame: {} }), /application/);
  assert.equal(partition, undefined);
  assert.deepEqual(await handlers['tabroom:status']({ sender: webContents, senderFrame: webContents.mainFrame }),
    { hasSession: false });
  assert.equal(partition, PARTITION);
  assert.equal(partition, 'persist:tabroom');
});

const nestedTournament = {
  ...tournament, city: 'Test City', timezone: 'America/New_York',
  schools: [
    { id: 10, name: 'Example School', code: 'EX', chapter: 100,
      students: [{ id: 1, first: 'Alice', last: 'Able' }, { id: 2, first: 'Bob', last: 'Baker' }],
      entries: [{ id: 20, event: 30, code: 'EX AB', students: [1, 2] }],
      judges: [{ id: 40, person: 500, first: 'Jane', last: 'Judge' }] },
    { id: null, name: null, chapter: 101 },
  ],
  categories: [
    { id: 5, name: 'Policy', judges: [{ id: 40, school: '10', first: 'Jane', last: 'Judge' }],
      events: [{ id: 30, name: 'Varsity Policy', abbr: 'VCX', type: 'debate',
        entries: [{ id: 20, school: 10, name: 'Example AB' }] }] },
    { id: 6, name: 'Other', judges: [{ id: '40', first: 'Jane', last: 'Judge' }] },
    { id: 7, name: 'Private' },
  ],
  events: [],
};

test('snapshot tables normalize nested events, teams and judges and resolve school references without name deduplication', () => {
  const snapshot = normalizeSnapshot(nestedTournament);
  assert.equal(snapshot.metadata.location, 'Test City');
  assert.equal(snapshot.collections.schools.rows.length, 2);
  assert.equal(snapshot.collections.events.rows.length, 1);
  assert.equal(snapshot.collections.teams.rows.length, 1);
  const team = snapshot.collections.teams.rows[0];
  assert.equal(team.name, 'Example AB');
  assert.equal(team.school, 'Example School');
  assert.equal(team.schoolCode, 'EX');
  assert.equal(team.chapter, '100');
  assert.equal(team.event, 'Varsity Policy');
  assert.deepEqual(team.students.map(({ recordUrl, ...student }) => student), [
    { id: '1', first: 'Alice', last: 'Able' }, { id: '2', first: 'Bob', last: 'Baker' },
  ]);
  const judge = snapshot.collections.judges.rows[0];
  assert.equal(judge.personId, '500');
  assert.equal(judge.school, 'Example School');
  assert.deepEqual(judge.categories, ['Policy', 'Other']);
  const anonymous = normalizeSnapshot({ judges: [{ first: 'Same' }, { first: 'Same' }] });
  assert.equal(anonymous.collections.judges.rows.length, 2);
  assert.equal(snapshot.collections.schools.rows[1].name, '');
  assert.equal(team.recordUrl, 'https://www.tabroom.com/index/tourn/postings/entry_record.mhtml?tourn_id=123&entry_id=20');
  assert.equal(team.students[0].recordUrl, 'https://www.tabroom.com/index/results/team_lifetime_record.mhtml?id1=1');
});

test('TBA teams are excluded across nested copies but retained in raw JSON and exact exports', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-tabroom-tba-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'backup.json');
  const data = { id: 123, categories: [{ events: [{ id: 1, entries: [
    { id: 10, code: ' tBa ', name: 'Placeholder' }, { id: 11, code: 'AB' },
    { code: 'TBA' }, { id: 12, code: 'TBAA' },
  ] }] }], schools: [{ id: 1, entries: [{ id: 10, name: 'Duplicate' }, { id: 13, code: 'tba' }] }] };
  const raw = JSON.stringify(data);
  const mock = setup({ response: () => new Response(raw), save: async () => ({ filePath: file }) });
  const result = await mock.service.load(123);
  assert.equal(result.collections.teams.count, 2);
  assert.deepEqual(mock.service.records(123, 'teams', 0, '').rows.map((row) => row.id), ['11', '12']);
  assert.equal(mock.service.records(123, 'teams', 0, 'Placeholder').total, 0);
  assert.deepEqual(JSON.parse(mock.service.page(123, 0)), data);
  await mock.service.download(123);
  assert.equal(await fs.readFile(file, 'utf8'), raw);
});

test('record links require positive numeric tournament, entry and student IDs', () => {
  const snapshot = normalizeSnapshot({ id: 'invalid', events: [{ entries: [
    { id: '20', students: [{ id: 1 }, { person: 500, first: 'No student ID' }, { id: '../bad' }] },
  ] }] });
  const team = snapshot.collections.teams.rows[0];
  assert.equal(team.recordUrl, '');
  assert.ok(team.students[0].recordUrl.endsWith('id1=1'));
  assert.equal(team.students[1].recordUrl, '');
  assert.equal(team.students[2].recordUrl, '');
});

test('snapshot distinguishes missing, null, redacted and explicitly empty collections and reports malformed shapes', () => {
  assert.equal(normalizeSnapshot({ categories: [{ name: 'Hidden' }] }).collections.judges.available, false);
  assert.equal(normalizeSnapshot({ judges: null }).collections.judges.available, false);
  const empty = normalizeSnapshot({ categories: [{ judges: [] }] });
  assert.deepEqual(empty.collections.judges, { available: true, rows: [] });
  for (const invalid of [{ judges: {} }, { schools: [null] }, { categories: [{ events: 'hidden' }] },
    { schools: [{ entries: [{ students: {} }] }] }])
    assert.ok(normalizeSnapshot(invalid).warnings.length);
});

test('unsupported collection shapes warn without preventing raw inspection or exact backup export', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-tabroom-schema-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'backup.json');
  const raw = JSON.stringify({ ...tournament, schools: { unexpected: true } });
  const mock = setup({ response: () => new Response(raw), save: async () => ({ filePath: file }) });
  const loaded = await mock.service.load(123);
  assert.deepEqual(loaded.warnings, ['schools']);
  assert.deepEqual(JSON.parse(mock.service.page(123, 0)), JSON.parse(raw));
  await mock.service.download(123);
  assert.equal(await fs.readFile(file, 'utf8'), raw);
});

test('structured records are filtered and bounded to 50 per page, with validated requests', async () => {
  const judges = Array.from({ length: 103 }, (_, i) => ({ id: i + 1, first: 'Judge', last: String(i) }));
  const mock = setup({ response: () => json({ ...nestedTournament, judges }) });
  const loaded = await mock.service.load(123);
  assert.deepEqual(loaded.collections.judges, { available: true, count: 103 });
  assert.equal(loaded.collections.events.count, 1);
  const first = mock.service.records(123, 'judges', 0, '');
  assert.equal(first.total, 103);
  assert.equal(first.pages, 3);
  assert.equal(first.rows.length, 50);
  assert.equal(mock.service.records(123, 'judges', 2, '').rows.length, 3);
  assert.equal(mock.service.records(123, 'judges', 0, 'jane judge').total, 0);
  assert.equal(mock.service.records(123, 'teams', 0, 'EX').total, 1);
  assert.equal(mock.requests.length, 1, 'Filtering and paging must not refetch the snapshot');
  for (const [kind, page, query] of [['__proto__', 0, ''], ['judges', -1, ''], ['judges', 3, ''],
    ['judges', '0', ''], ['judges', 0, null], ['judges', 0, 'x'.repeat(201)]])
    assert.throws(() => mock.service.records(123, kind, page, query), /Invalid/);
  assert.throws(() => mock.service.records(124, 'judges', 0, ''), /again/);
  await mock.service.logout();
  assert.throws(() => mock.service.records(123, 'judges', 0, ''), /again/);
});
