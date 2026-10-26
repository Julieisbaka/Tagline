const fs = require('node:fs/promises');

const ORIGIN = 'https://www.tabroom.com';
const PARTITION = 'persist:tabroom';
const MAX_JSON = 32 * 1024 * 1024;
const PAGE_SIZE = 20000;

function tournamentId(value) {
  let id = typeof value === 'number' ? String(value) : value;
  if (typeof id !== 'string' || id.length > 2048) throw new Error('Enter a valid Tabroom tournament ID or URL.');
  id = id.trim();
  if (!/^\d+$/.test(id)) {
    let url;
    try { url = new URL(id); }
    catch { throw new Error('Enter a valid Tabroom tournament ID or URL.'); }
    if (url.origin !== ORIGIN || url.username || url.password || url.searchParams.getAll('tourn_id').length !== 1)
      throw new Error('Use an https://www.tabroom.com URL with one tourn_id.');
    id = url.searchParams.get('tourn_id');
  }
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1)
    throw new Error('Enter a valid Tabroom tournament ID.');
  return String(Number(id));
}

function createTabroom({ session, BrowserWindow, dialog, getWindow }) {
  let loginWindow;
  let generation = 0;
  let cached;
  const invalidate = () => { generation++; cached = undefined; };
  const unchanged = (started) => {
    if (started !== generation) throw new Error('Tabroom session or tournament changed. Load the tournament again.');
  };
  const status = async () => {
    const cookies = await session.cookies.get({ url: ORIGIN });
    return { hasSession: cookies.some((cookie) => cookie.value &&
      (!cookie.expirationDate || cookie.expirationDate * 1000 > Date.now())) };
  };
  const login = async () => {
    if (loginWindow) { loginWindow.focus(); throw new Error('Tabroom sign-in is already open.'); }
    invalidate();
    const win = new BrowserWindow({
      title: 'Sign in to Tabroom - close this window when finished', width: 900, height: 760,
      parent: getWindow(), modal: true, autoHideMenuBar: true,
      webPreferences: { session, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
    });
    loginWindow = win;
    const guard = (event, target) => {
      let allowed = false;
      try {
        const url = new URL(target);
        allowed = url.origin === ORIGIN && !url.username && !url.password;
      } catch { /* Invalid navigation targets are blocked. */ }
      if (!allowed) event.preventDefault();
    };
    win.webContents.on('will-navigate', guard);
    win.webContents.on('will-redirect', guard);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const closed = new Promise((resolve) => win.once('closed', () => { loginWindow = undefined; resolve(); }));
    try { await win.loadURL(`${ORIGIN}/user/login/login.mhtml`); }
    catch (error) {
      if (loginWindow === win) win.close();
      await closed;
      throw new Error(`Tabroom sign-in could not open: ${error.message}`);
    }
    await closed;
    await session.cookies.flushStore();
    return status();
  };
  const logout = async () => {
    invalidate();
    loginWindow?.close();
    await session.clearStorageData();
    await session.cookies.flushStore();
    return status();
  };
  const load = async (value) => {
    const id = tournamentId(value);
    invalidate();
    const started = generation;
    let response;
    try {
      response = await session.fetch(`${ORIGIN}/api/download_data.mhtml?tourn_id=${id}`, {
        method: 'GET', credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(60000),
      });
    } catch (error) { throw new Error(`Tabroom request failed: ${error.message}`); }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403)
        throw new Error('Tabroom denied access. Sign in and check your tournament permissions.');
      throw new Error(`Tabroom request failed (${response.status}).`);
    }
    if (Number(response.headers.get('content-length')) > MAX_JSON) {
      await response.body?.cancel();
      throw new Error('Tabroom response exceeds the 32 MiB limit.');
    }
    const chunks = [];
    let size = 0;
    if (!response.body) throw new Error('Tabroom returned an empty response.');
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > MAX_JSON) throw new Error('Tabroom response exceeds the 32 MiB limit.');
      chunks.push(Buffer.from(chunk));
    }
    unchanged(started);
    const bytes = Buffer.concat(chunks);
    let data;
    try { data = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); }
    catch { throw new Error('Tabroom did not return valid JSON. Check the tournament ID or sign in again.'); }
    if (!data || typeof data !== 'object' || Array.isArray(data) || String(data.id) !== id)
      throw new Error('Tabroom returned unexpected tournament data.');
    const formatted = JSON.stringify(data, null, 2);
    cached = { id, bytes, formatted };
    return {
      id, name: typeof data.name === 'string' ? data.name : '',
      start: typeof data.start === 'string' ? data.start : '',
      end: typeof data.end === 'string' ? data.end : '',
      bytes: size, pages: Math.ceil(formatted.length / PAGE_SIZE),
      sections: Object.entries(data).filter(([, item]) => Array.isArray(item))
        .map(([name, items]) => ({ name, count: items.length })),
      preview: formatted.slice(0, PAGE_SIZE),
    };
  };
  const page = (id, index) => {
    if (!cached || tournamentId(id) !== cached.id) throw new Error('Load the tournament again.');
    if (!Number.isSafeInteger(index) || index < 0 || index * PAGE_SIZE >= cached.formatted.length)
      throw new Error('Invalid Tabroom data page.');
    return cached.formatted.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE);
  };
  const download = async (value) => {
    const id = tournamentId(value);
    if (!cached || cached.id !== id) throw new Error('Load the tournament before saving its JSON.');
    const started = generation;
    const snapshot = cached;
    const result = await dialog.showSaveDialog(getWindow(), {
      title: 'Save Tabroom tournament JSON', defaultPath: `tabroom-${id}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled) return { cancelled: true };
    unchanged(started);
    if (!result.filePath) throw new Error('Choose a destination for the Tabroom JSON.');
    await fs.writeFile(result.filePath, snapshot.bytes, { mode: 0o600 });
    return { path: result.filePath };
  };
  return { status, login, logout, load, page, download };
}

function registerTabroom({ ipcMain, session, BrowserWindow, dialog, getWindow }) {
  let service;
  for (const action of ['status', 'login', 'logout', 'load', 'page', 'download']) {
    ipcMain.handle(`tabroom:${action}`, (event, ...args) => {
      if (event.sender !== getWindow()?.webContents || event.senderFrame !== event.sender.mainFrame)
        throw new Error('Tabroom is only available to the application.');
      if (!service) {
        const isolated = session.fromPartition(PARTITION);
        isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        isolated.setPermissionCheckHandler(() => false);
        isolated.setDevicePermissionHandler(() => false);
        isolated.on('will-download', (downloadEvent) => downloadEvent.preventDefault());
        service = createTabroom({ session: isolated, BrowserWindow, dialog, getWindow });
      }
      return service[action](...args);
    });
  }
}

module.exports = { createTabroom, registerTabroom, tournamentId, PARTITION };
