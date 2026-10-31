const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createGoogleOAuth } = require('./googleOAuth.cjs');

const MAX_BYTES = 5 * 1024 * 1024;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ERROR_MESSAGES = {
  400: 'Invalid request or document title.',
  401: 'The webhook secret is incorrect. Update it in Settings.',
  405: 'The webhook requires POST. Check the deployed script version.',
  409: 'The webhook is running as a different Google account. No document was created. Reverify the selected connection in Settings.',
  413: 'The document exceeds the 5 MiB upload limit.',
  415: 'The webhook accepts only DOCX and HTML.',
  422: 'The document content is empty or incorrectly encoded.',
  500: 'The webhook encountered an unexpected error. Check Apps Script.',
  502: 'Drive could not verify the account or create the Google Doc. Check authorization, folder access, conversion support, storage, and quotas.',
  503: 'Configure WEBHOOK_SECRET, enable the advanced Google Drive service (v3), and ensure it can identify the executing account.',
};

function validateEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter a Google Apps Script deployment URL.');
  const clean = value.trim();
  let url;
  try { url = new URL(clean); }
  catch { throw new Error('Enter a valid Google Apps Script deployment URL.'); }
  const match = /^\/macros\/(?:u\/\d+\/)?s\/([A-Za-z0-9_-]+)\/exec$/.exec(url.pathname);
  if (url.origin !== 'https://script.google.com' || url.username || url.password || url.hash || !match ||
    [...url.searchParams.keys()].some((key) => key !== 'authuser') || url.searchParams.getAll('authuser').length > 1)
    throw new Error('Use the https://script.google.com/macros/s/DEPLOYMENT_ID/exec web app URL. Only an optional authuser account hint is accepted.');
  // Browser account indices do not select a web app's executing account.
  return `https://script.google.com/macros/s/${match[1]}/exec`;
}

function validateTitle(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[\u0000-\u001f]/.test(value))
    throw new Error('Use a document title of 1-200 characters without control characters.');
  return value.trim();
}

function validateAccount(value) {
  if (!value || typeof value.email !== 'string' || value.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) ||
    typeof value.displayName !== 'string' || value.displayName.length > 200 || /[\u0000-\u001f]/.test(value.displayName))
    throw new Error('The webhook did not identify a valid Google account. Update and redeploy the bundled script, then verify the connection.');
  return { email: value.email.toLowerCase(), displayName: value.displayName };
}

async function readReply(response, expectedCode) {
  const limit = 64 * 1024;
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new Error('The Google Docs webhook response is too large.');
  }
  if (!response.body) throw new Error('The Google Docs webhook returned an empty response.');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error('The Google Docs webhook response is too large.');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  let result;
  try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('The webhook did not return JSON. Deploy it for Anyone, using the /exec URL, and authorize the script.'); }
  if (!result || typeof result !== 'object' || !Number.isInteger(result.code) || typeof result.ok !== 'boolean')
    throw new Error('The Google Docs webhook returned an invalid result code.');
  if (result.code !== expectedCode || !result.ok) {
    if (result.ok || !Object.hasOwn(ERROR_MESSAGES, result.code))
      throw new Error('The Google Docs webhook returned an unsupported result code.');
    throw new Error(`Google Docs (${result.code}): ${ERROR_MESSAGES[result.code]}`);
  }
  const account = validateAccount(result.account);
  if (expectedCode === 200) return { account };
  const doc = result.document;
  if (!doc || typeof doc.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(doc.id) ||
    doc.url !== `https://docs.google.com/document/d/${doc.id}/edit` || typeof doc.title !== 'string')
    throw new Error('The webhook returned invalid document details. Check Drive before retrying.');
  return { canceled: false, code: 201, account, document: { id: doc.id, title: doc.title, url: doc.url, accountEmail: account.email } };
}

