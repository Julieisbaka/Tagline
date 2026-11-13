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
  screen,
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
const { registerFloatingTimer } = require('./floatingTimer.cjs');
const { registerScholarlySearch } = require('./scholarlySearch.cjs');
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
const { registerSpellcheck } = require('./spellcheck.cjs');

const { parseCli } = require(path.join(__dirname, 'cli.cjs'));
const cli = parseCli(process.argv, process.env);
const isDev = cli.isDev;
const safeMode = cli.safeMode;
if (safeMode) {
  process.env.TAGLINE_DISABLE_AUTO_UPDATE = '1';
}
const disableExtensions = cli.disableExtensions;
const updateCheckDelayMs = cli.updateCheckDelayMs;
const updateCheckTimeoutMs = cli.updateCheckTimeoutMs;
// Surface stray rejections/exceptions in logs instead of failing silently.
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection', reason);
});
process.on('uncaughtException', (error) => {
  console.error('[main] uncaughtException', error);
});
// Keep profile and OS credential identity stable across versions and install locations.
app.setName('Tagline');

const state = {
  win: undefined,
  mcp: undefined,
  localModels: undefined,
  vaultRoot: null,
  keybindings: {},
  closeWebsiteView: () => {},
  saveBeforeUpdate: async () => {
    throw new Error('The application is not ready to install an update.');
  },
  // Replaced during IPC registration; startup never installs an update silently.
  prepareUpdateInBackground: async () => null,
  // An installer launch has already satisfied the save-before-quit gate.
  updateQuit: false,
  quitRequested: false,
};

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

const { createVault } = require(path.join(__dirname, 'main', 'vault.cjs'));
const { createWindowManager } = require(path.join(__dirname, 'main', 'window.cjs'));
const { registerAppIpc } = require(path.join(__dirname, 'main', 'ipcApp.cjs'));
const { registerVaultIpc } = require(path.join(__dirname, 'main', 'ipcVault.cjs'));
const vault = createVault({ app, path, fs, fssync, randomUUID, process, dialog }, state);
const { readConfig, writeConfig, resolveInVault, openVault, cleanupConfigTemps } = vault;
const { createWindow, buildMenu } = createWindowManager(
  {
    app,
    BrowserWindow,
    ipcMain,
    dialog,
    Menu,
    path,
    keyDefinitions,
    isDev,
    process,
    mainDir: __dirname,
  },
  state
);

// Sensitive IPC handlers only accept calls from the app's own main frame.
function assertMainFrameSender(event, action = 'Main frame access') {
  if (
    !state.win ||
    event.sender !== state.win.webContents ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    throw new Error(`${action} is only available to the application main frame.`);
  }
}

function registerIpc() {
  const history = registerAppIpc(
    {
      app,
      ipcMain,
      nativeTheme,
      Menu,
      dialog,
      clipboard,
      shell,
      registerNativeUi,
      registerSpellcheck,
      createUpdateManager,
      installationInfo,
      REPOSITORY_URL,
      RELEASES_URL,
      uninstallApplication,
      createRevisionHistory,
      extractCitation,
      checkLinks,
      fetchQuoteSource,
      keyDefinitions,
      readConfig,
      writeConfig,
      resolveInVault,
      assertMainFrameSender,
      buildMenu,
      process,
    },
    state
  );
  registerVaultIpc(
    {
      app,
      ipcMain,
      dialog,
      shell,
      path,
      fs,
      fssync,
      randomUUID,
      SAMPLE_VAULT,
      DEFAULT_RETENTION,
      NOTE_EXTS,
      walk,
      readVaultSnapshot,
      registerMcp,
      ...vault,
      assertMainFrameSender,
      process,
    },
    state,
    history
  );
}

const primary = registerFlowFiles({
  app,
  ipcMain,
  getWindow: () => state.win,
  createWindow,
  getVaultRoot: () => state.vaultRoot,
  openVault,
});

if (primary) {
  registerUriHandler({ app, ipcMain, getWindow: () => state.win, createWindow });
  app.whenReady().then(() => {
    cleanupConfigTemps();
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
      getWindow: () => state.win,
      getVaultRoot: () => state.vaultRoot,
      readConfig,
      writeConfig,
    });
    registerTabroom({ ipcMain, session, BrowserWindow, dialog, getWindow: () => state.win });
    state.closeWebsiteView = registerBrowser({ ipcMain, shell, getWindow: () => state.win });
    registerPandoc({ ipcMain, dialog, getWindow: () => state.win, readConfig, writeConfig });
    registerDocuments({ ipcMain, dialog, getWindow: () => state.win, readConfig });
    registerGoogleDocs({ app, ipcMain, safeStorage, dialog, shell, getWindow: () => state.win });
    registerFonts({ app, ipcMain, dialog, getWindow: () => state.win });
    registerTimerSound({ app, ipcMain, dialog, getWindow: () => state.win });
    registerFloatingTimer({
      ipcMain,
      BrowserWindow,
      screen,
      getWindow: () => state.win,
      assertMainFrameSender,
    });
    registerScholarlySearch({ ipcMain, assertMainFrameSender });
    if (!disableExtensions) {
      registerExtensions({
        app,
        ipcMain,
        shell,
        readConfig,
        writeConfig,
        dialog,
        getWindow: () => state.win,
        safeStorage,
        getVaultRoot: () => state.vaultRoot,
        assertMainFrameSender,
      });
    }
    const embeddings = registerEmbeddings({
      app,
      ipcMain,
      safeStorage,
      getVaultRoot: () => state.vaultRoot,
      readConfig,
      writeConfig,
      assertMainFrameSender,
    });
    const nli = registerNli({
      app,
      ipcMain,
      dialog,
      getWindow: () => state.win,
      readConfig,
      writeConfig,
      readToken: embeddings.readToken,
      assertMainFrameSender,
    });
    const summary = registerSummarization({ app, ipcMain, readConfig, assertMainFrameSender });
    state.localModels = { embeddings, nli, summary };
    createWindow();
    // Quietly check for and download an update shortly after startup. Never
    // fails startup and never installs without the user choosing Install.
    // Safe mode (and the explicit disable flag) skip this background check.
    if (!safeMode && process.env.TAGLINE_DISABLE_AUTO_UPDATE !== '1') {
      const delay = updateCheckDelayMs;
      setTimeout(() => {
        state.prepareUpdateInBackground().catch(() => {});
      }, delay).unref?.();
    }
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('before-quit', () => {
  state.quitRequested = true;
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !state.mcp?.shouldKeepRunning()) {
    app.quit();
  }
});
