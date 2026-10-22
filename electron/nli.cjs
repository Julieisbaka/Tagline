const { Worker } = require('node:worker_threads');
const path = require('node:path');
const fs = require('node:fs/promises');

const DEFAULT_REPO = 'Appleinteligence/Political_DEBATE_large_v1.0-onnx';
const MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', path.join('onnx', 'model_quantized.onnx')];
const REPO_PATTERN = /^[A-Za-z0-9][\w.-]{0,95}\/[A-Za-z0-9][\w.-]{0,95}$/;

async function hasModelFiles(dir) {
  try {
    await Promise.all(MODEL_FILES.map((file) => fs.access(path.join(dir, file))));
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
}

function validateAnalysis(request) {
  if (!request || typeof request !== 'object' || typeof request.premise !== 'string' || !Array.isArray(request.hypotheses)) {
    throw new Error('Invalid analysis request.');
  }
  const premise = request.premise.trim();
  if (!premise) throw new Error('There is no text to analyze.');
  if (premise.length > 200000) throw new Error('The text is too long to analyze (200,000 characters maximum).');
  const hypotheses = request.hypotheses.map((h) => typeof h === 'string' ? h.trim() : '').filter(Boolean);
  if (!hypotheses.length) throw new Error('Enter at least one hypothesis.');
  if (hypotheses.length > 10 || hypotheses.some((h) => h.length > 400)) {
    throw new Error('Use at most 10 hypotheses of up to 400 characters each.');
  }
  return { premise, hypotheses };
}

// The Political DEBATE classifier is heavy, so nothing here runs until the user
// explicitly loads it and submits a hypothesis.
function registerNli({ app, ipcMain, dialog, getWindow, readConfig, writeConfig, readToken }) {
  const storage = path.join(app.getPath('userData'), 'political-debate');
  let worker = null;
  let sequence = 0;
  let state = { busy: false, ready: false, detail: 'Model not loaded.', error: '' };
  const pending = new Map();

  const source = () => {
    const saved = readConfig().nliModel || {};
    if (typeof saved.folder === 'string' && path.isAbsolute(saved.folder)) return { folder: saved.folder };
    return { repo: typeof saved.repo === 'string' && REPO_PATTERN.test(saved.repo) ? saved.repo : DEFAULT_REPO };
  };
  const cacheDir = (repo) => path.join(storage, 'models', ...repo.split('/'));
  const downloaded = async () => {
    const current = source();
    return hasModelFiles(current.folder || cacheDir(current.repo));
  };

  function stop(detail = 'Model not loaded.') {
    const instance = worker;
    worker = null;
    for (const task of pending.values()) task.reject(new Error('The model was unloaded.'));
    pending.clear();
    state = { busy: false, ready: false, detail, error: '' };
    if (instance) instance.terminate();
  }

  function ensureWorker() {
    if (worker) return;
    worker = new Worker(path.join(__dirname, 'nliWorker.cjs'));
    const instance = worker;
    const fail = (e) => {
      if (worker !== instance) return;
      for (const task of pending.values()) task.reject(e);
      pending.clear();
      worker = null;
      state = { ...state, busy: false, ready: false, error: e.message };
    };
    worker.on('message', (message) => {
      if (worker !== instance) return;
      if (message.progress) { state = { ...state, detail: message.progress }; return; }
      const task = pending.get(message.id);
      if (!task) return;
      pending.delete(message.id);
      state = { ...state, busy: false, error: message.error || '' };
      if (message.error) task.reject(new Error(message.error));
      else task.resolve(message.result);
    });
    worker.on('error', fail);
    worker.on('exit', (code) => fail(new Error(`Political DEBATE worker exited (${code}).`)));
  }

  function request(message) {
    if (state.busy) throw new Error('The Political DEBATE model is busy. Please wait for it to finish.');
    ensureWorker();
    state = { ...state, busy: true, error: '' };
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...message, id });
    });
  }

  ipcMain.handle('nli:status', async () => ({
    ...state, source: source(), defaultRepo: DEFAULT_REPO, downloaded: state.ready || await downloaded(),
  }));
  ipcMain.handle('nli:setRepo', async (_e, repo) => {
    if (typeof repo !== 'string') throw new Error('Invalid model repository.');
    const clean = repo.trim() || DEFAULT_REPO;
    if (!REPO_PATTERN.test(clean)) throw new Error('Enter a Hugging Face model ID such as owner/model-name.');
    if (state.busy) throw new Error('Wait for the current model task to finish.');
    writeConfig({ nliModel: { repo: clean } });
    stop();
    return source();
  });
  ipcMain.handle('nli:chooseFolder', async () => {
    if (state.busy) throw new Error('Wait for the current model task to finish.');
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Choose a converted Political DEBATE ONNX folder', properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const folder = result.filePaths[0];
    if (!await hasModelFiles(folder)) {
      throw new Error(`That folder must contain ${MODEL_FILES.join(', ')}. Run scripts/convert-political-debate.py to create it.`);
    }
    writeConfig({ nliModel: { folder } });
    stop();
    return source();
  });
  ipcMain.handle('nli:load', async () => {
    if (state.ready) return { ready: true };
    const current = source();
    const online = !current.folder && !await downloaded();
    state = { ...state, detail: online ? 'Starting download...' : 'Loading model...' };
    const result = await request({ type: 'load', source: current, storage, online, token: online ? await readToken() : '' });
    state = { ...state, ready: true, detail: 'Model ready. Analysis runs locally.' };
    return result;
  });
  ipcMain.handle('nli:unload', async () => { stop(); return { ready: false }; });
  ipcMain.handle('nli:analyze', async (_e, payload) => {
    const valid = validateAnalysis(payload);
    if (!state.ready) throw new Error('Load the Political DEBATE model first.');
    const result = await request({ type: 'analyze', ...valid });
    state = { ...state, detail: 'Model ready. Analysis runs locally.' };
    return result;
  });
  app.on('before-quit', () => stop());
}

module.exports = { registerNli, validateAnalysis, DEFAULT_REPO, REPO_PATTERN };
