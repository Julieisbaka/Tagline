function registerAppIpc(
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
    assertModelSender,
    buildMenu,
    process,
  },
  state
) {
  registerNativeUi({ ipcMain, nativeTheme, Menu, dialog, getWindow: () => state.win });
  registerSpellcheck({ ipcMain, assertMainFrame: assertModelSender });
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
      if (state.win && !state.win.isDestroyed()) {
        state.win.webContents.send('app:updateState', state);
      }
    },
  });
  state.prepareUpdateInBackground = async () => {
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
    const result = await updates.installUpdate(state.saveBeforeUpdate);
    if (!result.manual) {
      state.updateQuit = true;
      app.quit();
    }
    return result;
  });
  ipcMain.handle('app:autoUpdate', async (event) => {
    requireMainFrame(event);
    const outcome = await updates.autoUpdate(installationInfo(app).version, state.saveBeforeUpdate);
    if (outcome.updated && outcome.result && !outcome.result.manual) {
      state.updateQuit = true;
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
      state.prepareUpdateInBackground().catch(() => {});
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
    getVaultRoot: () => state.vaultRoot,
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
    state.keybindings = { ...overrides };
    buildMenu();
  });

  return history;
}

module.exports = { registerAppIpc };
