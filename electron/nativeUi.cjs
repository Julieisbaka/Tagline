// Converts Tagline shortcut syntax to an Electron accelerator shown beside a native menu item.
function toAccelerator(shortcut) {
  if (!shortcut) {
    return undefined;
  }
  return shortcut
    .replace(/\bMod\b/g, 'CmdOrCtrl')
    .replace(/\bMeta\b/g, 'Super')
    .replace(/\bArrow(Up|Down|Left|Right)\b/g, '$1')
    .replace(/\bEscape\b/g, 'Esc');
}

function registerNativeUi({ ipcMain, nativeTheme, Menu, dialog, getWindow }) {
  let enabled = false;
  const authorize = (event) => {
    const win = getWindow();
    if (
      !win ||
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    ) {
      throw new Error('Native UI is only available to the application.');
    }
    return win;
  };
  ipcMain.handle('app:setNativeUi', (event, options) => {
    authorize(event);
    if (
      !options ||
      typeof options.enabled !== 'boolean' ||
      !['light', 'dark'].includes(options.mode)
    ) {
      throw new Error('Invalid native UI preferences.');
    }
    enabled = options.enabled;
    nativeTheme.themeSource = enabled ? options.mode : 'system';
  });
  ipcMain.handle('app:nativeContextMenu', (event, items) => {
    const win = authorize(event);
    if (!enabled) {
      throw new Error('Native UI is disabled.');
    }
    if (
      !Array.isArray(items) ||
      !items.length ||
      items.length > 100 ||
      items.some(
        (item) =>
          !item ||
          (item.separator
            ? Object.keys(item).some((key) => key !== 'separator')
            : typeof item.label !== 'string' ||
              item.label.length > 2000 ||
              typeof item.disabled !== 'boolean' ||
              (item.accelerator !== undefined && typeof item.accelerator !== 'string'))
      )
    ) {
      throw new Error('Invalid native menu.');
    }
    return new Promise((resolve) => {
      let selected = null;
      const build = (withAccelerators) =>
        Menu.buildFromTemplate(
          items.map((item, index) =>
            item.separator
              ? { type: 'separator' }
              : {
                  label: item.label,
                  enabled: !item.disabled,
                  ...(withAccelerators && toAccelerator(item.accelerator)
                    ? { accelerator: toAccelerator(item.accelerator), registerAccelerator: false }
                    : {}),
                  click: () => {
                    selected = index;
                  },
                }
          )
        );
      let menu;
      try {
        menu = build(true);
      } catch {
        // An unsupported key name must not stop the menu from opening.
        menu = build(false);
      }
      menu.popup({ window: win, callback: () => resolve(selected) });
    });
  });
  ipcMain.handle('app:nativeConfirm', async (event, options) => {
    const win = authorize(event);
    if (!enabled) {
      throw new Error('Native UI is disabled.');
    }
    if (
      !options ||
      ['message', 'title', 'cancel', 'confirm'].some(
        (key) => typeof options[key] !== 'string' || options[key].length > 100000
      )
    ) {
      throw new Error('Invalid confirmation.');
    }
    const result = await dialog.showMessageBox(win, {
      type: 'question',
      title: options.title,
      message: options.message,
      buttons: [options.cancel, options.confirm],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return result.response === 1;
  });
}

module.exports = { registerNativeUi };
