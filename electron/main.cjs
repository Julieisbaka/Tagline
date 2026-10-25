const { app, BrowserWindow, ipcMain, dialog, shell, Menu, safeStorage, session } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fssync = require('fs');
const { randomUUID } = require('node:crypto');
const { SAMPLE_VAULT } = require('./sampleVault.cjs');
const { registerPandoc } = require('./pandoc.cjs');
const { registerEmbeddings } = require('./embeddings.cjs');
const { registerNli } = require('./nli.cjs');
const { registerSummarization } = require('./summarization.cjs');
const { registerDocuments } = require('./documents.cjs');
const { registerFonts } = require('./fonts.cjs');
const { registerExtensions } = require('./extensions.cjs');
const { extractCitation } = require('./citationMetadata.cjs');
const { registerFlowFiles } = require('./flowFiles.cjs');
const { registerBrowser } = require('./browser.cjs');
const { DEFAULT_RETENTION, createRevisionHistory } = require('./revisionHistory.cjs');
const { NOTE_EXTS, listVault: walk, readVaultSnapshot } = require('./vaultFiles.cjs');
const { installationInfo } = require('./installation.cjs');
const { uninstallApplication } = require('./uninstall.cjs');
const { registerOpenCaselist } = require('./opencaselist.cjs');
const keyDefinitions = require('../src/lib/keybindings.json');

const isDev = process.argv.includes('--dev');
// Keep profile and OS credential identity stable across versions and install locations.
app.setName('Tagline');
const configPath = () => path.join(app.getPath('userData'), 'config.json');

let win;
let vaultRoot = null;
let keybindings = {};
let closeWebsiteView = () => { };

function accelerator(id) {
  const value = keybindings[id] ?? keyDefinitions.find((item) => item.id === id)?.key;
  return value ? value.replace(/\bMod\b/g, 'CmdOrCtrl').replace(/\bMeta\b/g, 'Super') : undefined;
}

if (process.platform === 'win32') app.setAppUserModelId('app.tagline');
// Apps launched from Finder/Dock get a minimal PATH; add Homebrew and MacTeX so Pandoc and its PDF engines resolve.
if (process.platform === 'darwin') {
  const current = (process.env.PATH || '').split(':').filter(Boolean);
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', '/Library/TeX/texbin'].filter((p) => !current.includes(p));
  process.env.PATH = [...current, ...extra].join(':');
}

