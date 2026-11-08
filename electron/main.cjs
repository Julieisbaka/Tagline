const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Menu,
  safeStorage,
  session,
  nativeTheme,
  clipboard,
} = require('electron');
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
const { registerTimerSound } = require('./timerSound.cjs');
const { registerExtensions } = require('./extensions.cjs');
const { extractCitation } = require('./citationMetadata.cjs');
const { checkLinks } = require('./evidenceLinks.cjs');
const { fetchQuoteSource } = require('./quoteSource.cjs');
const { registerFlowFiles } = require('./flowFiles.cjs');
const { registerUriHandler } = require('./uri.cjs');
const { registerBrowser } = require('./browser.cjs');
const { DEFAULT_RETENTION, createRevisionHistory } = require('./revisionHistory.cjs');
const { NOTE_EXTS, listVault: walk, readVaultSnapshot } = require('./vaultFiles.cjs');
const { installationInfo, REPOSITORY_URL, RELEASES_URL } = require('./installation.cjs');
const { createUpdateManager } = require('./appUpdates.cjs');
const { uninstallApplication } = require('./uninstall.cjs');
const { registerOpenCaselist } = require('./opencaselist.cjs');
const { registerTabroom } = require('./tabroom.cjs');
const { registerGoogleDocs } = require('./googleDocs.cjs');
const keyDefinitions = require('../src/lib/keybindings.json');
const { registerNativeUi } = require('./nativeUi.cjs');
const { registerMcp } = require('./mcp.cjs');

const isDev = process.argv.includes('--dev');
// Surface stray rejections/exceptions in logs instead of failing silently.
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection', reason);
});
process.on('uncaughtException', (error) => {
  console.error('[main] uncaughtException', error);
});
// Keep profile and OS credential identity stable across versions and install locations.
app.setName('Tagline');
const configPath = () => path.join(app.getPath('userData'), 'config.json');

let win;
let mcp;
let localModels;
let vaultRoot = null;
let keybindings = {};
let closeWebsiteView = () => {};
let saveBeforeUpdate = async () => {
  throw new Error('The application is not ready to install an update.');
};
// Replaced by registerIpc(); checks for and downloads an update in the
// background (never installs silently at startup). No-op until then.
let prepareUpdateInBackground = async () => null;
// Set once the installer is launched; the save-before-quit gate is already
// satisfied (saveBeforeUpdate ran), so quitting must not re-enter it.
let updateQuit = false;

function accelerator(id) {
  const value = keybindings[id] ?? keyDefinitions.find((item) => item.id === id)?.key;
  return value ? value.replace(/\bMod\b/g, 'CmdOrCtrl').replace(/\bMeta\b/g, 'Super') : undefined;
}

if (process.platform === 'win32') {
  app.setAppUserModelId('app.tagline');
}
// Apps launched from Finder/Dock get a minimal PATH; add Homebrew and MacTeX so Pandoc and its PDF engines resolve.
if (process.platform === 'darwin') {
  const current = (process.env.PATH || '').split(':').filter(Boolean);
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', '/Library/TeX/texbin'].filter(
    (p) => !current.includes(p)
  );
  process.env.PATH = [...current, ...extra].join(':');
}

function readConfig() {
  try {
    return JSON.parse(fssync.readFileSync(configPath(), 'utf8'));
  } catch (err) {
    const configPathFn = configPath();
    console.warn('[config] failed to read/parse', configPathFn, err.message);
    const corruptPath = configPathFn + '.corrupt.' + Date.now();
    try {
      fssync.renameSync(configPathFn, corruptPath);
    } catch {}
    return {};
  }
}

function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  const configPathFn = configPath();
  fssync.mkdirSync(path.dirname(configPathFn), { recursive: true });
  const temporary = path.join(path.dirname(configPathFn), `.tagline-config-${randomUUID()}.tmp`);
  try {
    fssync.writeFileSync(temporary, JSON.stringify(next, null, 2));
    fssync.renameSync(temporary, configPathFn);
  } catch (error) {
    try {
      fssync.rmSync(temporary, { force: true });
    } catch {}
    throw error;
  }
  return next;
}

