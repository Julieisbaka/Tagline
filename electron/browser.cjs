const { WebContentsView } = require('electron');

function webUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) throw new Error('Invalid website URL.');
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Only HTTP and HTTPS website URLs without embedded credentials are supported.');
  }
  return url.href;
}

// Many sites reject Electron's default user agent outright. Present the plain Chromium/Chrome identity this
// view actually is
function browserUserAgent(agent) {
  return agent.replace(/\s(?:Electron|tagline)\/\S+/gi, '');
}

// Wayback Machine snapshot of a page, for dead links or pages that are hard to load directly.
function archiveUrl(value) {
  return `https://web.archive.org/web/${webUrl(value)}`;
}

function registerBrowser({ ipcMain, shell, getWindow }) {
  let view;
  let error = '';
  let downloadHandler;
  let browserSession;
  let resizeHandler;
  const close = () => {
    if (!view) return;
    const previous = view;
    view = null;
    if (downloadHandler) browserSession.removeListener('will-download', downloadHandler);
    const window = getWindow();
    if (window && !window.isDestroyed()) {
      if (resizeHandler) window.removeListener('resize', resizeHandler);
      window.contentView.removeChildView(previous);
    }
    if (!previous.webContents.isDestroyed()) previous.webContents.close();
  };
  const state = () => {
    if (!view || view.webContents.isDestroyed()) return;
    const wc = view.webContents;
    getWindow()?.webContents.send('browser:state', {
      url: wc.getURL(), loading: wc.isLoading(), error,
      canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward(),
    });
  };
  const navigate = async (url) => {
    const wc = view.webContents;
    error = '';
    try { await wc.loadURL(webUrl(url)); }
    catch (e) {
      if (view?.webContents === wc && e.code !== 'ERR_ABORTED') { error = e.message; state(); }
    }
  };
  const bounds = (value) => {
    if (!value || !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(value[key]))) {
      throw new Error('Invalid website view bounds.');
    }
    const [width, height] = getWindow().getContentSize();
    const scale = getWindow().webContents.getZoomFactor();
    const x = Math.max(0, Math.min(width - 1, Math.round(value.x * scale)));
    const y = Math.max(0, Math.min(height - 1, Math.round(value.y * scale)));
    return {
      x, y, width: Math.max(1, Math.min(width - x, Math.round(value.width * scale))),
      height: Math.max(1, Math.min(height - y, Math.round(value.height * scale)))
    };
  };
  const handle = (channel, action) => ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== getWindow()?.webContents || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('Website controls are only available to the application.');
    }
    return action(...args);
  });
  handle('browser:open', async (url, rectangle) => {
    const target = webUrl(url);
    const box = bounds(rectangle);
    close();
    error = '';
    view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false, contextIsolation: true, sandbox: true,
        partition: 'persist:tagline-web', webSecurity: true,
      }
    });
    const wc = view.webContents;
    wc.session.setUserAgent(browserUserAgent(wc.session.getUserAgent()));
    wc.setUserAgent(browserUserAgent(wc.getUserAgent()));
    wc.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    wc.session.setPermissionCheckHandler(() => false);
    wc.session.setDevicePermissionHandler(() => false);
    // Downloads are deliberately not exposed through the embedded browser.
    browserSession = wc.session;
    downloadHandler = (event) => {
      event.preventDefault();
      error = 'Downloads are disabled here. Use Open in browser to download files.';
      state();
    };
    wc.session.on('will-download', downloadHandler);
    const checkNavigation = (event, destination) => {
      try { webUrl(destination); }
      catch (e) { event.preventDefault(); error = e.message; state(); }
    };
    wc.on('will-navigate', checkNavigation);
    wc.on('will-redirect', checkNavigation);
    wc.setWindowOpenHandler(({ url: destination }) => {
      try { webUrl(destination); void navigate(destination); }
      catch (e) { error = e.message; state(); }
      return { action: 'deny' };
    });
    for (const event of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page']) wc.on(event, state);
    wc.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) { error = description; state(); }
    });
    wc.on('render-process-gone', (_event, details) => {
      error = `Website renderer stopped: ${details.reason}`; state();
    });
    getWindow().contentView.addChildView(view);
    view.setBounds(box);
    // Request fresh layout even when native content throttles ResizeObserver.
    resizeHandler = () => getWindow()?.webContents.send('browser:resize');
    getWindow().on('resize', resizeHandler);
    await navigate(target);
  });
  handle('browser:bounds', (rectangle) => {
    if (!view) return;
    const box = bounds(rectangle);
    view.setBounds(box);
  });
  handle('browser:close', close);
  handle('browser:action', async (action, url) => {
    if (action === 'external') return shell.openExternal(webUrl(url));
    if (!view) throw new Error('No website is open.');
    const wc = view.webContents;
    if (action === 'navigate') return navigate(url);
    if (action === 'archive') return navigate(archiveUrl(url));
    if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    else if (action === 'reload') { error = ''; wc.reload(); }
    else throw new Error('Website navigation is unavailable.');
  });
  return close;
}

module.exports = { registerBrowser, webUrl, browserUserAgent, archiveUrl };
