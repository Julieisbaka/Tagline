const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createOpenCaselist, registerOpenCaselist, teamRoute, roundData, responseBytes, PARTITION } = require('../electron/opencaselist.cjs');

const selection = { caselist: 'ndt2026', school: 'School', team: 'AB' };
const round = { tournament: 'Tournament', side: 'A', round: '1', opponent: 'Other school', report: 'Report' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
function setup(options = {}) {
  const requests = [], confirmations = [];
  let config = options.config || {};
  let clock = Date.now();
  const cookies = new EventEmitter();
  let stored = [{ name: 'caselist_token', domain: '.opencaselist.com', value: 'private-test-cookie', expirationDate: Date.now() / 1000 + 1000 }];
  cookies.get = async () => stored;
  cookies.flushStore = async () => { };
  const session = {
    cookies,
    clearStorageData: async () => { stored = []; },
    fetch: async (url, init) => { requests.push({ url, init }); return options.response ? options.response(url, init) : json([]); },
  };
  const dialog = {
    showMessageBox: async (_win, value) => { confirmations.push(value); return { response: options.confirm ?? 1 }; },
    showOpenDialog: async () => ({ canceled: !options.upload, filePaths: options.upload ? [options.upload] : [] }),
    showSaveDialog: async () => ({ canceled: !options.target, filePath: options.target }),
  };
  const serviceOptions = {
    session, dialog, getWindow: () => ({}), getVaultRoot: () => options.root, BrowserWindow: options.BrowserWindow,
    readConfig: () => config, writeConfig: (patch) => { config = { ...config, ...patch }; }, now: () => clock,
  };
  const service = createOpenCaselist(serviceOptions);
  return {
    service, session, requests, confirmations, setCookies: (next) => { stored = next; },
    getConfig: () => config, advance: (ms) => { clock += ms; }, restart: () => createOpenCaselist(serviceOptions),
  };
}
async function temporary(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-opencaselist-unit-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('session status never exposes cookies and honors expiry and logout', async () => {
  const mock = setup();
  assert.deepEqual(Object.keys(await mock.service.status()).sort(), ['expiresAt', 'signedIn']);
  assert.equal((await mock.service.status()).signedIn, true);
  mock.setCookies([{ value: 'old', expirationDate: Date.now() / 1000 - 1 }]);
  assert.equal((await mock.service.status()).signedIn, false);
  await assert.rejects(mock.service.list('caselists'), /Sign in again/);
  assert.equal(mock.requests.length, 0);
  await mock.service.logout();
  assert.equal((await mock.service.status()).signedIn, false);
});

test('authenticated API requests use only fixed HTTPS endpoints and the isolated cookie jar', async () => {
  const mock = setup({ response: () => json([{ name: 'Team', round_id: 1, path: 'ndt2026/School/AB' }]) });
  await mock.service.list('rounds', selection);
  await mock.service.search('ndt2026', 'evidence & schools');
  assert.equal(mock.requests[0].url, 'https://api.opencaselist.com/v1/caselists/ndt2026/schools/School/teams/AB/rounds');
  assert.equal(mock.requests[0].init.credentials, 'include');
  assert.equal(mock.requests[0].init.redirect, 'error');
  assert.equal(mock.requests[0].init.headers, undefined);
  assert.ok(mock.requests[1].url.includes('q=evidence+%26+schools'));
  await assert.rejects(mock.service.list('arbitrary-url'), /Invalid/);
  assert.throws(() => teamRoute({ ...selection, school: '..' }), /Invalid/);
  assert.throws(() => teamRoute({ ...selection, school: '../private' }), /Invalid/);
  assert.throws(() => roundData({ ...round, tournament: '' }), /Invalid/);
});

test('401 requires sign-in without retrying, while 403 preserves authentication', async () => {
  for (const status of [401, 403]) {
    const mock = setup({ response: () => json({ message: 'Denied' }, status) });
    await assert.rejects(mock.service.list('caselists'), status === 401 ? /expired/ : /trusted status/);
    assert.equal(mock.requests.length, 1);
    assert.equal((await mock.service.status()).signedIn, status === 403);
  }
});

test('signing in again during a cookie lookup cancels requests from the previous session', async () => {
  class LoginWindow extends EventEmitter {
    constructor() { super(); this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = () => { }; }
    async loadURL() {
      const cookie = { name: 'caselist_token', domain: '.opencaselist.com', value: 'new-session' };
      mock.setCookies([cookie]);
      mock.session.cookies.emit('changed', {}, cookie, 'explicit', false);
    }
    close() { this.emit('closed'); }
  }
  const mock = setup({ BrowserWindow: LoginWindow });
  const getCookies = mock.session.cookies.get;
  const cookieSnapshot = await mock.session.cookies.get();
  let finishLookup;
  mock.session.cookies.get = () => new Promise((resolve) => { finishLookup = resolve; });
  const pending = mock.service.list('rounds', selection);
  mock.session.cookies.get = getCookies;
  await mock.service.login();
  finishLookup(cookieSnapshot);
  await assert.rejects(pending, /session changed/);
  assert.equal(mock.requests.length, 0);
});

test('network failures and malformed responses surface errors without credential leakage or automatic writes', async () => {
  const network = setup({ response: () => { throw new Error('private-test-cookie'); } });
  await assert.rejects(network.service.write('create-round', selection, round),
    (error) => /Check your connection/.test(error.message) && !error.message.includes('private-test-cookie'));
  assert.equal(network.requests.length, 1);
  const invalid = setup({ response: () => new Response('<html>Not JSON</html>') });
  await assert.rejects(invalid.service.list('caselists'), /invalid response/);
  const wrongShape = setup({ response: () => json({ unexpected: true }) });
  await assert.rejects(wrongShape.service.list('caselists'), /invalid list/);
});

test('round and citation changes require confirmation and preserve existing attachments', async () => {
  const cancelled = setup({ confirm: 0 });
  assert.deepEqual(await cancelled.service.write('delete-round', { ...selection, round: 1 }), { cancelled: true });
  assert.equal(cancelled.requests.length, 0);
  assert.equal(cancelled.confirmations[0].defaultId, 0);
  const mock = setup({ response: (_url, init) => init.method === 'GET' ? json({ ...round, opensource: 'existing.docx' }) : json({ message: 'Saved' }) });
  await mock.service.write('update-round', { ...selection, round: 10 }, { ...round, opensource: 'injected.docx', password: 'ignored' });
  assert.equal(mock.requests.length, 2);
  const body = JSON.parse(mock.requests[1].init.body);
  assert.equal(body.opensource, 'existing.docx');
  assert.equal(body.password, undefined);
  assert.equal(mock.requests[1].init.method, 'PUT');
  await mock.service.write('create-cite', selection, { round_id: 10, title: 'Evidence', cites: 'Cite text' });
  assert.deepEqual(JSON.parse(mock.requests.at(-1).init.body), { round_id: 10, title: 'Evidence', cites: 'Cite text' });
  await assert.rejects(mock.service.write('delete-round', { ...selection, round: '../delete' }), /Invalid/);
});

test('write protection defaults off and stores only a randomly salted PBKDF2 hash', async () => {
  const mock = setup();
  assert.deepEqual(mock.service.writePasswordStatus(), { enabled: false, passwordSet: false, unlocked: true });
  await mock.service.write('create-round', selection, round);
  await mock.service.configureWritePassword(true, 'tournament password');
  const config = mock.getConfig();
  assert.equal(config.opencaselistRequirePasswordForWrites, true);
  assert.match(config.opencaselistWritePassword.salt, /^[a-f0-9]{32}$/);
  assert.match(config.opencaselistWritePassword.hash, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(config).includes('tournament password'));
  const { pbkdf2Sync } = require('node:crypto');
  assert.equal(config.opencaselistWritePassword.hash,
    pbkdf2Sync('tournament password', config.opencaselistWritePassword.salt, 600000, 32, 'sha256').toString('hex'));
  const previous = config.opencaselistWritePassword;
  await mock.service.configureWritePassword(true, 'tournament password', 'tournament password');
  assert.notEqual(mock.getConfig().opencaselistWritePassword.salt, previous.salt);
});

test('all round, citation and upload writes are guarded in the main process, but reads are not', async () => {
  const mock = setup();
  await mock.service.configureWritePassword(true, 'tournament password');
  for (const action of ['create-round', 'update-round', 'delete-round', 'create-cite', 'delete-cite']) {
    await assert.rejects(mock.service.write(action, selection, round), /password required/);
  }
  await assert.rejects(mock.service.upload(selection, round), /password required/);
  assert.equal(mock.confirmations.length, 0);
  assert.equal(mock.requests.length, 0);
  await mock.service.list('rounds', selection);
  await mock.service.search('ndt2026', 'evidence');
  assert.equal(mock.requests.length, 2);
  await assert.rejects(mock.service.verifyWritePassword('wrong'), /Incorrect/);
  assert.equal(mock.service.writePasswordStatus().unlocked, false);
  await mock.service.verifyWritePassword('tournament password');
  await mock.service.write('create-round', selection, round);
  assert.equal(mock.requests.at(-1).init.method, 'POST');
  assert.ok(!mock.requests.at(-1).init.body.includes('tournament password'));
});

test('write unlock lasts for 30 minutes of write activity and is not persisted across restart or logout', async () => {
  const mock = setup();
  await mock.service.configureWritePassword(true, 'tournament password');
  await mock.service.verifyWritePassword('tournament password');
  mock.advance(29 * 60 * 1000);
  await mock.service.write('create-round', selection, round);
  mock.advance(29 * 60 * 1000);
  assert.equal(mock.service.writePasswordStatus().unlocked, true);
  assert.equal(mock.restart().writePasswordStatus().unlocked, false);
  await mock.service.list('rounds', selection);
  mock.advance(60 * 1000);
  await assert.rejects(mock.service.write('delete-round', { ...selection, round: 1 }), /password required/);
  await mock.service.verifyWritePassword('tournament password');
  await mock.service.logout();
  assert.equal(mock.service.writePasswordStatus().unlocked, false);
});

test('changing or disabling protection always requires the current password and relocks writes', async () => {
  const mock = setup();
  await mock.service.configureWritePassword(true, 'first password');
  await mock.service.verifyWritePassword('first password');
  await assert.rejects(mock.service.configureWritePassword(false), /Invalid write password/);
  await assert.rejects(mock.service.configureWritePassword(false, undefined, 'wrong'), /Incorrect/);
  await assert.rejects(mock.service.configureWritePassword(true, 'replacement', 'wrong'), /Incorrect/);
  await assert.rejects(mock.service.configureWritePassword(true, '', 'first password'), /Invalid new/);
  assert.equal(mock.getConfig().opencaselistRequirePasswordForWrites, true);
  await mock.service.configureWritePassword(true, 'replacement', 'first password');
  assert.equal(mock.service.writePasswordStatus().unlocked, false);
  await assert.rejects(mock.service.verifyWritePassword('first password'), /Incorrect/);
  await mock.service.configureWritePassword(false, undefined, 'replacement');
  await mock.service.write('create-round', selection, round);
  await assert.rejects(mock.service.configureWritePassword(true, undefined, 'wrong'), /Incorrect/);
});

test('enabled protection without a password fails closed and can be configured in Settings', async () => {
  const mock = setup({ config: { opencaselistRequirePasswordForWrites: true } });
  await assert.rejects(mock.service.write('create-round', selection, round), /Settings > Integrations/);
  await assert.rejects(mock.service.upload(selection, round), /Settings > Integrations/);
  await assert.rejects(mock.service.verifyWritePassword('anything'), /Settings > Integrations/);
  await mock.service.list('rounds', selection);
  await mock.service.configureWritePassword(true, 'new password');
  await mock.service.verifyWritePassword('new password');
  await mock.service.write('create-round', selection, round);
  await assert.rejects(setup().service.configureWritePassword(true), /Set a password/);
});

test('password authorization cannot outlive a configuration or session change during hashing', async () => {
  const mock = setup();
  await mock.service.configureWritePassword(true, 'tournament password');
  const pending = mock.service.verifyWritePassword('tournament password');
  await mock.service.logout();
  await assert.rejects(pending, /session changed/);
  assert.equal(mock.service.writePasswordStatus().unlocked, false);
});

test('write authorization is checked again after confirmation, immediately before sending', async () => {
  const mock = setup();
  await mock.service.configureWritePassword(true, 'tournament password');
  await mock.service.verifyWritePassword('tournament password');
  mock.session.cookies.get = async () => {
    mock.advance(30 * 60 * 1000);
    return [{ value: 'valid-session' }];
  };
  await assert.rejects(mock.service.write('create-round', selection, round), /password required/);
  assert.equal(mock.requests.length, 0);
});

test('uploads publish only a user-selected DOCX after confirmation using verified base64 fields', async (t) => {
  const dir = await temporary(t);
  const file = path.join(dir, 'Disclosure.docx');
  await fs.writeFile(file, Buffer.from([0, 1, 2, 255]));
  const mock = setup({ upload: file });
  await mock.service.upload(selection, round);
  const body = JSON.parse(mock.requests[0].init.body);
  assert.equal(body.filename, 'Disclosure.docx');
  assert.deepEqual(Buffer.from(body.opensource, 'base64'), Buffer.from([0, 1, 2, 255]));
  assert.deepEqual(body.cites, []);
  const cancel = setup({ upload: file, confirm: 0 });
  assert.deepEqual(await cancel.service.upload(selection, round), { cancelled: true });
  assert.equal(cancel.requests.length, 0);
  const invalid = setup({ upload: path.join(dir, 'danger.exe') });
  await fs.writeFile(path.join(dir, 'danger.exe'), 'Not a disclosure');
  await assert.rejects(invalid.service.upload(selection, round), /Choose a DOCX/);
});

test('downloads stay inside the vault, never overwrite and preserve exact binary bytes', async (t) => {
  const root = await temporary(t);
  const bytes = Buffer.from([0, 255, 11, 22]);
  const target = path.join(root, 'Evidence.docx');
  const mock = setup({ root, target, response: () => new Response(bytes) });
  assert.deepEqual(await mock.service.download('caselist/Evidence.docx'), { path: 'Evidence.docx' });
  assert.deepEqual(await fs.readFile(target), bytes);
  await assert.rejects(mock.service.download('caselist/Evidence.docx'), /already exists/);
  assert.equal(mock.requests.length, 1);
  const outside = setup({ root, target: path.join(path.dirname(root), 'outside.docx') });
  await assert.rejects(outside.service.download('file.docx'), /inside the current vault/);
  assert.equal(outside.requests.length, 0);
  const executable = setup({ root, target: path.join(root, 'danger.exe') });
  await assert.rejects(executable.service.download('danger.exe'), /Unsupported/);
  await assert.rejects(setup().service.download('file.docx'), /Open a vault/);
});

test('download containment rejects symlinked folders', async (t) => {
  const root = await temporary(t);
  const outside = await temporary(t);
  await fs.symlink(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  const mock = setup({ root, target: path.join(root, 'link', 'Evidence.docx') });
  await assert.rejects(mock.service.download('Evidence.docx'), /inside the current vault/);
  assert.equal(mock.requests.length, 0);
});

test('response limits apply while streaming even when Content-Length is absent', async () => {
  await assert.rejects(responseBytes(new Response('12345'), 4), /too large/);
  await assert.rejects(responseBytes(new Response('1', { headers: { 'Content-Length': '100' } }), 4), /too large/);
});

test('login uses an isolated sandbox with no preload and blocks off-site navigation', async () => {
  const windows = [];
  class LoginWindow extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = (fn) => { this.popup = fn; }; windows.push(this); }
    async loadURL(url) { this.url = url; }
    close() { this.emit('closed'); }
    focus() { }
  }
  const mock = setup({ BrowserWindow: LoginWindow });
  const login = mock.service.login();
  await new Promise((resolve) => setImmediate(resolve));
  const win = windows[0];
  assert.equal(win.url, 'https://opencaselist.com/login');
  assert.equal(win.options.webPreferences.session, mock.session);
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.options.webPreferences.preload, undefined);
  let prevented = false;
  win.webContents.emit('will-navigate', { preventDefault: () => { prevented = true; } }, 'https://evil.test');
  assert.equal(prevented, true);
  assert.deepEqual(win.popup({ url: 'https://evil.test' }), { action: 'deny' });
  await assert.rejects(mock.service.login(), /already open/);
  assert.equal((await mock.session.cookies.get()).length, 0, 'Sign-in clears rejected tokens so the official login form can open');
  mock.setCookies([{ name: 'caselist_token', domain: '.opencaselist.com', value: 'new-private-token' }]);
  mock.session.cookies.emit('changed', {}, { name: 'caselist_token', domain: '.opencaselist.com', value: 'private' }, 'explicit', false);
  assert.equal((await login).signedIn, true);
  assert.equal(mock.session.cookies.listenerCount('changed'), 0);
});

