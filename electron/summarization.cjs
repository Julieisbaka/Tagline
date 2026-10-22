const { Worker } = require('node:worker_threads');
const path = require('node:path');

const MODEL = 'Xenova/long-t5-tglobal-base-16384-book-summary';

function registerSummarization({ app, ipcMain }) {
  const storage = path.join(app.getPath('userData'), 'summarization');
  let worker = null;
  let sequence = 0;
  let state = { busy: false, ready: false, detail: 'Model not downloaded yet.', error: '' };
  const pending = new Map();

  function ensureWorker() {
    if (worker) return;
    worker = new Worker(path.join(__dirname, 'summarizationWorker.cjs'), { workerData: { storage } });
    const instance = worker;
    const fail = (error) => {
      if (worker !== instance) return;
      worker = null;
      state = { ...state, busy: false, ready: false, error: error.message };
      for (const task of pending.values()) task.reject(error);
      pending.clear();
    };
    worker.on('message', (message) => {
      if (worker !== instance) return;
      if (message.progress) {
        state = { ...state, detail: message.progress };
        return;
      }
      const task = pending.get(message.id);
      if (!task) return;
      pending.delete(message.id);
      state = { ...state, busy: false, error: message.error || '' };
      if (message.error) task.reject(new Error(message.error));
      else {
        state = { ...state, ready: true, detail: 'Model ready. Summaries run locally.' };
        task.resolve(message.result);
      }
    });
    worker.on('error', fail);
    worker.on('exit', (code) => {
      if (worker === instance) fail(new Error(`Summary worker exited (${code}).`));
    });
  }

  function request(message) {
    if (state.busy) throw new Error('A summary model task is already running. Please wait.');
    ensureWorker();
    state = { ...state, busy: true, error: '' };
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...message, id });
    });
  }

  ipcMain.handle('summary:status', () => ({ ...state, model: MODEL }));
  ipcMain.handle('summary:load', async () => {
    if (state.ready) return { ready: true, model: MODEL };
    return request({ type: 'load' });
  });
  ipcMain.handle('summary:run', async (_event, content) => {
    if (typeof content !== 'string' || !content.trim()) throw new Error('There is no document text to summarize.');
    if (content.length > 500000) throw new Error('The document is too long to summarize (500,000 characters maximum).');
    if (!state.ready) throw new Error('Download and load the summary model first.');
    return request({ type: 'summarize', content });
  });
  app.on('before-quit', () => { if (worker) worker.terminate(); });
}

module.exports = { registerSummarization, MODEL };
