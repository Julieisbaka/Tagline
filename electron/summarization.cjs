const { Worker } = require('node:worker_threads');
const path = require('node:path');
const fs = require('node:fs/promises');
const { modelCache } = require('./modelCache.cjs');

const MODEL = 'Xenova/long-t5-tglobal-base-16384-book-summary';

function registerSummarization({ app, ipcMain, readConfig, assertMainFrameSender }) {
  const storage = path.join(app.getPath('userData'), 'summarization');
  const cache = modelCache(app.getPath('userData'), 'summarization');
  let worker = null;
  let sequence = 0;
  let state = { busy: false, ready: false, detail: 'Model not downloaded yet.', error: '' };
  const pending = new Map();

  function ensureWorker() {
    if (worker) {
      return;
    }
    worker = new Worker(path.join(__dirname, 'summarizationWorker.cjs'), {
      workerData: { storage },
    });
    const instance = worker;
    const fail = (error) => {
      if (worker !== instance) {
        return;
      }
      worker = null;
      state = { ...state, busy: false, ready: false, error: error.message };
      for (const task of pending.values()) {
        task.reject(error);
      }
      pending.clear();
    };
    worker.on('message', (message) => {
      if (worker !== instance) {
        return;
      }
      if (message.progress) {
        state = { ...state, detail: message.progress };
        return;
      }
      const task = pending.get(message.id);
      if (!task) {
        return;
      }
      pending.delete(message.id);
      state = { ...state, busy: false, error: message.error || '' };
      if (message.error) {
        task.reject(new Error(message.error));
      } else {
        state = { ...state, ready: true, detail: 'Model ready. Summaries run locally.' };
        task.resolve(message.result);
      }
    });
    worker.on('error', fail);
    worker.on('exit', (code) => {
      if (worker === instance) {
        fail(new Error(`Summary worker exited (${code}).`));
      }
    });
  }

  function request(message) {
    if (state.busy) {
      throw new Error('A summary model task is already running. Please wait.');
    }
    ensureWorker();
    state = { ...state, busy: true, error: '' };
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...message, id });
    });
  }

  ipcMain.handle('summary:status', async () => {
    const dir = path.join(storage, 'models', ...MODEL.split('/'));
    const files = [
      'config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'onnx/encoder_model_quantized.onnx',
      'onnx/decoder_model_merged_quantized.onnx',
    ];
    let downloaded = true;
    try {
      await Promise.all(files.map((file) => fs.access(path.join(dir, file))));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      downloaded = false;
    }
    return { ...state, downloaded: state.ready || downloaded, model: MODEL };
  });
  ipcMain.handle('summary:cacheSize', (event) => {
    assertMainFrameSender(event);
    return cache.size();
  });
  ipcMain.handle('summary:manage', async (_e, remove) => {
    assertMainFrameSender(_e);
    if (typeof remove !== 'boolean') {
      throw new Error('Invalid model operation.');
    }
    if (state.busy) {
      throw new Error('Wait for the summary task to finish.');
    }
    state = { ...state, busy: true };
    try {
      const instance = worker;
      worker = null;
      state = { busy: true, ready: false, detail: 'Model not loaded.', error: '' };
      if (instance) {
        await instance.terminate();
      }
      if (remove) {
        await cache.remove(readConfig().nliModel?.folder);
      }
    } finally {
      state = { ...state, busy: false };
    }
  });
  ipcMain.handle('summary:load', async () => {
    if (state.busy) {
      throw new Error('A summary model task is already running. Please wait.');
    }
    if (state.ready) {
      return { ready: true, model: MODEL };
    }
    return request({ type: 'load' });
  });
  async function summarize(content) {
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('There is no document text to summarize.');
    }
    if (content.length > 500000) {
      throw new Error('The document is too long to summarize (500,000 characters maximum).');
    }
    if (!state.ready) {
      throw new Error('Download and load the summary model first.');
    }
    return request({ type: 'summarize', content });
  }
  ipcMain.handle('summary:run', (_event, content) => summarize(content));
  app.on('before-quit', () => {
    if (worker) {
      worker.terminate();
    }
  });
  return { status: () => ({ ready: state.ready, busy: state.busy }), summarize };
}

module.exports = { registerSummarization, MODEL };
