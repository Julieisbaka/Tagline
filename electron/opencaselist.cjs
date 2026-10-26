const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const defaults = require('../src/lib/defaultSettings.json');
const { resolveCaselistTeam } = require('./tabroomCaselist.cjs');

const pbkdf2 = promisify(crypto.pbkdf2);
const PASSWORD_ITERATIONS = 600000;
const WRITE_TIMEOUT = 30 * 60 * 1000;

const ORIGIN = 'https://opencaselist.com';
const API = 'https://api.opencaselist.com/v1';
const PARTITION = 'persist:opencaselist';
const MAX_FILE = 50 * 1024 * 1024;
const MAX_JSON = 8 * 1024 * 1024;

function text(value, label, max = 255, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || value.includes('\0'))
    throw new Error(`Invalid ${label}.`);
  return value;
}

function segment(value) {
  text(value, 'OpenCaselist path');
  if (value === '.' || value === '..' || /[\\/]/.test(value)) throw new Error('Invalid OpenCaselist path.');
  return encodeURIComponent(value);
}

function id(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid disclosure ID.');
  return value;
}

function teamRoute(selection) {
  if (!selection || typeof selection !== 'object') throw new Error('Select an OpenCaselist team.');
  return `/caselists/${segment(selection.caselist)}/schools/${segment(selection.school)}/teams/${segment(selection.team)}`;
}

function roundData(value) {
  if (!value || typeof value !== 'object') throw new Error('Invalid round.');
  const result = {};
  for (const key of ['tournament', 'side', 'round']) result[key] = text(value[key], key);
  for (const key of ['opponent', 'judge', 'report', 'video'])
    if (value[key] !== undefined) result[key] = value[key] === null ? null : text(value[key], key, key === 'report' ? 100000 : 2048, false);
  for (const key of ['tourn_id', 'external_id'])
    if (value[key] !== undefined) result[key] = value[key] === null ? null : id(value[key]);
  return result;
}

