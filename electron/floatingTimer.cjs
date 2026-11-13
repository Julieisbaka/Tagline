const path = require('node:path');

function registerFloatingTimer({
  ipcMain,
  BrowserWindow,
  screen,
  getWindow,
  assertMainFrameSender,
}) {
  let overlay = null;
  let latest = null;
  let position = null;
  const close = () => {
    latest = null;
    if (overlay && !overlay.isDestroyed()) {
      overlay.destroy();
    }
    overlay = null;
  };
  ipcMain.on('timer:overlay', (event, data) => {
    try {
      assertMainFrameSender(event, 'Floating timer');
    } catch {
      return;
    }
    if (data === null) {
      close();
      return;
    }
    if (
      !data ||
      !['label', 'time', 'status'].every(
        (key) => typeof data[key] === 'string' && data[key].length <= 100
      )
    ) {
      return;
    }
    latest = { label: data.label, time: data.time, status: data.status };
    if (!overlay || overlay.isDestroyed()) {
      const owner = getWindow();
      const area = screen.getDisplayMatching(position || owner.getBounds()).workArea;
      overlay = new BrowserWindow({
        width: 220,
        height: 110,
        x: Math.max(
          area.x,
          Math.min(position?.x ?? area.x + area.width - 240, area.x + area.width - 220)
        ),
        y: Math.max(area.y, Math.min(position?.y ?? area.y + 20, area.y + area.height - 110)),
        frame: false,
        resizable: false,
        show: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        webPreferences: {
          preload: path.join(__dirname, 'floatingTimerPreload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      const window = overlay;
      window.on('moved', () => {
        position = window.getBounds();
      });
      window.webContents.once('did-finish-load', () => {
        if (latest && !window.isDestroyed()) {
          window.webContents.send('timer:state', latest);
          window.showInactive();
        }
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (navigation) => navigation.preventDefault());
      const onNavigation = (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) {
          close();
        }
      };
      window.on('closed', () => {
        owner.removeListener('closed', close);
        owner.webContents.removeListener('render-process-gone', close);
        owner.webContents.removeListener('did-start-navigation', onNavigation);
        if (overlay === window) {
          overlay = null;
        }
      });
      owner.once('closed', close);
      owner.webContents.once('render-process-gone', close);
      owner.webContents.on('did-start-navigation', onNavigation);
      window.loadFile(path.join(__dirname, 'floatingTimer.html'));
    } else if (!overlay.webContents.isLoading()) {
      overlay.webContents.send('timer:state', latest);
    }
  });
}

module.exports = { registerFloatingTimer };