// Resolve a vault-relative path and refuse anything that escapes the vault.
function resolveInVault(rel = '') {
  if (typeof rel !== 'string') {
    throw new Error('Invalid file path.');
  }
  if (!vaultRoot) {
    throw new Error('No vault open');
  }
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
  while (fssync.existsSync(resolveInVault(candidate))) {
    candidate = `${stem}${underscoreFolders ? '_' : ' '}${i++}${ext}`;
  }
  return candidate;
}

async function openVault(dir) {
  await fs.mkdir(dir, { recursive: true });
  vaultRoot = path.resolve(dir);
  const saved = readConfig().recentVaults;
  const key = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
  const recentVaults = [
    vaultRoot,
    ...(Array.isArray(saved)
      ? saved.filter(
          (item) => typeof item === 'string' && key(path.resolve(item)) !== key(vaultRoot)
        )
      : []),
  ].slice(0, 20);
  writeConfig({ lastVault: vaultRoot, recentVaults });
  return { root: vaultRoot, name: path.basename(vaultRoot) };
}

async function listRecentVaults() {
  const config = readConfig();
  const candidates = [
    ...(Array.isArray(config.recentVaults) ? config.recentVaults : []),
    ...(typeof config.lastVault === 'string' ? [config.lastVault] : []),
  ];
  const key = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
  const unique = [
    ...new Map(
      candidates
        .filter((item) => typeof item === 'string' && path.isAbsolute(item))
        .map((item) => [key(path.resolve(item)), path.resolve(item)])
    ).values(),
  ].slice(0, 20);
  return Promise.all(
    unique.map(async (root) => {
      let exists = false;
      try {
        exists = (await fs.stat(root)).isDirectory();
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') {
          throw error;
        }
      }
      return { root, name: path.basename(root), exists };
    })
  );
}

// Sensitive IPC handlers only accept calls from the app's own main frame.
function assertModelSender(event, action = 'Model management') {
  if (!win || event.sender !== win.webContents || event.senderFrame !== event.sender.mainFrame) {
    throw new Error(`${action} is only available to the application main frame.`);
  }
}

