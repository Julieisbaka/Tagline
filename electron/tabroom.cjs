const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { snapshotRecords } = require('./tabroomData.cjs');
const { ORIGIN, tournamentId } = require('./tabroomId.cjs');

const PARTITION = 'persist:tabroom';
const MAX_JSON = 32 * 1024 * 1024;
const PAGE_SIZE = 20000;
const JSON_SNAPSHOT_LIMIT = 4;

function transferableBuffer(buffer) {
  return buffer.byteOffset === 0 && buffer.byteLength === buffer.buffer.byteLength
    ? buffer.buffer
    : Uint8Array.from(buffer).buffer;
}

function parseInWorker(mode, input, id) {
  const worker = new Worker(path.join(__dirname, 'tabroomWorker.cjs'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
      callback(value);
    };
    const onMessage = (result) =>
      result.error ? finish(reject, new Error(result.error)) : finish(resolve, result);
    const onError = (error) => finish(reject, error);
    const onExit = (code) =>
      finish(reject, new Error(`Tabroom worker exited before responding (${code}).`));
    worker.once('message', onMessage);
    worker.once('error', onError);
    worker.once('exit', onExit);
    worker.postMessage({ mode, input, id }, [input]);
  }).finally(() => worker.terminate().catch(() => {}));
}

function createTabroom({ session, BrowserWindow, dialog, getWindow }) {
  let loginWindow;
  let generation = 0;
  let cached;
  const jsonSnapshots = new Map();
  const invalidate = () => {
    generation++;
    cached = undefined;
  };
  const unchanged = (started) => {
    if (started !== generation) {
      throw new Error('Tabroom session or tournament changed. Load the tournament again.');
    }
  };
  const status = async () => {
    const cookies = await session.cookies.get({ url: ORIGIN });
    return {
      hasSession: cookies.some(
        (cookie) =>
          cookie.value && (!cookie.expirationDate || cookie.expirationDate * 1000 > Date.now())
      ),
    };
  };
  const login = async () => {
    if (loginWindow) {
      loginWindow.focus();
      throw new Error('Tabroom sign-in is already open.');
    }
    invalidate();
    const win = new BrowserWindow({
      title: 'Sign in to Tabroom - close this window when finished',
      width: 900,
      height: 760,
      parent: getWindow(),
      modal: true,
      autoHideMenuBar: true,
      webPreferences: {
        session,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    loginWindow = win;
    const guard = (event, target) => {
      let allowed = false;
      try {
        const url = new URL(target);
        allowed = url.origin === ORIGIN && !url.username && !url.password;
      } catch {
        /* Invalid navigation targets are blocked. */
      }
      if (!allowed) {
        event.preventDefault();
      }
    };
    win.webContents.on('will-navigate', guard);
    win.webContents.on('will-redirect', guard);
    win.webContents.on('will-prevent-unload', (event) => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const closed = new Promise((resolve) =>
      win.once('closed', () => {
        loginWindow = undefined;
        resolve();
      })
    );
    try {
      await win.loadURL(`${ORIGIN}/user/login/login.mhtml`);
    } catch (error) {
      if (loginWindow === win) {
        win.close();
      }
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
        method: 'GET',
        credentials: 'include',
        redirect: 'error',
        signal: AbortSignal.timeout(60000),
      });
    } catch (error) {
      throw new Error(`Tabroom request failed: ${error.message}`);
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) {
        throw new Error('Tabroom denied access. Sign in and check your tournament permissions.');
      }
      throw new Error(`Tabroom request failed (${response.status}).`);
    }
    if (Number(response.headers.get('content-length')) > MAX_JSON) {
      await response.body?.cancel();
      throw new Error('Tabroom response exceeds the 32 MiB limit.');
    }
    const chunks = [];
    let size = 0;
    if (!response.body) {
      throw new Error('Tabroom returned an empty response.');
    }
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > MAX_JSON) {
        throw new Error('Tabroom response exceeds the 32 MiB limit.');
      }
      chunks.push(Buffer.from(chunk));
    }
    unchanged(started);
    let bytes = Buffer.concat(chunks);
    chunks.length = 0;
    const input = transferableBuffer(bytes);
    bytes = null;
    const result = await parseInWorker('network', input, id);
    unchanged(started);
    cached = {
      id,
      bytes: Buffer.from(result.raw),
      formatted: result.formatted,
      snapshot: result.snapshot,
    };
    return result.summary;
  };
  const records = (id, kind, index, query) => {
    if (!cached || tournamentId(id) !== cached.id) {
      throw new Error('Load the tournament again.');
    }
    return snapshotRecords(cached.snapshot, kind, index, query);
  };
  const openJson = async (source) => {
    if (typeof source !== 'string') {
      throw new Error('Tournament JSON must be a string no larger than 32 MiB.');
    }
    let bytes = Buffer.from(source, 'utf8');
    source = '';
    if (bytes.byteLength > MAX_JSON) {
      throw new Error('Tournament JSON must be a string no larger than 32 MiB.');
    }
    const input = transferableBuffer(bytes);
    bytes = null;
    const { summary, snapshot } = await parseInWorker('file', input);
    const token = randomUUID();
    jsonSnapshots.set(token, { id: summary.id, snapshot });
    while (jsonSnapshots.size > JSON_SNAPSHOT_LIMIT) {
      jsonSnapshots.delete(jsonSnapshots.keys().next().value);
    }
    return { ...summary, token };
  };
  const snapshotRecordsForJson = (token, kind, index, query) => {
    const entry = jsonSnapshots.get(token);
    if (!entry) {
      throw new Error('Tournament JSON data expired. Reopen the file.');
    }
    return snapshotRecords(entry.snapshot, kind, index, query);
  };
  const page = (id, index) => {
    if (!cached || tournamentId(id) !== cached.id) {
      throw new Error('Load the tournament again.');
    }
    if (!Number.isSafeInteger(index) || index < 0 || index * PAGE_SIZE >= cached.formatted.length) {
      throw new Error('Invalid Tabroom data page.');
    }
    return cached.formatted.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE);
  };
  const download = async (value) => {
    const id = tournamentId(value);
    if (!cached || cached.id !== id) {
      throw new Error('Load the tournament before saving its JSON.');
    }
    const started = generation;
    const snapshot = cached;
    const result = await dialog.showSaveDialog(getWindow(), {
      title: 'Save Tabroom tournament JSON',
      defaultPath: `tabroom-${id}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled) {
      return { cancelled: true };
    }
    unchanged(started);
    if (!result.filePath) {
      throw new Error('Choose a destination for the Tabroom JSON.');
    }
    await fs.writeFile(result.filePath, snapshot.bytes, { mode: 0o600 });
    return { path: result.filePath };
  };
  return { status, login, logout, load, page, records, openJson, snapshotRecordsForJson, download };
}

function registerTabroom({ ipcMain, session, BrowserWindow, dialog, getWindow }) {
  let service;
  for (const action of [
    'status',
    'login',
    'logout',
    'load',
    'page',
    'records',
    'openJson',
    'snapshotRecordsForJson',
    'download',
  ]) {
    ipcMain.handle(`tabroom:${action}`, (event, ...args) => {
      if (
        event.sender !== getWindow()?.webContents ||
        event.senderFrame !== event.sender.mainFrame
      ) {
        throw new Error('Tabroom is only available to the application.');
      }
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
