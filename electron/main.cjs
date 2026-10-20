const { app, BrowserWindow, ipcMain, dialog, shell, Menu, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fssync = require('fs');
const { SAMPLE_VAULT } = require('./sampleVault.cjs');
const { registerPandoc } = require('./pandoc.cjs');
const { registerEmbeddings } = require('./embeddings.cjs');
const { registerDocuments } = require('./documents.cjs');
const { registerFonts } = require('./fonts.cjs');

const isDev = process.argv.includes('--dev');
const configPath = () => path.join(app.getPath('userData'), 'config.json');
const NOTE_EXTS = ['.md', '.flow'];

let win;
let vaultRoot = null;

// The app was renamed from "Debate Vault" to "Tagline"; carry the old profile over on first launch.
// On Windows, "Local State" carries safeStorage's key; other platforms may require token re-entry.
function migrateLegacyProfile() {
  const current = app.getPath('userData');
  const legacy = path.join(app.getPath('appData'), 'debate-vault');
  if (path.resolve(current) === path.resolve(legacy) || !fssync.existsSync(legacy)) return;
  if (['config.json', 'Local Storage'].some((item) => fssync.existsSync(path.join(current, item)))) return;
  for (const item of ['config.json', 'Local State', 'Local Storage', 'semantic-search']) {
    const from = path.join(legacy, item);
    if (!fssync.existsSync(from)) continue;
    try {
      fssync.cpSync(from, path.join(current, item), { recursive: true });
    } catch (e) {
      console.error(`Could not migrate ${item} from the Debate Vault profile:`, e);
    }
  }
}
migrateLegacyProfile();
if (process.platform === 'win32') app.setAppUserModelId('app.tagline');

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

async function walk(dir, base = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push({ type: 'folder', path: rel, name: e.name, children: await walk(path.join(dir, e.name), rel) });
    } else if (NOTE_EXTS.includes(path.extname(e.name).toLowerCase())) {
      const stat = await fs.stat(path.join(dir, e.name));
      out.push({ type: 'file', path: rel, name: e.name, mtime: stat.mtimeMs });
    }
  }
  out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1));
  return out;
}

function uniquePath(rel) {
  const ext = path.extname(rel);
  const stem = rel.slice(0, rel.length - ext.length);
  let candidate = rel;
  let i = 1;
  while (fssync.existsSync(resolveInVault(candidate))) candidate = `${stem} ${i++}${ext}`;
  return candidate;
}

async function openVault(dir) {
  await fs.mkdir(dir, { recursive: true });
  vaultRoot = path.resolve(dir);
  writeConfig({ lastVault: vaultRoot });
  return { root: vaultRoot, name: path.basename(vaultRoot) };
}

function registerIpc() {
  ipcMain.handle('vault:getLast', async () => {
    const { lastVault } = readConfig();
    if (lastVault && fssync.existsSync(lastVault)) return openVault(lastVault);
    return null;
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

  ipcMain.handle('fs:readAll', async () => {
    const result = {};
    const visit = async (nodes) => {
      for (const n of nodes) {
        if (n.type === 'folder') await visit(n.children);
        else result[n.path] = await fs.readFile(resolveInVault(n.path), 'utf8');
      }
    };
    await visit(await walk(resolveInVault('')));
    return result;
  });

  ipcMain.handle('fs:read', async (_e, rel) => fs.readFile(resolveInVault(rel), 'utf8'));

  ipcMain.handle('fs:write', async (_e, rel, content) => {
    const full = resolveInVault(rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf8');
    return true;
  });

  ipcMain.handle('fs:create', async (_e, rel, content = '') => {
    const finalRel = uniquePath(rel);
    const full = resolveInVault(finalRel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf8');
    return toPosix(finalRel);
  });

  ipcMain.handle('fs:mkdir', async (_e, rel) => {
    const finalRel = uniquePath(rel);
    await fs.mkdir(resolveInVault(finalRel), { recursive: true });
    return toPosix(finalRel);
  });

  ipcMain.handle('fs:rename', async (_e, from, to) => {
    const dest = resolveInVault(to);
    if (fssync.existsSync(dest)) throw new Error('A file with that name already exists');
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(resolveInVault(from), dest);
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
  // Open external links in the OS browser instead of inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const destination = new URL(url);
    const current = new URL(win.webContents.getURL());
    if (destination.origin === current.origin && destination.pathname === current.pathname) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
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
        { label: 'Settings...', accelerator: 'Cmd+,', click: command('openSettings') },
        { type: 'separator' }, { role: 'services' }, { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' }, { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File', submenu: [
        { label: 'Open Vault...', click: command('switchVault') },
        // The renderer handles Ctrl+N/W on Windows and Linux; registering them there would fire twice.
        { label: 'New Note', accelerator: 'CmdOrCtrl+N', registerAccelerator: isMac, click: command('newNote') },
        { label: 'Create Citation...', click: command('createCitation') },
        { label: 'Import Document...', click: command('importDocument') },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', registerAccelerator: isMac, click: command('closeTab') },
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

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock.setIcon(path.join(__dirname, '..', 'build', 'icon.png'));
  app.setAboutPanelOptions({ applicationName: 'Tagline', applicationVersion: '0.0.1' });
  buildMenu();
  registerIpc();
  registerPandoc({ ipcMain, dialog, getWindow: () => win, readConfig, writeConfig });
  registerDocuments({ ipcMain, dialog, getWindow: () => win, readConfig });
  registerFonts({ app, ipcMain, dialog, getWindow: () => win });
  registerEmbeddings({ app, ipcMain, safeStorage, getVaultRoot: () => vaultRoot, readConfig, writeConfig });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