function registerIpc() {
  registerNativeUi({ ipcMain, nativeTheme, Menu, dialog, getWindow: () => win });
  ipcMain.handle('app:editText', (event, action) => {
    assertModelSender(event, 'Text editing');
    if (!['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'].includes(action)) {
      throw new Error('Invalid text editing action.');
    }
    return event.sender[action]();
  });
  ipcMain.handle('app:clipboardWrite', (event, text) => {
    assertModelSender(event, 'Clipboard access');
    if (typeof text !== 'string' || text.length > 1_000_000) {
      throw new Error('Invalid clipboard text.');
    }
    clipboard.writeText(text);
    return true;
  });
  const updates = createUpdateManager({
    app,
    shell,
    notify: (state) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('app:updateState', state);
      }
    },
  });
  prepareUpdateInBackground = async () => {
    if (!app.isPackaged || process.env.TAGLINE_DISABLE_AUTO_UPDATE === '1') {
      return null;
    }
    if (readConfig().autoUpdate === false) {
      return null;
    }
    const release = await updates.check(installationInfo(app).version);
    if (release.updateAvailable && release.download) {
      await updates.download();
    }
    return release;
  };
  const requireMainFrame = (event) => assertModelSender(event, 'Update actions');
  ipcMain.handle('app:installation', (event) => {
    assertModelSender(event, 'Installation details');
    return installationInfo(app);
  });
  ipcMain.handle('app:checkUpdates', (event) => {
    requireMainFrame(event);
    return updates.check(installationInfo(app).version);
  });
  ipcMain.handle('app:getUpdateState', (event) => {
    requireMainFrame(event);
    return updates.getState();
  });
  ipcMain.handle('app:downloadUpdate', (event) => {
    requireMainFrame(event);
    return updates.download();
  });
  ipcMain.handle('app:installUpdate', async (event) => {
    requireMainFrame(event);
    const result = await updates.installUpdate(saveBeforeUpdate);
    if (!result.manual) {
      updateQuit = true;
      app.quit();
    }
    return result;
  });
  ipcMain.handle('app:autoUpdate', async (event) => {
    requireMainFrame(event);
    const outcome = await updates.autoUpdate(installationInfo(app).version, saveBeforeUpdate);
    if (outcome.updated && outcome.result && !outcome.result.manual) {
      updateQuit = true;
      app.quit();
    }
    return outcome;
  });
  ipcMain.handle('app:getAutoUpdate', (event) => {
    requireMainFrame(event);
    return readConfig().autoUpdate !== false;
  });
  ipcMain.handle('app:setAutoUpdate', (event, enabled) => {
    requireMainFrame(event);
    if (typeof enabled !== 'boolean') {
      throw new Error('Invalid auto-update choice.');
    }
    writeConfig({ autoUpdate: enabled });
    if (enabled) {
      prepareUpdateInBackground().catch(() => {});
    }
    return enabled;
  });
  ipcMain.handle('app:openProjectPage', (event, page) => {
    assertModelSender(event, 'Opening project pages');
    if (!['repository', 'releases'].includes(page)) {
      throw new Error('Unknown project page.');
    }
    return shell.openExternal(page === 'repository' ? REPOSITORY_URL : RELEASES_URL);
  });
  ipcMain.handle('app:uninstall', async (event, removeProfile) => {
    assertModelSender(event, 'Uninstalling');
    const result = await uninstallApplication({ app, shell, removeProfile });
    if (!result.manual) {
      app.quit();
    }
    return result;
  });
  const history = createRevisionHistory({
    getVaultRoot: () => vaultRoot,
    resolveInVault,
  });
  ipcMain.handle('pandoc:install', (event) => {
    assertModelSender(event, 'Installing Pandoc');
    return shell.openExternal('https://pandoc.org/installing.html');
  });
  ipcMain.handle('citation:extract', (event, url) => {
    assertModelSender(event, 'Citation lookup');
    return extractCitation(url);
  });
  ipcMain.handle('citation:sourceMetadata', (event, url) => {
    assertModelSender(event, 'Citation lookup');
    return extractCitation(url, { sourceOnly: true });
  });
  ipcMain.handle('evidence:checkLinks', (event, urls, options) => {
    assertModelSender(event, 'Link checking');
    return checkLinks(urls, options);
  });
  ipcMain.handle('evidence:quoteSource', (event, url) => {
    assertModelSender(event, 'Quote verification');
    return fetchQuoteSource(url);
  });
  ipcMain.handle('keybindings:set', (event, overrides) => {
    assertModelSender(event, 'Keyboard shortcut settings');
    if (
      !overrides ||
      typeof overrides !== 'object' ||
      Array.isArray(overrides) ||
      Object.entries(overrides).some(
        ([id, key]) =>
          !(
            keyDefinitions.some((item) => item.id === id) ||
            /^ext:[a-z0-9][a-z0-9-]{1,63}\.[a-z0-9][a-z0-9-]{1,63}$/.test(id)
          ) ||
          typeof key !== 'string' ||
          (key !== '' &&
            !/^(?:(?:Mod|Ctrl|Meta|Alt|Shift)\+)*(?:[A-Z0-9,.;/[\]'=\\`-]|F(?:[1-9]|1\d|2[0-4])|Enter|Tab|Space|Arrow(?:Up|Down|Left|Right)|Home|End|PageUp|PageDown|Escape)$/.test(
              key
            ))
      )
    ) {
      throw new Error('Invalid keyboard shortcut settings.');
    }
    keybindings = { ...overrides };
    buildMenu();
  });
  ipcMain.handle('vault:getLast', async (event) => {
    assertModelSender(event, 'Vault access');
    const { lastVault } = readConfig();
    if (lastVault && fssync.existsSync(lastVault)) {
      return openVault(lastVault);
    }
    return null;
  });

  ipcMain.handle('vault:listRecent', (event) => {
    assertModelSender(event, 'Vault access');
    return listRecentVaults();
  });
  ipcMain.handle('vault:openRecent', async (event, root) => {
    assertModelSender(event, 'Vault access');
    if (typeof root !== 'string' || !path.isAbsolute(root)) {
      throw new Error('Invalid saved vault path.');
    }
    const recent = await listRecentVaults();
    const key = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
    if (!recent?.some((item) => item.exists && key(item.root) === key(path.resolve(root)))) {
      throw new Error('That saved vault is unavailable. Choose its folder to add it again.');
    }
    return openVault(root);
  });
  ipcMain.handle('vault:forgetRecent', (event, root) => {
    assertModelSender(event, 'Vault access');
    if (typeof root !== 'string' || !path.isAbsolute(root)) {
      throw new Error('Invalid saved vault path.');
    }
    const key = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
    const recent = readConfig().recentVaults;
    const recentVaults = (Array.isArray(recent) ? recent : []).filter(
      (item) => typeof item === 'string' && key(path.resolve(item)) !== key(path.resolve(root))
    );
    const config = readConfig();
    const lastVault =
      typeof config.lastVault === 'string' &&
      key(path.resolve(config.lastVault)) === key(path.resolve(root))
        ? null
        : config.lastVault;
    writeConfig({ recentVaults, lastVault });
    return true;
  });
  ipcMain.handle('vault:revealRecent', async (event, root) => {
    assertModelSender(event, 'Vault access');
    if (typeof root !== 'string' || !path.isAbsolute(root)) {
      throw new Error('Invalid saved vault path.');
    }
    const recent = await listRecentVaults();
    const key = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
    if (!recent?.some((item) => item.exists && key(item.root) === key(path.resolve(root)))) {
      throw new Error('That saved vault is unavailable.');
    }
    const error = await shell.openPath(root);
    if (error) {
      throw new Error(error);
    }
  });

  ipcMain.handle('vault:choose', async (event) => {
    assertModelSender(event, 'Vault access');
    const res = await dialog.showOpenDialog(win, {
      title: 'Open or create a vault folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) {
      return null;
    }
    return openVault(res.filePaths[0]);
  });

  ipcMain.handle('vault:createSample', async (event) => {
    assertModelSender(event, 'Vault access');
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose a folder for the sample vault',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) {
      return null;
    }
    const info = await openVault(path.join(res.filePaths[0], 'Tagline Sample Vault'));
    for (const [rel, content] of Object.entries(SAMPLE_VAULT)) {
      const full = resolveInVault(rel);
      await fs.mkdir(path.dirname(full), { recursive: true });
      if (!fssync.existsSync(full)) {
        await fs.writeFile(full, content, 'utf8');
      }
    }
    return info;
  });

  ipcMain.handle('fs:list', async (event) => {
    assertModelSender(event, 'Vault file access');
    return walk(resolveInVault(''));
  });
  ipcMain.handle('fs:snapshot', async (event) => {
    assertModelSender(event, 'Vault file access');
    return readVaultSnapshot(resolveInVault(''));
  });
  ipcMain.handle('fs:readAll', async (event) => {
    assertModelSender(event, 'Vault file access');
    return (await readVaultSnapshot(resolveInVault(''))).contents;
  });

  ipcMain.handle('fs:read', async (event, rel) => {
    assertModelSender(event, 'Vault file access');
    return fs.readFile(resolveInVault(rel), 'utf8');
  });

  async function writeVaultFile(
    rel,
    content,
    retention = DEFAULT_RETENTION,
    canvasMode = 'complete',
    experimentalHistoryDeltas = false
  ) {
    const full = resolveInVault(rel);
    await history.snapshot(rel, content, retention, canvasMode, experimentalHistoryDeltas);
    await fs.mkdir(path.dirname(full), { recursive: true });
    let mode;
    try {
      mode = (await fs.stat(full)).mode;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    const temporary = path.join(path.dirname(full), `.tagline-save-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode });
      await fs.rename(temporary, full);
    } catch (error) {
      if (error.code !== 'EEXIST') {
        await fs.rm(temporary, { force: true });
      }
      throw error;
    }
    return true;
  }
  ipcMain.handle(
    'fs:write',
    (event, rel, content, retention, canvasMode, experimentalHistoryDeltas) => {
      assertModelSender(event, 'Vault file access');
      if (typeof content !== 'string') {
        throw new Error('Invalid file content.');
      }
      return writeVaultFile(rel, content, retention, canvasMode, experimentalHistoryDeltas);
    }
  );

  ipcMain.handle('fs:create', async (event, rel, content = '') => {
    assertModelSender(event, 'Vault file access');
    if (typeof content !== 'string') {
      throw new Error('Invalid file content.');
    }
    await fs.mkdir(path.dirname(resolveInVault(rel)), { recursive: true });
    while (true) {
      const finalRel = uniquePath(rel);
      try {
        await fs.writeFile(resolveInVault(finalRel), content, { encoding: 'utf8', flag: 'wx' });
        return toPosix(finalRel);
      } catch (error) {
        if (error.code !== 'EEXIST') {
          throw error;
        }
      }
    }
  });

  ipcMain.handle('fs:mkdir', async (event, rel, underscoreFolders) => {
    assertModelSender(event, 'Vault file access');
    if (typeof underscoreFolders !== 'boolean') {
      throw new Error('Invalid folder path preference.');
    }
    await fs.mkdir(path.dirname(resolveInVault(rel)), { recursive: true });
    while (true) {
      const finalRel = uniquePath(rel, true, underscoreFolders);
      try {
        await fs.mkdir(resolveInVault(finalRel));
        return toPosix(finalRel);
      } catch (error) {
        if (error.code !== 'EEXIST') {
          throw error;
        }
      }
    }
  });

  async function renameVaultPath(from, to) {
    const dest = resolveInVault(to);
    const source = resolveInVault(from);
    // Same path, different case: collides on case-insensitive filesystems,
    // so rename through a temporary name instead.
    const caseOnly = from !== to && from.toLowerCase() === to.toLowerCase();
    if (fssync.existsSync(dest) && !caseOnly) {
      return { ok: false, code: 'destination-exists' };
    }
    const stat = await fs.stat(source);
    let documents = [];
    if (stat.isDirectory()) {
      const collect = (nodes, base) => {
        for (const node of nodes) {
          const relative = `${base}/${node.path}`;
          if (node.type === 'folder') {
            collect(node.children, base);
          } else {
            documents.push(relative);
          }
        }
      };
      collect(await walk(source), from);
    } else if (NOTE_EXTS.includes(path.extname(from).toLowerCase())) {
      documents = [from];
    }
    await fs.mkdir(path.dirname(dest), { recursive: true });
    // Vaults normally live on one mount, but a vault can contain mount points
    // (external drives, network shares). fs.rename fails with EXDEV across
    // devices, so fall back to copy+delete to keep the move working.
    const movePath = async (src, dst) => {
      try {
        await fs.rename(src, dst);
        return;
      } catch (error) {
        if (error.code !== 'EXDEV') {
          throw error;
        }
      }
      try {
        await fs.cp(src, dst, {
          recursive: true,
          errorOnExist: true,
          force: false,
          preserveTimestamps: true,
          verbatimSymlinks: true,
        });
      } catch (error) {
        if (error.code !== 'EEXIST') {
          await fs.rm(dst, { recursive: true, force: true }).catch(() => {});
        }
        throw error;
      }
      try {
        await fs.rm(src, { recursive: true, force: true });
      } catch (error) {
        // Copy is complete; keep it rather than risk losing data, and skip the
        // history rollback so revision history stays aligned with the copy.
        error.revisionHistoryKept = true;
        error.message = `Copied to "${dst}" but could not remove "${src}": ${error.message}`;
        throw error;
      }
    };
    const migrated = [];
    const rollbackHistory = async () => {
      for (const [oldPath, newPath] of [...migrated].reverse()) {
        await history.rename(newPath, oldPath);
      }
    };
    try {
      for (const oldPath of documents) {
        const newPath = `${to}${oldPath.slice(from.length)}`;
        await history.rename(oldPath, newPath);
        migrated.push([oldPath, newPath]);
      }
      if (caseOnly) {
        const temp = path.join(path.dirname(source), `.tagline-rename-${randomUUID()}`);
        await fs.rename(source, temp);
        try {
          await movePath(temp, dest);
        } catch (error) {
          try {
            await fs.rename(temp, source);
          } catch {}
          throw error;
        }
      } else {
        await movePath(source, dest);
      }
    } catch (error) {
      if (!error.revisionHistoryKept) {
        await rollbackHistory();
      }
      throw error;
    }
    return { ok: true, path: toPosix(to) };
  }
  ipcMain.handle('fs:rename', (event, from, to) => {
    assertModelSender(event, 'Vault file access');
    return renameVaultPath(from, to);
  });

  mcp = registerMcp({
    app,
    ipcMain,
    getWindow: () => win,
    getVaultRoot: () => vaultRoot,
    getLocalModels: () => localModels,
    readConfig,
    writeConfig,
    writeNote: (rel, content) => writeVaultFile(rel, content),
    renamePath: renameVaultPath,
    trashItem: (full) => shell.trashItem(full),
  });

  ipcMain.handle('fs:delete', async (event, rel) => {
    assertModelSender(event, 'Vault file access');
    const full = resolveInVault(rel);
    if (full === vaultRoot) {
      throw new Error('Refusing to delete vault root');
    }
    try {
      await shell.trashItem(full);
    } catch (error) {
      if (error.code === 'ENOENT' || /ENOENT|not found/i.test(error.message || '')) {
        throw new Error(
          `Can't move "${rel}" to the trash because it no longer exists. Refresh the vault and try again.`
        );
      }
      throw error;
    }
    return true;
  });

  ipcMain.handle('shell:reveal', async (event, rel) => {
    assertModelSender(event, 'Revealing vault files');
    shell.showItemInFolder(resolveInVault(rel));
  });
  ipcMain.handle('history:list', (event, rel) => {
    assertModelSender(event, 'Revision history');
    if (typeof rel !== 'string') {
      throw new Error('Invalid file path.');
    }
    return history.list(rel);
  });
  ipcMain.handle('history:read', (event, rel, id) => {
    assertModelSender(event, 'Revision history');
    if (typeof rel !== 'string' || typeof id !== 'string') {
      throw new Error('Invalid file path.');
    }
    return history.read(rel, id);
  });
  ipcMain.handle('history:latest-working', (event, rel) => {
    assertModelSender(event, 'Revision history');
    if (typeof rel !== 'string') {
      throw new Error('Invalid file path.');
    }
    return history.latestWorking(rel);
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
    icon: path.join(
      __dirname,
      '..',
      'build',
      process.platform === 'win32' ? 'icon.ico' : 'icon.png'
    ),
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 } }
      : {}),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [
        `--tagline-languages=${encodeURIComponent(JSON.stringify(app.getPreferredSystemLanguages()))}`,
      ],
    },
  });

  let readyToClose = false;
  let preparingClose = false;
  let hasSaveHandler = false;
  saveBeforeUpdate = () =>
    new Promise((resolve, reject) => {
      if (
        !hasSaveHandler ||
        preparingClose ||
        win.webContents.isDestroyed() ||
        win.webContents.isCrashed()
      ) {
        reject(
          new Error(
            'Wait for the workspace to finish loading or saving, then try installing again.'
          )
        );
        return;
      }
      const target = win;
      const finish = (error) => {
        clearTimeout(timeout);
        ipcMain.removeListener('app:closeReady', saved);
        target.removeListener('closed', closed);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const saved = (event, success) => {
        if (event.sender === target.webContents) {
          finish(
            success === true
              ? null
              : new Error(
                  'Pending edits could not be saved. Resolve the save error before installing.'
                )
          );
        }
      };
      const closed = () => finish(new Error('The workspace closed before the update could start.'));
      const timeout = setTimeout(
        () => finish(new Error('Timed out waiting for pending edits to save. Try again.')),
        60000
      );
      ipcMain.on('app:closeReady', saved);
      target.once('closed', closed);
      target.webContents.send('app:prepareClose');
    });
  const saveHandlerReady = (event, ready) => {
    if (event.sender === win?.webContents) {
      hasSaveHandler = ready === true;
    }
  };
  const closeReady = (event, success) => {
    if (event.sender !== win?.webContents || !preparingClose) {
      return;
    }
    preparingClose = false;
    if (success === true) {
      readyToClose = true;
      if (quitRequested) {
        app.quit();
      } else {
        win.close();
      }
    } else {
      quitRequested = false;
    }
  };
  ipcMain.on('app:closeReady', closeReady);
  ipcMain.on('app:saveHandlerReady', saveHandlerReady);
  win.once('closed', () => {
    ipcMain.removeListener('app:closeReady', closeReady);
    ipcMain.removeListener('app:saveHandlerReady', saveHandlerReady);
  });
  win.on('close', (event) => {
    if (
      !updateQuit &&
      !readyToClose &&
      hasSaveHandler &&
      !win.webContents.isDestroyed() &&
      !win.webContents.isCrashed()
    ) {
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
    if (isMainFrame && !isInPlace) {
      closeWebsiteView();
    }
  });
  const openWebsite = (url) => win.webContents.send('browser:link', url);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      openWebsite(url);
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) {
      return;
    }
    const destination = new URL(event.url);
    if (destination.protocol === 'about:' && ['srcdoc', 'blank'].includes(destination.pathname)) {
      return;
    }
    const allowed = ['extension-sandbox.html', 'extension-webview.html'].map((file) =>
      isDev
        ? `http://localhost:5173/${file}`
        : require('node:url').pathToFileURL(path.join(__dirname, '..', 'dist', file)).href
    );
    if (!allowed.includes(destination.href)) {
      event.preventDefault();
    }
  });
  win.webContents.on('will-navigate', (e, url) => {
    const destination = new URL(url);
    const current = new URL(win.webContents.getURL());
    if (destination.origin === current.origin && destination.pathname === current.pathname) {
      return;
    }
    e.preventDefault();
    if (/^https?:/i.test(url)) {
      openWebsite(url);
    } else {
      console.warn('Blocked navigation outside the application document:', url);
    }
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
    } else {
      win.webContents.send('menu:command', name);
    }
  };
  const showExtensionSecurity = async () => {
    const options = {
      type: 'info',
      title: 'Extension security and review',
      message: 'Extensions are reviewed before they can be enabled.',
      detail: [
        'Every extension manifest is scanned and validated whenever the extension list reloads.',
        '',
        'The capabilities settings, editor:active-note, events, ui and network are review-gated. Enabling an extension that declares any of them requires the current review token, computed from its declared permissions, network hosts, settings, ribbon items, panels and webviews.',
        '',
        'Approving an extension stores the review signature in the app configuration (extensionReviews in config.json). If any reviewed field changes later — including network hosts — the stored approval no longer matches, the extension is treated as disabled, and you must review and enable it again.',
        '',
        'Nothing here happens silently. The native menu cannot enable or approve an extension; only Settings > Extensions can enable one, and only with a current, matching token. The menu can only open that page.',
        '',
        'The network permission grants only host-mediated HTTPS requests to the exact networkHosts in the reviewed manifest. Local/private addresses and redirects are not followed; request and response sizes and rates are limited. The sandbox itself has no direct network access.',
        '',
        'Extensions installed before reviews were introduced are treated as needing review if they declare a review-gated capability.',
      ].join('\n'),
      buttons: ['Open Settings > Extensions', 'Close'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    };
    const result =
      win && !win.isDestroyed()
        ? await dialog.showMessageBox(win, options)
        : await dialog.showMessageBox(options);
    if (result.response === 0) {
      command('openExtensionsSettings')();
    }
  };
  const template = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: 'Tagline',
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              {
                label: 'Settings...',
                accelerator: accelerator('settings'),
                registerAccelerator: false,
                click: command('openSettings'),
              },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Vault...', click: command('switchVault') },
        // The renderer handles configurable commands; menu accelerators are display-only.
        {
          label: 'New Note',
          accelerator: accelerator('new-note'),
          registerAccelerator: false,
          click: command('newNote'),
        },
        {
          label: 'Create Citation...',
          accelerator: accelerator('citation'),
          registerAccelerator: false,
          click: command('createCitation'),
        },
        { label: 'Import Document...', click: command('importDocument') },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: accelerator('close-tab'),
          registerAccelerator: false,
          click: command('closeTab'),
        },
        ...(isMac ? [{ label: 'Close Window', role: 'close', accelerator: 'Cmd+Shift+W' }] : []),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    ...(process.platform === 'darwin' ? [{ role: 'windowMenu' }] : []),
    {
      label: 'View',
      submenu: [
        ...(isDev ? [{ role: 'reload' }] : []),
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [{ label: 'Extension security and review…', click: showExtensionSecurity }],
    },
  ];
  // Custom menu so app shortcuts like Ctrl+W/Ctrl+R don't close/reload the window.
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const primary = registerFlowFiles({
  app,
  ipcMain,
  getWindow: () => win,
  createWindow,
  getVaultRoot: () => vaultRoot,
  openVault,
});