function createGoogleDocs({ app, safeStorage, dialog, shell, getWindow, fetchImpl = fetch }) {
  const oauth = createGoogleOAuth({ shell, fetchImpl });
  const configFile = path.join(app.getPath('userData'), 'google-docs.json');
  let sending = false;
  let configuring = false;
  const readConfig = async () => {
    let contents;
    try { contents = await fs.readFile(configFile, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return { version: 2, connections: [] }; throw error; }
    const config = JSON.parse(contents);
    if (!config || config.version !== 2 || !Array.isArray(config.connections) ||
      config.connections.some((connection) => !connection || typeof connection.id !== 'string' ||
        !/^[A-Za-z0-9_-]+$/.test(connection.id) ||
        (connection.type === 'oauth'
          ? typeof connection.encryptedTokens !== 'string' || !connection.encryptedTokens ||
          typeof connection.subject !== 'string' || !connection.subject || connection.subject.length > 255
          : (connection.type !== undefined && connection.type !== 'script') ||
          typeof connection.encryptedSecret !== 'string' || !connection.encryptedSecret)) ||
      new Set(config.connections.map((connection) => connection.id)).size !== config.connections.length)
      throw new Error('The saved Google Docs configuration is invalid. Disconnect and configure it again.');
    for (const connection of config.connections) {
      if (connection.type !== 'oauth') connection.endpoint = validateEndpoint(connection.endpoint);
      connection.account = validateAccount(connection.account);
    }
    return config;
  };
  const writeConfig = async (config) => {
    await fs.mkdir(path.dirname(configFile), { recursive: true });
    const temporary = `${configFile}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(config), { mode: 0o600 });
      await fs.rename(temporary, configFile);
    } finally { await fs.rm(temporary, { force: true }); }
  };
  const connectionFor = (config, id) => {
    const connection = config.connections.find((item) => item.id === id);
    if (!connection) throw new Error('Select a saved Google account connection in Settings > Integrations.');
    return connection;
  };
  const status = async () => {
    const config = await readConfig();
    return {
      connections: config.connections.map(({ id, endpoint, account, type }) => type === 'oauth'
        ? { id, type, account } : { id, type: 'script', endpoint, account }),
      configured: config.connections.some((connection) => !!connection.account),
      encryptionAvailable: await safeStorage.isAsyncEncryptionAvailable(),
    };
  };
  const request = async (endpoint, payload, expectedCode) => {
    const signal = AbortSignal.timeout(120000);
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST', redirect: 'manual', credentials: 'omit', signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      // ContentService redirects to a one-time URL. Never forward the secret/body there.
      if ([302, 303].includes(response.status)) {
        const location = response.headers.get('location');
        const redirect = location ? new URL(location, endpoint) : null;
        if (!redirect || redirect.origin !== 'https://script.googleusercontent.com' || redirect.username || redirect.password)
          throw new Error('Untrusted redirect');
        await response.body?.cancel();
        response = await fetchImpl(redirect.href, { method: 'GET', redirect: 'error', credentials: 'omit', signal });
      }
    } catch {
      throw new Error('Google Docs request failed or timed out. Check the deployment and connection, then check Drive before retrying an upload; the document may already exist.');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Google Docs HTTP ${response.status}. Check the deployment permissions and quotas. Check Drive before retrying.`);
    }
    return readReply(response, expectedCode);
  };
  const decrypt = async (connection) => {
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('OS credential encryption is unavailable.');
    try { return (await safeStorage.decryptStringAsync(Buffer.from(connection.encryptedSecret, 'base64'))).result; }
    catch { throw new Error('Cannot decrypt the saved webhook secret. Re-enter it in Settings.'); }
  };
  const save = async (endpoint, secret, connectionId) => {
    endpoint = validateEndpoint(endpoint);
    if (typeof secret !== 'string') throw new Error('Enter a webhook secret.');
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('OS credential encryption is unavailable.');
    if (configuring || sending) throw new Error('A Google Docs connection change or upload is already in progress.');
    configuring = true;
    try {
      const config = await readConfig();
      const current = connectionId === undefined ? null : connectionFor(config, connectionId);
      if (current?.type === 'oauth') throw new Error('Choose an Apps Script connection to edit its webhook.');
      let encryptedSecret;
      if (secret === '') {
        if (!current || current.endpoint !== endpoint) throw new Error('Enter the WEBHOOK_SECRET for this deployment; secrets cannot be reused across connections.');
        secret = await decrypt(current);
        encryptedSecret = current.encryptedSecret;
      } else {
        if (!/^[!-~]{32,256}$/.test(secret)) throw new Error('The webhook secret must contain 32-256 non-space ASCII characters.');
        encryptedSecret = (await safeStorage.encryptStringAsync(secret)).toString('base64');
      }
      if (config.connections.some((item) => item.id !== current?.id && item.endpoint === endpoint))
        throw new Error('This deployment already has a saved connection. Select it to update or verify it.');
      const { account } = await request(endpoint, { action: 'account', secret }, 200);
      const confirmation = await dialog.showMessageBox(getWindow(), {
        type: 'question', message: 'Connect to this Google account?',
        detail: `${account.email}\n${account.displayName}\n${endpoint}\n\nThis is the Google account executing the webhook, regardless of your active browser account. Confirm that it is your intended destination.`,
        buttons: ['Cancel', 'Save connection'], defaultId: 0, cancelId: 0, noLink: true,
      });
      if (confirmation.response !== 1) return { ...await status(), canceled: true };
      const connection = { id: current?.id || randomUUID(), endpoint, encryptedSecret, account };
      config.connections = current
        ? config.connections.map((item) => item.id === current.id ? connection : item)
        : [...config.connections, connection];
      await writeConfig(config);
      return { ...await status(), savedConnectionId: connection.id };
    } finally { configuring = false; }
  };
  const encryptTokens = async (refreshToken) => {
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('OS credential encryption is unavailable.');
    return (await safeStorage.encryptStringAsync(JSON.stringify({ refreshToken }))).toString('base64');
  };
  const decryptTokens = async (connection) => {
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('OS credential encryption is unavailable.');
    let tokens;
    try {
      tokens = JSON.parse((await safeStorage.decryptStringAsync(Buffer.from(connection.encryptedTokens, 'base64'))).result);
    } catch { throw new Error('Cannot decrypt Google authorization. Reconnect this account in Settings.'); }
    if (!tokens || typeof tokens.refreshToken !== 'string' || !tokens.refreshToken || tokens.refreshToken.length > 16384)
      throw new Error('Invalid saved Google authorization. Reconnect this account in Settings.');
    return tokens;
  };
  const connect = async () => {
    if (configuring || sending) throw new Error('A Google Docs connection change or upload is already in progress.');
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('OS credential encryption is unavailable.');
    configuring = true;
    try {
      const config = await readConfig();
      const identity = await oauth.authorize();
      const current = config.connections.find((item) => item.type === 'oauth' && item.subject === identity.subject);
      const confirmation = await dialog.showMessageBox(getWindow(), {
        type: 'question', message: 'Connect to this Google account?',
        detail: `${identity.account.email}\n\nDirect Google sign-in. Tagline will upload directly to Google Drive, without Apps Script. Nothing is uploaded until you confirm a document transfer.`,
        buttons: ['Cancel', 'Save connection'], defaultId: 0, cancelId: 0, noLink: true,
      });
      if (confirmation.response !== 1) return { ...await status(), canceled: true };
      const connection = {
        id: current?.id || randomUUID(), type: 'oauth', subject: identity.subject, account: identity.account,
        encryptedTokens: await encryptTokens(identity.refreshToken),
      };
      config.connections = current ? config.connections.map((item) => item.id === current.id ? connection : item)
        : [...config.connections, connection];
      await writeConfig(config);
      return { ...await status(), savedConnectionId: connection.id };
    } finally { configuring = false; }
  };
  const disconnect = async (connectionId) => {
    if (configuring || sending) throw new Error('A Google Docs connection change or upload is already in progress.');
    configuring = true;
    try {
      const config = await readConfig();
      const connection = connectionFor(config, connectionId);
      config.connections = config.connections.filter((item) => item.id !== connection.id);
      await writeConfig(config);
      return status();
    } finally { configuring = false; }
  };
  const upload = async (title, mimeType, bytes, connectionId) => {
    title = validateTitle(title);
    if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('Upload a non-empty document no larger than 5 MiB.');
    if (sending || configuring) throw new Error('A Google Docs upload or connection change is already in progress.');
    sending = true;
    try {
      const saved = await readConfig();
      const config = connectionFor(saved, connectionId);
      if (config.type === 'oauth') {
        const credentials = await decryptTokens(config);
        const tokens = await oauth.refresh(credentials.refreshToken);
        const identity = await oauth.account(tokens.accessToken);
        if (identity.subject !== config.subject || identity.account.email !== config.account.email)
          throw new Error('Google returned a different account. Reconnect the selected account before uploading.');
        if (tokens.refreshToken && tokens.refreshToken !== credentials.refreshToken) {
          config.encryptedTokens = await encryptTokens(tokens.refreshToken);
          await writeConfig(saved);
        }
        const confirmation = await dialog.showMessageBox(getWindow(), {
          type: 'question', message: 'Send this document to Google Drive?',
          detail: `"${title}" (${bytes.length} bytes)\nGoogle account: ${identity.account.email}\n\nDirect Google sign-in: sends this document directly to Google Drive and creates a new Google Doc. It does not change sharing permissions. Formatting may change during conversion.`,
          buttons: ['Cancel', 'Send to Google Docs'], defaultId: 0, cancelId: 0, noLink: true,
        });
        if (confirmation.response !== 1) return { canceled: true };
        const document = await oauth.upload(tokens.accessToken, title, mimeType, bytes);
        return {
          canceled: false, code: 201, account: identity.account,
          document: { ...document, accountEmail: identity.account.email }
        };
      }
      const secret = await decrypt(config);
      const { account } = await request(config.endpoint, { action: 'account', secret }, 200);
      if (account.email !== config.account.email) throw new Error(ERROR_MESSAGES[409]);
      const confirmation = await dialog.showMessageBox(getWindow(), {
        type: 'question', message: 'Send this document to Google Drive?',
        detail: `"${title}" (${bytes.length} bytes)\nGoogle account: ${account.email}\n${config.endpoint}\n\nThis sends the document to your deployed Google Apps Script and creates a new Google Doc in its owner's Drive. It does not change sharing permissions. Formatting may change during conversion.`,
        buttons: ['Cancel', 'Send to Google Docs'], defaultId: 0, cancelId: 0, noLink: true,
      });
      if (confirmation.response !== 1) return { canceled: true };
      const result = await request(config.endpoint, {
        action: 'upload', secret, expectedAccount: account.email, title, mimeType, contentBase64: bytes.toString('base64'),
      }, 201);
      if (result.account.email !== account.email)
        throw new Error('The webhook returned a different Google account. Check Drive before retrying; reverify the connection.');
      return result;
    } finally { sending = false; }
  };
  const sendNote = async (document) => {
    if (!document || typeof document.html !== 'string') throw new Error('Invalid Google Docs note export.');
    return upload(document.title, 'text/html', Buffer.from(document.html, 'utf8'), document.connectionId);
  };
  const uploadFile = async (connectionId) => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Send a document to Google Docs', properties: ['openFile'],
      filters: [{ name: 'DOCX and HTML documents', extensions: ['docx', 'html', 'htm'] }],
    });
    if (result.canceled) return { canceled: true };
    const file = result.filePaths[0];
    const suffix = path.extname(file);
    const extension = suffix.toLowerCase();
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_BYTES || !['.docx', '.html', '.htm'].includes(extension))
      throw new Error('Choose a DOCX or HTML file no larger than 5 MiB.');
    return upload(path.basename(file, suffix), extension === '.docx' ? DOCX : 'text/html', await fs.readFile(file), connectionId);
  };
  const saveScript = async () => {
    const result = await dialog.showSaveDialog(getWindow(), {
      title: 'Save Google Docs webhook script', defaultPath: 'tagline-google-docs.gs',
      filters: [{ name: 'Google Apps Script', extensions: ['gs'] }],
    });
    if (result.canceled) return { canceled: true };
    await fs.copyFile(path.join(__dirname, 'google-docs-webhook.gs'), result.filePath);
    return { canceled: false, path: result.filePath };
  };
  const openDocument = async (url, accountEmail) => {
    if (typeof url !== 'string' || !/^https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]+\/edit$/.test(url))
      throw new Error('Invalid Google Docs document URL.');
    const account = validateAccount({ email: accountEmail, displayName: '' });
    await shell.openExternal(`${url}?authuser=${encodeURIComponent(account.email)}`);
  };
  return { status, save, connect, cancelConnect: oauth.cancel, disconnect, sendNote, uploadFile, saveScript, openDocument };
}

function registerGoogleDocs(options) {
  const service = createGoogleDocs(options);
  const handle = (name, action) => options.ipcMain.handle(`googleDocs:${name}`, (event, ...args) => {
    const contents = options.getWindow()?.webContents;
    if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame)
      throw new Error('Google Docs is only available to the application main frame.');
    return action(...args);
  });
  for (const name of ['status', 'save', 'connect', 'cancelConnect', 'disconnect', 'sendNote', 'uploadFile', 'saveScript', 'openDocument'])
    handle(name, (...args) => service[name](...args));
  handle('openSetup', () => options.shell.openExternal('https://script.google.com/home/start'));
  options.app.once('before-quit', service.cancelConnect);
  return service;
}

module.exports = { createGoogleDocs, registerGoogleDocs, validateEndpoint, MAX_BYTES, DOCX };