async function responseBytes(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new Error('OpenCaselist response is too large.');
  }
  const chunks = [];
  let length = 0;
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error('OpenCaselist response is too large.');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function createOpenCaselist({ session, BrowserWindow, dialog, getWindow, getVaultRoot, readConfig = () => ({}), writeConfig, now = Date.now }) {
  let loginWindow;
  let loginOpening = false;
  let invalidSession = false;
  let generation = 0;
  let unlockedUntil = 0;
  const protection = () => {
    const config = readConfig();
    return {
      enabled: config.opencaselistRequirePasswordForWrites ?? defaults.opencaselistRequirePasswordForWrites,
      password: config.opencaselistWritePassword ?? defaults.opencaselistWritePassword,
    };
  };
  const writePasswordStatus = () => {
    const { enabled, password } = protection();
    return { enabled: !!enabled, passwordSet: !!password, unlocked: !enabled || (!!password && now() < unlockedUntil) };
  };
  const checkPassword = async (password, stored) => {
    text(password, 'write password', 1024);
    if (!stored || !/^[a-f0-9]{32}$/.test(stored.salt) || !/^[a-f0-9]{64}$/.test(stored.hash))
      throw new Error('Set an OpenCaselist write password in Settings > Integrations > OpenCaselist.');
    const hash = await pbkdf2(password, stored.salt, PASSWORD_ITERATIONS, 32, 'sha256');
    if (!crypto.timingSafeEqual(hash, Buffer.from(stored.hash, 'hex'))) throw new Error('Incorrect OpenCaselist write password.');
  };
  const unchanged = (before, started) => {
    if (generation !== started || JSON.stringify(protection()) !== JSON.stringify(before))
      throw new Error('OpenCaselist protection or session changed. Try again.');
  };
  const verifyWritePassword = async (password) => {
    const before = protection(), started = generation;
    await checkPassword(password, before.password);
    unchanged(before, started);
    unlockedUntil = now() + WRITE_TIMEOUT;
    return writePasswordStatus();
  };
  const configureWritePassword = async (enabled, password, currentPassword) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid write password setting.');
    const before = protection(), started = generation;
    if (before.password) await checkPassword(currentPassword, before.password);
    let stored = before.password;
    if (password !== undefined) {
      text(password, 'new write password', 1024);
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = (await pbkdf2(password, salt, PASSWORD_ITERATIONS, 32, 'sha256')).toString('hex');
      stored = { salt, hash };
    }
    if (enabled && !stored) throw new Error('Set a password before enabling OpenCaselist write protection.');
    unchanged(before, started);
    writeConfig({ opencaselistRequirePasswordForWrites: enabled, opencaselistWritePassword: stored });
    unlockedUntil = 0;
    return writePasswordStatus();
  };
  const requireWritePassword = (touch = false) => {
    const state = writePasswordStatus();
    if (!state.enabled) return;
    if (!state.passwordSet) throw new Error('Set an OpenCaselist write password in Settings > Integrations > OpenCaselist.');
    if (!state.unlocked) throw new Error('OpenCaselist write password required. Unlock write access and try again.');
    if (touch) unlockedUntil = now() + WRITE_TIMEOUT;
  };
  const status = async () => {
    const cookies = await session.cookies.get({ url: API, name: 'caselist_token' });
    const token = cookies.find((cookie) => cookie.value && (!cookie.expirationDate || cookie.expirationDate * 1000 > Date.now()));
    return { signedIn: !!token && !invalidSession, expiresAt: token?.expirationDate ? token.expirationDate * 1000 : null };
  };
  const logout = async () => {
    generation++;
    unlockedUntil = 0;
    invalidSession = true;
    loginWindow?.close();
    await session.clearStorageData();
    await session.cookies.flushStore();
    return status();
  };
  const login = async () => {
    if (loginOpening) { loginWindow?.focus(); throw new Error('OpenCaselist sign-in is already open.'); }
    loginOpening = true;
    unlockedUntil = 0;
    invalidSession = true;
    const attempt = ++generation;
    try {
      // The website treats any existing token as signed in, even after the API rejects it.
      await session.clearStorageData();
      if (generation !== attempt) throw new Error('OpenCaselist session changed. Try again.');
      const win = new BrowserWindow({
        title: 'Sign in to OpenCaselist', width: 900, height: 760, parent: getWindow(), modal: true,
        autoHideMenuBar: true,
        webPreferences: { session, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
      });
      loginWindow = win;
      let closed = false;
      const allowed = (url) => {
        const parsed = new URL(url);
        return parsed.origin === ORIGIN && !parsed.username && !parsed.password;
      };
      const guard = (event, url) => { if (!allowed(url)) event.preventDefault(); };
      win.webContents.on('will-navigate', guard);
      win.webContents.on('will-redirect', guard);
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      const done = new Promise((resolve, reject) => {
        const onCookie = (_event, cookie, _cause, removed) => {
          if (cookie.name === 'caselist_token' && cookie.domain.replace(/^\./, '') === 'opencaselist.com' && !removed && cookie.value) {
            invalidSession = false;
            generation++;
            win.close();
          }
        };
        session.cookies.on('changed', onCookie);
        win.once('closed', () => {
          closed = true;
          session.cookies.removeListener('changed', onCookie);
          loginWindow = null;
          session.cookies.flushStore().then(status).then(resolve, reject);
        });
      });
      try { await win.loadURL(`${ORIGIN}/login`); }
      catch (error) {
        if (closed) return await done;
        win.close();
        await done;
        throw new Error(`OpenCaselist sign-in could not open: ${error.message}`);
      }
      return await done;
    } finally { loginOpening = false; }
  };

  const request = async (route, { method = 'GET', body, binary = false } = {}) => {
    const started = generation;
    const current = await status();
    if (generation !== started) throw new Error('OpenCaselist session changed. Try again.');
    if (!current.signedIn) throw new Error('OpenCaselist session expired or missing. Sign in again.');
    if (method !== 'GET') requireWritePassword(true);
    let response;
    try {
      response = await session.fetch(`${API}${route}`, {
        method, credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(60000),
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new Error('OpenCaselist request failed. Check your connection. Before retrying a change, refresh to check whether it was saved.');
    }
    if (response.status === 401) {
      if (generation === started) { invalidSession = true; unlockedUntil = 0; }
      await response.body?.cancel();
      throw new Error('OpenCaselist session expired. Sign in again.');
    }
    if (response.status === 403) {
      await response.body?.cancel();
      throw new Error('OpenCaselist denied this action. Your account may need team access or trusted status.');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`OpenCaselist request failed (${response.status}). Refresh before retrying a change.`);
    }
    if (generation !== started) { await response.body?.cancel(); throw new Error('OpenCaselist session changed. Try again.'); }
    const bytes = await responseBytes(response, binary ? MAX_FILE : MAX_JSON);
    if (generation !== started) throw new Error('OpenCaselist session changed. Try again.');
    if (binary) return { bytes, headers: response.headers };
    if (!bytes.length) return null;
    let data;
    try { data = JSON.parse(bytes.toString('utf8')); }
    catch { throw new Error('OpenCaselist returned an invalid response.'); }
    return data;
  };
  const list = async (kind, selection = {}) => {
    let route;
    if (kind === 'caselists') route = '/caselists?archived=true';
    else if (kind === 'schools') route = `/caselists/${segment(selection.caselist)}/schools`;
    else if (kind === 'teams') route = `/caselists/${segment(selection.caselist)}/schools/${segment(selection.school)}/teams`;
    else if (kind === 'rounds' || kind === 'cites') route = `${teamRoute(selection)}/${kind}`;
    else throw new Error('Invalid OpenCaselist list.');
    const result = await request(route);
    const validItem = (item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      if (kind === 'rounds' || kind === 'cites')
        return Number.isSafeInteger(item[kind === 'rounds' ? 'round_id' : 'cite_id']) && item[kind === 'rounds' ? 'round_id' : 'cite_id'] > 0;
      return typeof item.name === 'string' && item.name.trim().length > 0;
    };
    if (!Array.isArray(result) || !result.every(validItem)) throw new Error('OpenCaselist returned an invalid list.');
    return result;
  };
  const search = async (caselist, query) => {
    const result = await request(`/search?${new URLSearchParams({ shard: text(caselist, 'caselist'), q: text(query, 'search query', 500) })}`);
    if (!Array.isArray(result) || result.some((item) => !item || typeof item !== 'object' || typeof item.path !== 'string'))
      throw new Error('OpenCaselist returned invalid search results.');
    return result;
  };
  const resolveTabroomTeam = async (caselist, team) => {
    const started = generation;
    const result = await resolveCaselistTeam({ caselist, team, list: async (...args) => {
      if (generation !== started) throw new Error('OpenCaselist session changed. Try again.');
      return list(...args);
    } });
    if (generation !== started) throw new Error('OpenCaselist session changed. Try again.');
    return {
      ...result,
      candidates: result.candidates.map((candidate) => ({
        ...candidate,
        url: `${ORIGIN}/${segment(candidate.selection.caselist)}/${segment(candidate.selection.school)}/${segment(candidate.selection.team)}`,
      })),
    };
  };
  const confirm = async (message, detail) => {
    const result = await dialog.showMessageBox(getWindow(), {
      type: 'warning', message, detail, buttons: ['Cancel', 'Publish change'], defaultId: 0, cancelId: 0, noLink: true,
    });
    return result.response === 1;
  };
  const write = async (action, selection, value) => {
    requireWritePassword();
    const base = teamRoute(selection);
    let route, method, body;
    if (action === 'create-round' || action === 'update-round') {
      body = roundData(value);
      route = `${base}/rounds${action === 'update-round' ? `/${id(selection.round)}` : ''}`;
      method = action === 'create-round' ? 'POST' : 'PUT';
      if (action === 'create-round') body.cites = [];
    } else if (action === 'delete-round') { route = `${base}/rounds/${id(selection.round)}`; method = 'DELETE'; }
    else if (action === 'create-cite') {
      route = `${base}/cites`; method = 'POST';
      body = { round_id: id(value?.round_id), title: text(value.title, 'citation title'), cites: text(value.cites, 'citations', 100000) };
    } else if (action === 'delete-cite') { route = `${base}/cites/${id(selection.cite)}`; method = 'DELETE'; }
    else throw new Error('Invalid OpenCaselist change.');
    if (!await confirm('Publish this change to OpenCaselist?',
      `${selection.caselist} / ${selection.school} / ${selection.team}\n${action}\n${body ? JSON.stringify(body, null, 2) : `ID: ${selection.round || selection.cite}`}`))
      return { cancelled: true };
    if (action === 'update-round') {
      const current = await request(route);
      if (!current || typeof current.opensource !== 'string' && current.opensource !== null && current.opensource !== undefined)
        throw new Error('OpenCaselist returned invalid round details.');
      body.opensource = current.opensource ?? null;
    }
    await request(route, { method, body });
    return { saved: true };
  };
  const upload = async (selection, value) => {
    requireWritePassword();
    const route = `${teamRoute(selection)}/rounds`;
    const body = roundData(value);
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Choose disclosure file to publish', properties: ['openFile'],
      filters: [{ name: 'Disclosure documents', extensions: ['docx'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { cancelled: true };
    const file = result.filePaths[0];
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_FILE || path.extname(file).toLowerCase() !== '.docx')
      throw new Error('Choose a DOCX disclosure file no larger than 50 MB.');
    const filename = path.basename(file).replace(/[^\w .-]/g, '-');
    if (!await confirm('Upload this disclosure to OpenCaselist?',
      `${selection.caselist} / ${selection.school} / ${selection.team}\n${filename}\n${body.tournament} / ${body.side} / ${body.round}\nThe selected file will be published. No vault files are uploaded automatically.`))
      return { cancelled: true };
    body.opensource = (await fs.readFile(file)).toString('base64');
    if (Buffer.byteLength(body.opensource, 'base64') > MAX_FILE) throw new Error('The disclosure file grew beyond 50 MB.');
    body.filename = filename;
    body.cites = [];
    await request(route, { method: 'POST', body });
    return { saved: true };
  };
  const download = async (remotePath) => {
    text(remotePath, 'download path', 2048);
    const root = getVaultRoot();
    if (!root) throw new Error('Open a vault before downloading disclosures.');
    const name = remotePath.split(/[\\/]/).at(-1).replace(/[<>:"|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '');
    if (!name || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
      throw new Error('Invalid disclosure filename.');
    const rootReal = await fs.realpath(root);
    const target = path.join(rootReal, name);
    const relative = path.relative(rootReal, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Save disclosures inside the current vault.');
    if (!['.docx', '.doc', '.pdf', '.rtf', '.txt', '.md', '.zip'].includes(path.extname(target).toLowerCase()))
      throw new Error('Unsupported disclosure file type.');
    try { await fs.lstat(target); throw new Error('That file already exists in the vault. Rename or move it before downloading again.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const { bytes } = await request(`/download?${new URLSearchParams({ path: remotePath })}`, { binary: true });
    if (getVaultRoot() !== root || await fs.realpath(root) !== rootReal)
      throw new Error('The vault changed. Download again in the current vault.');
    await fs.writeFile(target, bytes, { flag: 'wx' });
    return { path: relative.split(path.sep).join('/') };
  };
  return { status, login, logout, list, search, resolveTabroomTeam, write, upload, download, writePasswordStatus, verifyWritePassword, configureWritePassword };
}

function registerOpenCaselist({ ipcMain, session, BrowserWindow, dialog, getWindow, getVaultRoot, readConfig, writeConfig }) {
  let service;
  const getService = () => {
    if (!service) {
      const isolated = session.fromPartition(PARTITION);
      isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      isolated.setPermissionCheckHandler(() => false);
      isolated.setDevicePermissionHandler(() => false);
      isolated.on('will-download', (event) => event.preventDefault());
      service = createOpenCaselist({ session: isolated, BrowserWindow, dialog, getWindow, getVaultRoot, readConfig, writeConfig });
    }
    return service;
  };
  for (const action of ['status', 'login', 'logout', 'list', 'search', 'resolveTabroomTeam', 'write', 'upload', 'download',
    'writePasswordStatus', 'verifyWritePassword', 'configureWritePassword']) {
    ipcMain.handle(`opencaselist:${action}`, (event, ...args) => {
      if (event.sender !== getWindow()?.webContents || event.senderFrame !== event.sender.mainFrame)
        throw new Error('OpenCaselist is only available to the application.');
      return getService()[action](...args);
    });
  }
}

module.exports = { registerOpenCaselist, createOpenCaselist, roundData, teamRoute, responseBytes, PARTITION };