if (primary) {
  registerUriHandler({ app, ipcMain, getWindow: () => win, createWindow });
  app.whenReady().then(() => {
    if (process.platform === 'darwin') {
      app.dock.setIcon(path.join(__dirname, '..', 'build', 'icon.png'));
    }
    app.setAboutPanelOptions({
      applicationName: 'Tagline',
      applicationVersion: installationInfo(app).version,
    });
    buildMenu();
    registerIpc();
    registerOpenCaselist({
      ipcMain,
      session,
      BrowserWindow,
      dialog,
      getWindow: () => win,
      getVaultRoot: () => vaultRoot,
      readConfig,
      writeConfig,
    });
    registerTabroom({ ipcMain, session, BrowserWindow, dialog, getWindow: () => win });
    closeWebsiteView = registerBrowser({ ipcMain, shell, getWindow: () => win });
    registerPandoc({ ipcMain, dialog, getWindow: () => win, readConfig, writeConfig });
    registerDocuments({ ipcMain, dialog, getWindow: () => win, readConfig });
    registerGoogleDocs({ app, ipcMain, safeStorage, dialog, shell, getWindow: () => win });
    registerFonts({ app, ipcMain, dialog, getWindow: () => win });
    registerTimerSound({ app, ipcMain, dialog, getWindow: () => win });
    registerExtensions({
      app,
      ipcMain,
      shell,
      readConfig,
      writeConfig,
      dialog,
      getWindow: () => win,
      safeStorage,
    });
    const embeddings = registerEmbeddings({
      app,
      ipcMain,
      safeStorage,
      getVaultRoot: () => vaultRoot,
      readConfig,
      writeConfig,
      assertModelSender,
    });
    const nli = registerNli({
      app,
      ipcMain,
      dialog,
      getWindow: () => win,
      readConfig,
      writeConfig,
      readToken: embeddings.readToken,
      assertModelSender,
    });
    const summary = registerSummarization({ app, ipcMain, readConfig, assertModelSender });
    localModels = { embeddings, nli, summary };
    createWindow();
    // Quietly check for and download an update shortly after startup. Never
    // fails startup and never installs without the user choosing Install.
    setTimeout(() => {
      prepareUpdateInBackground().catch(() => {});
    }, 8000).unref?.();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

let quitRequested = false;
app.on('before-quit', () => {
  quitRequested = true;
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !mcp?.shouldKeepRunning()) {
    app.quit();
  }
});
