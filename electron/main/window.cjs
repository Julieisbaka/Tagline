function createWindowManager(
  { app, BrowserWindow, ipcMain, dialog, Menu, path, keyDefinitions, isDev, process, mainDir },
  state
) {
  function accelerator(id) {
    const value = state.keybindings[id] ?? keyDefinitions.find((item) => item.id === id)?.key;
    return value ? value.replace(/\bMod\b/g, 'CmdOrCtrl').replace(/\bMeta\b/g, 'Super') : undefined;
  }

  function createWindow() {
    state.win = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 900,
      minHeight: 600,
      backgroundColor: '#1e1e1e',
      title: 'Tagline',
      icon: path.join(
        mainDir,
        '..',
        'build',
        process.platform === 'win32' ? 'icon.ico' : 'icon.png'
      ),
      ...(process.platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 } }
        : {}),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(mainDir, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        additionalArguments: [
          `--tagline-languages=${encodeURIComponent(JSON.stringify(app.getPreferredSystemLanguages()))}`,
        ],
      },
    });

    let readyToClose = false;
    let preparingClose = false;
    let hasSaveHandler = false;
    let closeTimer;
    // Close handshake policy: a saved workspace closes (or resumes a pending quit),
    // while a failed save, timeout, or renderer crash cancels both window close and
    // any app.quit() that was waiting on it, leaving the window open.
    const finishClose = (saved) => {
      if (!preparingClose) {
        return false;
      }
      preparingClose = false;
      clearTimeout(closeTimer);
      closeTimer = undefined;
      if (!saved) {
        state.quitRequested = false;
      }
      return true;
    };
    state.saveBeforeUpdate = () =>
      new Promise((resolve, reject) => {
        if (
          !hasSaveHandler ||
          preparingClose ||
          state.win.webContents.isDestroyed() ||
          state.win.webContents.isCrashed()
        ) {
          reject(
            new Error(
              'Wait for the workspace to finish loading or saving, then try installing again.'
            )
          );
          return;
        }
        const target = state.win;
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
        const closed = () =>
          finish(new Error('The workspace closed before the update could start.'));
        const timeout = setTimeout(
          () => finish(new Error('Timed out waiting for pending edits to save. Try again.')),
          60000
        );
        ipcMain.on('app:closeReady', saved);
        target.once('closed', closed);
        target.webContents.send('app:prepareClose');
      });
    const saveHandlerReady = (event, ready) => {
      if (event.sender === state.win?.webContents) {
        hasSaveHandler = ready === true;
      }
    };
    const closeReady = (event, success) => {
      const saved = success === true;
      if (event.sender !== state.win?.webContents || !finishClose(saved)) {
        return;
      }
      if (!saved) {
        return;
      }
      readyToClose = true;
      if (state.quitRequested) {
        app.quit();
      } else {
        state.win.close();
      }
    };
    ipcMain.on('app:closeReady', closeReady);
    ipcMain.on('app:saveHandlerReady', saveHandlerReady);
    state.win.once('closed', () => {
      clearTimeout(closeTimer);
      closeTimer = undefined;
      preparingClose = false;
      ipcMain.removeListener('app:closeReady', closeReady);
      ipcMain.removeListener('app:saveHandlerReady', saveHandlerReady);
    });
    state.win.on('close', (event) => {
      if (
        !state.updateQuit &&
        !readyToClose &&
        hasSaveHandler &&
        !state.win.webContents.isDestroyed() &&
        !state.win.webContents.isCrashed()
      ) {
        event.preventDefault();
        if (!preparingClose) {
          preparingClose = true;
          closeTimer = setTimeout(() => {
            if (!preparingClose) {
              return;
            }
            console.warn('Timed out waiting for pending edits to save; keeping the window open.');
            if (state.win && !state.win.isDestroyed() && dialog) {
              dialog
                .showMessageBox(state.win, {
                  type: 'warning',
                  title: 'Save not confirmed',
                  message: 'Tagline could not confirm the pending edits were saved, so close was cancelled.',
                  buttons: ['OK'],
                })
                .catch(() => {});
            }
            finishClose(false);
          }, 30000);
          closeTimer.unref?.();
          state.win.webContents.send('app:prepareClose');
        }
        return;
      }
      state.closeWebsiteView();
    });
    state.win.webContents.on('render-process-gone', () => {
      if (preparingClose) {
        console.warn('The window stopped responding while saving; quit cancelled.');
        if (state.win && !state.win.isDestroyed() && dialog) {
          dialog
            .showMessageBox(state.win, {
              type: 'error',
              title: 'Renderer stopped',
              message:
                'The window stopped responding while saving, so close was cancelled. Reload to recover unsaved work.',
              buttons: ['Reload', 'Cancel'],
            })
            .then((result) => {
              if (result.response === 0 && state.win && !state.win.isDestroyed()) {
                state.win.reload();
              }
            })
            .catch(() => {});
        }
        finishClose(false);
      }
      state.closeWebsiteView();
    });
    state.win.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) {
        state.closeWebsiteView();
      }
    });
    const openWebsite = (url) => state.win.webContents.send('browser:link', url);
    state.win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) {
        openWebsite(url);
      }
      return { action: 'deny' };
    });
    state.win.webContents.on('context-menu', (_event, params) => {
      if (params.frame === state.win.webContents.mainFrame && params.isEditable) {
        state.win.webContents.send('spellcheck:context', {
          word: params.misspelledWord || '',
          suggestions: (params.dictionarySuggestions || []).slice(0, 8),
        });
      }
    });
    state.win.webContents.on('will-frame-navigate', (event) => {
      if (event.isMainFrame) {
        return;
      }
      let destination;
      try {
        destination = new URL(event.url);
      } catch {
        console.warn('Blocked navigation to a malformed URL:', event.url);
        event.preventDefault();
        return;
      }
      if (destination.protocol === 'about:' && ['srcdoc', 'blank'].includes(destination.pathname)) {
        return;
      }
      const allowed = ['extension-sandbox.html', 'extension-webview.html'].map((file) =>
        isDev
          ? `http://localhost:5173/${file}`
          : require('node:url').pathToFileURL(path.join(mainDir, '..', 'dist', file)).href
      );
      if (!allowed.includes(destination.href)) {
        event.preventDefault();
      }
    });
    state.win.webContents.on('will-navigate', (e, url) => {
      let destination;
      let current;
      try {
        destination = new URL(url);
        current = new URL(state.win.webContents.getURL());
      } catch {
        console.warn('Blocked navigation to a malformed URL:', url);
        e.preventDefault();
        return;
      }
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
      state.win.loadURL('http://localhost:5173');
      state.win.webContents.openDevTools({ mode: 'detach' });
    } else {
      state.win.loadFile(path.join(mainDir, '..', 'dist', 'index.html'));
    }
  }

  function buildMenu() {
    const isMac = process.platform === 'darwin';
    const command = (name) => () => {
      if (!state.win || state.win.isDestroyed()) {
        createWindow();
        state.win.webContents.once('did-finish-load', () =>
          state.win.webContents.send('menu:command', name)
        );
      } else {
        state.win.webContents.send('menu:command', name);
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
        state.win && !state.win.isDestroyed()
          ? await dialog.showMessageBox(state.win, options)
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

  return { createWindow, buildMenu };
}

module.exports = { createWindowManager };
