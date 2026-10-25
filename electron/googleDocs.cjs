const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_BYTES = 5 * 1024 * 1024;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ERROR_MESSAGES = {
  400: 'Invalid request or document title.',
  401: 'The webhook secret is incorrect. Update it in Settings.',
  405: 'The webhook requires POST. Check the deployed script version.',
  413: 'The document exceeds the 5 MiB upload limit.',
  415: 'The webhook accepts only DOCX and HTML.',
  422: 'The document content is empty or incorrectly encoded.',
  500: 'The webhook encountered an unexpected error. Check Apps Script.',
  502: 'Drive could not create the Google Doc. Check authorization, folder access, conversion support, storage, and quotas.',
  503: 'Configure WEBHOOK_SECRET and enable the advanced Google Drive service (v3).',
};

function validateEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter a Google Apps Script deployment URL.');
  const clean = value.trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(clean))
    throw new Error('Use the https://script.google.com/macros/s/DEPLOYMENT_ID/exec web app URL, without query parameters.');
  return clean;
}

function validateTitle(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[\u0000-\u001f]/.test(value))
    throw new Error('Use a document title of 1-200 characters without control characters.');
  return value.trim();
}

async function readReply(response) {
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
  if (result.code !== 201 || !result.ok) {
    if (result.ok || !Object.hasOwn(ERROR_MESSAGES, result.code))
      throw new Error('The Google Docs webhook returned an unsupported result code.');
    throw new Error(`Google Docs (${result.code}): ${ERROR_MESSAGES[result.code]}`);
  }
  const doc = result.document;
  if (!doc || typeof doc.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(doc.id) ||
      doc.url !== `https://docs.google.com/document/d/${doc.id}/edit` || typeof doc.title !== 'string')
    throw new Error('The webhook returned invalid document details. Check Drive before retrying.');
  return { canceled: false, code: 201, document: { id: doc.id, title: doc.title, url: doc.url } };
}

function createGoogleDocs({ app, safeStorage, dialog, shell, getWindow, fetchImpl = fetch }) {
  const configFile = path.join(app.getPath('userData'), 'google-docs.json');
  let sending = false;
  const readConfig = async () => {
    let contents;
    try { contents = await fs.readFile(configFile, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const config = JSON.parse(contents);
    if (!config || typeof config.endpoint !== 'string' || typeof config.encryptedSecret !== 'string' || !config.encryptedSecret)
      throw new Error('The saved Google Docs configuration is invalid. Disconnect and configure it again.');
    validateEndpoint(config.endpoint);
    return config;
  };
  const status = async () => {
    const config = await readConfig();
    return {
      endpoint: config?.endpoint || '',
      configured: !!config,
      encryptionAvailable: await safeStorage.isAsyncEncryptionAvailable(),
    };
  };
  const save = async (endpoint, secret) => {
    endpoint = validateEndpoint(endpoint);
    if (typeof secret !== 'string') throw new Error('Enter a webhook secret.');
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('OS credential encryption is unavailable.');
    let encryptedSecret;
    if (secret === '') {
      const current = await readConfig();
      if (!current) throw new Error('Enter the WEBHOOK_SECRET from Apps Script.');
      encryptedSecret = current.encryptedSecret;
    } else {
      if (!/^[!-~]{32,256}$/.test(secret)) throw new Error('The webhook secret must contain 32-256 non-space ASCII characters.');
      encryptedSecret = (await safeStorage.encryptStringAsync(secret)).toString('base64');
    }
    await fs.mkdir(path.dirname(configFile), { recursive: true });
    const temporary = `${configFile}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify({ endpoint, encryptedSecret }), { mode: 0o600 });
      await fs.rename(temporary, configFile);
    } finally { await fs.rm(temporary, { force: true }); }
    return status();
  };
  const disconnect = async () => {
    await fs.rm(configFile, { force: true });
    return status();
  };
  const upload = async (title, mimeType, bytes) => {
    title = validateTitle(title);
    if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('Upload a non-empty document no larger than 5 MiB.');
    if (sending) throw new Error('A Google Docs upload is already in progress.');
    sending = true;
    try {
      const config = await readConfig();
      if (!config) throw new Error('Set up Google Docs in Settings > Integrations first.');
      if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('OS credential encryption is unavailable.');
      let secret;
      try { secret = (await safeStorage.decryptStringAsync(Buffer.from(config.encryptedSecret, 'base64'))).result; }
      catch { throw new Error('Cannot decrypt the saved webhook secret. Re-enter it in Settings.'); }
      const confirmation = await dialog.showMessageBox(getWindow(), {
        type: 'question', message: 'Send this document to Google Drive?',
        detail: `"${title}" (${bytes.length} bytes)\n${config.endpoint}\n\nThis sends the document to your deployed Google Apps Script and creates a new Google Doc in its owner's Drive. It does not change sharing permissions. Formatting may change during conversion.`,
        buttons: ['Cancel', 'Send to Google Docs'], defaultId: 0, cancelId: 0, noLink: true,
      });
      if (confirmation.response !== 1) return { canceled: true };
      const signal = AbortSignal.timeout(120000);
      let response;
      try {
        response = await fetchImpl(config.endpoint, {
          method: 'POST', redirect: 'manual', signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret, title, mimeType, contentBase64: bytes.toString('base64') }),
        });
        // ContentService redirects to a one-time URL. Never forward the secret/body there.
        if ([302, 303].includes(response.status)) {
          const location = response.headers.get('location');
          const redirect = location ? new URL(location, config.endpoint) : null;
          if (!redirect || redirect.origin !== 'https://script.googleusercontent.com' || redirect.username || redirect.password)
            throw new Error('Untrusted redirect');
          await response.body?.cancel();
          response = await fetchImpl(redirect.href, { method: 'GET', redirect: 'error', signal });
        }
      } catch {
        throw new Error('Google Docs transfer failed or timed out. Check the deployment and connection, then check Drive before retrying; the document may already exist.');
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Google Docs HTTP ${response.status}. Check the deployment permissions and quotas. Check Drive before retrying.`);
      }
      return await readReply(response);
    } finally { sending = false; }
  };
  const sendNote = async (document) => {
    if (!document || typeof document.html !== 'string') throw new Error('Invalid Google Docs note export.');
    return upload(document.title, 'text/html', Buffer.from(document.html, 'utf8'));
  };
  const uploadFile = async () => {
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
    return upload(path.basename(file, suffix), extension === '.docx' ? DOCX : 'text/html', await fs.readFile(file));
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
  const openDocument = async (url) => {
    if (typeof url !== 'string' || !/^https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]+\/edit$/.test(url))
      throw new Error('Invalid Google Docs document URL.');
    await shell.openExternal(url);
  };
  return { status, save, disconnect, sendNote, uploadFile, saveScript, openDocument };
}

function registerGoogleDocs(options) {
  const service = createGoogleDocs(options);
  for (const name of ['status', 'save', 'disconnect', 'sendNote', 'uploadFile', 'saveScript', 'openDocument'])
    options.ipcMain.handle(`googleDocs:${name}`, (_event, ...args) => service[name](...args));
  options.ipcMain.handle('googleDocs:openSetup', () => options.shell.openExternal('https://script.google.com/home/start'));
  return service;
}

module.exports = { createGoogleDocs, registerGoogleDocs, validateEndpoint, MAX_BYTES, DOCX };
