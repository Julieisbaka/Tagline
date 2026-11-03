const path = require('node:path');

const SCHEME = 'tagline';
const MAX_URI_LENGTH = 2000;

/**
 * Parse a `tagline://` link. Supported forms:
 *   tagline://note/<vault-relative path>[#heading]
 * Returns null for anything else, including paths that could leave the vault.
 */
function parseTaglineUri(value) {
  if (typeof value !== 'string' || value.length > MAX_URI_LENGTH) {
    return null;
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== `${SCHEME}:` || url.username || url.password || url.port) {
    return null;
  }
  if (url.hostname !== 'note') {
    return null;
  }
  let relative;
  try {
    relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  } catch {
    return null;
  }
  const parts = relative.split('/');
  const unsafe =
    !relative ||
    relative.includes('\0') ||
    relative.includes('\\') ||
    path.isAbsolute(relative) ||
    /^[a-z]:/i.test(relative) ||
    parts.some((part) => !part || part === '.' || part.startsWith('.'));
  if (unsafe) {
    return null;
  }
  let heading = '';
  try {
    heading = decodeURIComponent(url.hash.replace(/^#/, ''));
  } catch {
    // An undecodable fragment is ignored; the note still opens.
  }
  return { action: 'open', path: relative, heading: heading.slice(0, 200) };
}

function uriArguments(argv) {
  return argv.filter(
    (value) => typeof value === 'string' && value.toLowerCase().startsWith(`${SCHEME}://`)
  );
}

function noteUri(relativePath, heading) {
  const encoded = relativePath.split('/').map(encodeURIComponent).join('/');
  return `${SCHEME}://note/${encoded}${heading ? `#${encodeURIComponent(heading)}` : ''}`;
}

function registerUriHandler({ app, ipcMain, getWindow, createWindow, argv = process.argv }) {
  const pending = [];
  const enqueue = (values) => {
    for (const value of values) {
      const action = parseTaglineUri(value);
      if (action && pending.length < 20) {
        pending.push(action);
      }
    }
    const win = getWindow();
    if (pending.length && win && !win.isDestroyed()) {
      if (win.isMinimized()) {
        win.restore();
      }
      win.show();
      win.focus();
      win.webContents.send('uri:available');
    }
  };

  // Packaged apps register the scheme plainly; during development the launcher needs the app path.
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(SCHEME);
  }
  enqueue(uriArguments(argv));
  app.on('open-url', (event, url) => {
    event.preventDefault();
    enqueue([url]);
    if (app.isReady() && (!getWindow() || getWindow().isDestroyed())) {
      createWindow();
    }
  });
  // The window is created by the single-instance handler in flowFiles.cjs.
  app.on('second-instance', (_event, commandLine) => enqueue(uriArguments(commandLine)));
  ipcMain.handle('uri:pending', () => pending.shift() || null);
  return { enqueue };
}

module.exports = { registerUriHandler, parseTaglineUri, uriArguments, noteUri, SCHEME };