test('cancelling or failing sign-in cleans up listeners without retaining a rejected cookie', async () => {
  for (const cancelled of [true, false]) {
    class LoginWindow extends EventEmitter {
      constructor() { super(); this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = () => { }; }
      async loadURL() { if (cancelled) this.close(); throw new Error('Navigation aborted'); }
      close() { this.emit('closed'); }
    }
    const mock = setup({ BrowserWindow: LoginWindow });
    if (cancelled) assert.equal((await mock.service.login()).signedIn, false);
    else await assert.rejects(mock.service.login(), /could not open/);
    assert.equal(mock.session.cookies.listenerCount('changed'), 0);
    assert.equal((await mock.service.status()).signedIn, false);
  }
});

test('logging out invalidates in-flight API responses', async () => {
  let complete;
  const mock = setup({ response: () => new Promise((resolve) => { complete = resolve; }) });
  const request = mock.service.list('caselists');
  await new Promise((resolve) => setImmediate(resolve));
  await mock.service.logout();
  complete(json([{ slug: 'ndt2026' }]));
  await assert.rejects(request, /session changed/);
  assert.equal(mock.requests.length, 1);
});

test('OpenCaselist IPC is lazy and rejects extensions, subframes and other windows', async () => {
  const handlers = {};
  let created = false;
  const win = { webContents: { mainFrame: {} } };
  registerOpenCaselist({
    ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; } },
    session: { fromPartition: () => { created = true; throw new Error('Should not initialize'); } },
    getWindow: () => win,
  });
  assert.equal(PARTITION, 'persist:opencaselist');
  assert.equal(created, false);
  for (const event of [{ sender: {} }, { sender: win.webContents, senderFrame: {} }]) {
    assert.throws(() => handlers['opencaselist:status'](event), /only available to the application/);
  }
  assert.equal(created, false);
});
