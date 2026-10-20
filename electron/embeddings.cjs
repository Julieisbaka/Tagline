const { Worker } = require('node:worker_threads');
const path = require('node:path');
const fs = require('node:fs/promises');

const MODEL = 'Xenova/all-MiniLM-L6-v2';
const MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', path.join('onnx', 'model_quantized.onnx')];

function registerEmbeddings({ app, ipcMain, safeStorage, getVaultRoot, readConfig, writeConfig }) {
  const storage = path.join(app.getPath('userData'), 'semantic-search');
  const tokenFile = path.join(storage, 'huggingface-token.bin');
  const modelDir = path.join(storage, 'models', ...MODEL.split('/'));
  let worker;
  let sequence = 0;
  let tokenConfigured = false;
  let state = { busy: false, ready: false, detail: 'Model not downloaded yet.', error: '' };
  let autoload = null;
  const pending = new Map();

  async function modelDownloaded() {
    try {
      await Promise.all(MODEL_FILES.map((file) => fs.access(path.join(modelDir, file))));
      return true;
    } catch (e) {
      if (e.code === 'ENOENT') return false;
      throw e;
    }
  }

  async function readToken() {
    let encrypted;
    try {
      encrypted = await fs.readFile(tokenFile);
    } catch (e) {
      if (e.code === 'ENOENT') { tokenConfigured = false; return ''; }
      throw e;
    }
    tokenConfigured = true;
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable.');
    return safeStorage.decryptString(encrypted);
  }

  function ensureWorker() {
    if (worker) return;
    worker = new Worker(path.join(__dirname, 'embeddingWorker.cjs'), { workerData: { storage } });
    const instance = worker;
    const fail = (e) => {
      if (worker !== instance) return;
      state = { ...state, busy: false, ready: false, error: e.message };
      for (const task of pending.values()) task.reject(e);
      pending.clear();
      worker = null;
    };
    worker.on('message', (message) => {
      if (message.progress) {
        state = { ...state, detail: message.progress };
        return;
      }
      const task = pending.get(message.id);
      if (!task) return;
      pending.delete(message.id);
      state = { ...state, busy: pending.size > 0, error: message.error || '' };
      if (message.error) task.reject(new Error(message.error));
      else {
        state.ready = true;
        state.detail = 'Model ready. Embeddings run locally.';
        task.resolve(message.result);
      }
    });
    worker.on('error', fail);
    worker.on('exit', (code) => {
      if (worker !== instance) return;
      if (pending.size) fail(new Error(`Embedding worker exited (${code}).`));
      worker = null;
    });
  }

  function request(message) {
    if (state.busy) throw new Error('An embedding task is already running. Please wait for it to finish.');
    ensureWorker();
    state = { ...state, busy: true, error: '' };
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...message, id });
    });
  }

  ipcMain.handle('embeddings:status', async () => {
    // Inspect presence, but never return the saved token to the renderer.
    try { await fs.access(tokenFile); tokenConfigured = true; }
    catch (e) { if (e.code !== 'ENOENT') throw e; tokenConfigured = false; }
    return {
      ...state, downloaded: state.ready || await modelDownloaded(),
      autoload: readConfig().modelAutoload !== false,
      tokenConfigured, encryptionAvailable: safeStorage.isEncryptionAvailable(),
    };
  });
  ipcMain.handle('embeddings:autoload', async (_e, enabled) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid model autoload preference.');
    writeConfig({ modelAutoload: enabled });
    if (enabled && !state.ready && !state.busy) await loadDownloaded();
    return { autoload: enabled };
  });
  ipcMain.handle('embeddings:token', async (_e, token) => {
    if (typeof token !== 'string') throw new Error('Invalid Hugging Face token.');
    const clean = token.trim();
    if (!clean) {
      await fs.rm(tokenFile, { force: true });
      tokenConfigured = false;
    } else {
      if (!/^hf_[A-Za-z0-9]+$/.test(clean)) throw new Error('Expected a Hugging Face token beginning with hf_.');
      if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable; token was not saved.');
      await fs.mkdir(storage, { recursive: true });
      await fs.writeFile(tokenFile, safeStorage.encryptString(clean), { mode: 0o600 });
      tokenConfigured = true;
    }
    return { tokenConfigured };
  });
  ipcMain.handle('embeddings:download', async () => {
    await autoload;
    if (state.ready) return { ready: true, model: MODEL };
    return request({ type: 'download', token: await readToken() });
  });
  ipcMain.handle('embeddings:search', async (_e, { query, documents, maxResults = 200 }) => {
    await autoload;
    const vault = getVaultRoot();
    if (!vault) throw new Error('Open a vault first.');
    if (typeof query !== 'string' || !query.trim() || !documents || Array.isArray(documents) ||
        !Number.isInteger(maxResults) || maxResults < 1 || maxResults > 1000) {
      throw new Error('Invalid semantic search request.');
    }
    for (const [file, content] of Object.entries(documents)) {
      if (!file.endsWith('.md') || typeof content !== 'string') throw new Error('Invalid search document.');
    }
    return request({ type: 'search', query: query.trim(), documents, vault, maxResults });
  });
  app.on('before-quit', () => { if (worker) worker.terminate(); });

  // Load an already-downloaded model in the background so search is ready without visiting Settings.
  async function loadDownloaded() {
    if (!(await modelDownloaded())) return;
    state = { ...state, detail: 'Loading downloaded model...' };
    await request({ type: 'load' });
  }
  autoload = (readConfig().modelAutoload !== false ? loadDownloaded() : Promise.resolve())
    .catch((e) => {
      state = { ...state, busy: false, ready: false, error: e.message };
      console.error('Model autoload failed:', e);
    }).finally(() => { autoload = null; });
}

module.exports = { registerEmbeddings };