function readConfig() {
  try {
    return JSON.parse(fssync.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  fssync.mkdirSync(path.dirname(configPath()), { recursive: true });
  fssync.writeFileSync(configPath(), JSON.stringify(next, null, 2));
  return next;
}

// Resolve a vault-relative path and refuse anything that escapes the vault.
function resolveInVault(rel = '') {
  if (!vaultRoot) throw new Error('No vault open');
  const full = path.resolve(vaultRoot, rel);
  const relCheck = path.relative(vaultRoot, full);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    throw new Error('Path escapes vault: ' + rel);
  }
  return full;
}

const toPosix = (p) => p.split(path.sep).join('/');

function uniquePath(rel, folder = false, underscoreFolders = false) {
  const ext = folder ? '' : path.extname(rel);
  const stem = rel.slice(0, rel.length - ext.length);
  let candidate = rel;
  let i = 1;
  while (fssync.existsSync(resolveInVault(candidate))) candidate = `${stem}${underscoreFolders ? '_' : ' '}${i++}${ext}`;
  return candidate;
}

async function openVault(dir) {
  await fs.mkdir(dir, { recursive: true });
  vaultRoot = path.resolve(dir);
  const saved = readConfig().recentVaults;
  const key = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
  const recentVaults = [vaultRoot, ...(Array.isArray(saved) ? saved.filter((item) =>
    typeof item === 'string' && key(path.resolve(item)) !== key(vaultRoot)) : [])].slice(0, 20);
  writeConfig({ lastVault: vaultRoot, recentVaults });
  return { root: vaultRoot, name: path.basename(vaultRoot) };
}

async function listRecentVaults() {
  const config = readConfig();
  const candidates = [...(Array.isArray(config.recentVaults) ? config.recentVaults : []),
  ...(typeof config.lastVault === 'string' ? [config.lastVault] : [])];
  const key = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
  const unique = [...new Map(candidates.filter((item) => typeof item === 'string' && path.isAbsolute(item))
    .map((item) => [key(path.resolve(item)), path.resolve(item)])).values()].slice(0, 20);
  return Promise.all(unique.map(async (root) => {
    let exists = false;
    try { exists = (await fs.stat(root)).isDirectory(); }
    catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
    return { root, name: path.basename(root), exists };
  }));
}

function registerIpc() {
  ipcMain.handle('app:installation', () => installationInfo(app));
  ipcMain.handle('app:uninstall', async (_event, removeProfile) => {
    const result = await uninstallApplication({ app, shell, removeProfile });
    if (!result.manual) app.quit();
    return result;
  });
  const history = createRevisionHistory({
    getVaultRoot: () => vaultRoot,
    resolveInVault,
  });
  ipcMain.handle('pandoc:install', () => shell.openExternal('https://pandoc.org/installing.html'));
  ipcMain.handle('citation:extract', (_event, url) => extractCitation(url));
  ipcMain.handle('keybindings:set', (_event, overrides) => {
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides) ||
      Object.entries(overrides).some(([id, key]) => !(keyDefinitions.some((item) => item.id === id) ||
        /^ext:[a-z0-9][a-z0-9-]{1,63}\.[a-z0-9][a-z0-9-]{1,63}$/.test(id)) ||
        typeof key !== 'string' || (key !== '' && !/^(?:(?:Mod|Ctrl|Meta|Alt|Shift)\+)*(?:[A-Z0-9,.;/[\]'=\\`-]|F(?:[1-9]|1\d|2[0-4])|Enter|Tab|Space|Arrow(?:Up|Down|Left|Right)|Home|End|PageUp|PageDown|Escape)$/.test(key)))) {
      throw new Error('Invalid keyboard shortcut settings.');
    }
    keybindings = { ...overrides };
    buildMenu();
  });
  ipcMain.handle('vault:getLast', async () => {
    const { lastVault } = readConfig();
    if (lastVault && fssync.existsSync(lastVault)) return openVault(lastVault);
    return null;
  });

  ipcMain.handle('vault:listRecent', listRecentVaults);
  ipcMain.handle('vault:openRecent', async (_event, root) => {
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Invalid saved vault path.');
    const recent = await listRecentVaults();
    const key = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
    if (!recent?.some((item) => item.exists && key(item.root) === key(path.resolve(root)))) {
      throw new Error('That saved vault is unavailable. Choose its folder to add it again.');
    }
    return openVault(root);
  });
  ipcMain.handle('vault:forgetRecent', (_event, root) => {
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Invalid saved vault path.');
    const key = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
    const recent = readConfig().recentVaults;
    const recentVaults = (Array.isArray(recent) ? recent : [])
      .filter((item) => typeof item === 'string' && key(path.resolve(item)) !== key(path.resolve(root)));
    const config = readConfig();
    const lastVault = typeof config.lastVault === 'string' &&
      key(path.resolve(config.lastVault)) === key(path.resolve(root)) ? null : config.lastVault;
    writeConfig({ recentVaults, lastVault });
    return true;
  });
  ipcMain.handle('vault:revealRecent', async (_event, root) => {
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Invalid saved vault path.');
    const recent = await listRecentVaults();
    const key = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
    if (!recent?.some((item) => item.exists && key(item.root) === key(path.resolve(root)))) {
      throw new Error('That saved vault is unavailable.');
    }
    const error = await shell.openPath(root);
    if (error) throw new Error(error);
  });

  ipcMain.handle('vault:choose', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Open or create a vault folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return openVault(res.filePaths[0]);
  });

  ipcMain.handle('vault:createSample', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose a folder for the sample vault',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const info = await openVault(path.join(res.filePaths[0], 'Tagline Sample Vault'));
    for (const [rel, content] of Object.entries(SAMPLE_VAULT)) {
      const full = resolveInVault(rel);
      await fs.mkdir(path.dirname(full), { recursive: true });
      if (!fssync.existsSync(full)) await fs.writeFile(full, content, 'utf8');
    }
    return info;
  });

  ipcMain.handle('fs:list', async () => walk(resolveInVault('')));
  ipcMain.handle('fs:snapshot', async () => readVaultSnapshot(resolveInVault('')));
  ipcMain.handle('fs:readAll', async () => (await readVaultSnapshot(resolveInVault(''))).contents);

  ipcMain.handle('fs:read', async (_e, rel) => fs.readFile(resolveInVault(rel), 'utf8'));

  ipcMain.handle('fs:write', async (_e, rel, content, retention = DEFAULT_RETENTION, canvasMode = 'complete') => {
    const full = resolveInVault(rel);
    await history.snapshot(rel, content, retention, canvasMode);
    await fs.mkdir(path.dirname(full), { recursive: true });
    let mode;
    try { mode = (await fs.stat(full)).mode; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = path.join(path.dirname(full), `.tagline-save-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode });
      await fs.rename(temporary, full);
    } catch (error) {
      if (error.code !== 'EEXIST') await fs.rm(temporary, { force: true });
      throw error;
    }
    return true;
  });

  ipcMain.handle('fs:create', async (_e, rel, content = '') => {
    await fs.mkdir(path.dirname(resolveInVault(rel)), { recursive: true });
    while (true) {
      const finalRel = uniquePath(rel);
      try {
        await fs.writeFile(resolveInVault(finalRel), content, { encoding: 'utf8', flag: 'wx' });
        return toPosix(finalRel);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
  });

  ipcMain.handle('fs:mkdir', async (_e, rel, underscoreFolders) => {
    if (typeof underscoreFolders !== 'boolean') throw new Error('Invalid folder path preference.');
    await fs.mkdir(path.dirname(resolveInVault(rel)), { recursive: true });
    while (true) {
      const finalRel = uniquePath(rel, true, underscoreFolders);
      try {
        await fs.mkdir(resolveInVault(finalRel));
        return toPosix(finalRel);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
  });

  ipcMain.handle('fs:rename', async (_e, from, to) => {
    const dest = resolveInVault(to);
    if (fssync.existsSync(dest)) throw new Error('A file with that name already exists');
    const source = resolveInVault(from);
    const stat = await fs.stat(source);
    let documents = [];
    if (stat.isDirectory()) {
      const collect = (nodes, base) => {
        for (const node of nodes) {
          const relative = `${base}/${node.path}`;
          if (node.type === 'folder') collect(node.children, base);
          else documents.push(relative);
        }
      };
      collect(await walk(source), from);
    } else if (NOTE_EXTS.includes(path.extname(from).toLowerCase())) {
      documents = [from];
    }
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const migrated = [];
    const rollbackHistory = async () => {
      for (const [oldPath, newPath] of [...migrated].reverse()) await history.rename(newPath, oldPath);
    };
    try {
      for (const oldPath of documents) {
        const newPath = `${to}${oldPath.slice(from.length)}`;
        await history.rename(oldPath, newPath);
        migrated.push([oldPath, newPath]);
      }
      await fs.rename(source, dest);
    } catch (error) {
      await rollbackHistory();
      throw error;
    }
    return toPosix(to);
  });

  ipcMain.handle('fs:delete', async (_e, rel) => {
    const full = resolveInVault(rel);
    if (full === vaultRoot) throw new Error('Refusing to delete vault root');
    await shell.trashItem(full);
    return true;
  });

  ipcMain.handle('shell:reveal', async (_e, rel) => {
    shell.showItemInFolder(resolveInVault(rel));
  });
  ipcMain.handle('history:list', (_e, rel) => history.list(rel));
  ipcMain.handle('history:read', (_e, rel, id) => history.read(rel, id));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1e1e1e',
    title: 'Tagline',
    icon: path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 } } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable && !params.selectionText) return;
    const template = params.isEditable
      ? [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }]
      : [{ role: 'copy' }, { role: 'selectAll' }];
    Menu.buildFromTemplate(template).popup({ window: win });
  });
  let readyToClose = false;
  let preparingClose = false;
  let hasSaveHandler = false;
  const saveHandlerReady = (event, ready) => {
    if (event.sender === win?.webContents) hasSaveHandler = ready === true;
  };
  const closeReady = (event, success) => {
    if (event.sender !== win?.webContents || !preparingClose) return;
    preparingClose = false;
    if (success === true) {
      readyToClose = true;
      if (quitRequested) app.quit();
      else win.close();
    } else quitRequested = false;
  };
  ipcMain.on('app:closeReady', closeReady);
  ipcMain.on('app:saveHandlerReady', saveHandlerReady);
  win.once('closed', () => {
    ipcMain.removeListener('app:closeReady', closeReady);
    ipcMain.removeListener('app:saveHandlerReady', saveHandlerReady);
  });
  win.on('close', (event) => {
    if (!readyToClose && hasSaveHandler && !win.webContents.isDestroyed() && !win.webContents.isCrashed()) {
      event.preventDefault();
      if (!preparingClose) {
        preparingClose = true;
        win.webContents.send('app:prepareClose');
      }
      return;
    }
    closeWebsiteView();
  });
  win.webContents.on('render-process-gone', () => closeWebsiteView());
  win.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) closeWebsiteView();
  });
  const openWebsite = (url) => win.webContents.send('browser:link', url);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) openWebsite(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) return;
    const destination = new URL(event.url);
    if (destination.protocol === 'about:' && ['srcdoc', 'blank'].includes(destination.pathname)) return;
    const allowed = ['extension-sandbox.html', 'extension-webview.html'].map((file) => isDev
      ? `http://localhost:5173/${file}`
      : require('node:url').pathToFileURL(path.join(__dirname, '..', 'dist', file)).href);
    if (!allowed.includes(destination.href)) event.preventDefault();
  });
  win.webContents.on('will-navigate', (e, url) => {
    const destination = new URL(url);
    const current = new URL(win.webContents.getURL());
    if (destination.origin === current.origin && destination.pathname === current.pathname) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) openWebsite(url);
    else console.warn('Blocked navigation outside the application document:', url);
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const command = (name) => () => {
    if (!win || win.isDestroyed()) {
      createWindow();
      win.webContents.once('did-finish-load', () => win.webContents.send('menu:command', name));
    } else win.webContents.send('menu:command', name);
  };
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: 'Tagline', submenu: [
        { role: 'about' }, { type: 'separator' },
        { label: 'Settings...', accelerator: accelerator('settings'), registerAccelerator: false, click: command('openSettings') },
        { type: 'separator' }, { role: 'services' }, { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' }, { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File', submenu: [
        { label: 'Open Vault...', click: command('switchVault') },
        // The renderer handles configurable commands; menu accelerators are display-only.
        { label: 'New Note', accelerator: accelerator('new-note'), registerAccelerator: false, click: command('newNote') },
        { label: 'Create Citation...', accelerator: accelerator('citation'), registerAccelerator: false, click: command('createCitation') },
        { label: 'Import Document...', click: command('importDocument') },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: accelerator('close-tab'), registerAccelerator: false, click: command('closeTab') },
        ...(isMac ? [{ label: 'Close Window', role: 'close', accelerator: 'Cmd+Shift+W' }] : []),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    ...(process.platform === 'darwin' ? [{ role: 'windowMenu' }] : []),
    {
      label: 'View',
      submenu: [
        ...(isDev ? [{ role: 'reload' }] : []),
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  // Custom menu so app shortcuts like Ctrl+W/Ctrl+R don't close/reload the window.
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const primary = registerFlowFiles({
  app, ipcMain, getWindow: () => win, createWindow,
  getVaultRoot: () => vaultRoot, openVault
});

if (primary) app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock.setIcon(path.join(__dirname, '..', 'build', 'icon.png'));
  app.setAboutPanelOptions({ applicationName: 'Tagline', applicationVersion: installationInfo(app).version });
  buildMenu();
  registerIpc();
  registerOpenCaselist({ ipcMain, session, BrowserWindow, dialog, getWindow: () => win, getVaultRoot: () => vaultRoot, readConfig, writeConfig });
  closeWebsiteView = registerBrowser({ ipcMain, shell, getWindow: () => win });
  registerPandoc({ ipcMain, dialog, getWindow: () => win, readConfig, writeConfig });
  registerDocuments({ ipcMain, dialog, getWindow: () => win, readConfig });
  registerFonts({ app, ipcMain, dialog, getWindow: () => win });
  registerExtensions({ app, ipcMain, shell, readConfig, writeConfig, dialog, getWindow: () => win });
  const { readToken } = registerEmbeddings({ app, ipcMain, safeStorage, getVaultRoot: () => vaultRoot, readConfig, writeConfig });
  registerNli({ app, ipcMain, dialog, getWindow: () => win, readConfig, writeConfig, readToken });
  registerSummarization({ app, ipcMain });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

let quitRequested = false;
app.on('before-quit', () => { quitRequested = true; });
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
