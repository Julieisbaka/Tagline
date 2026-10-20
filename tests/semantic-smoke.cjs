const { Worker } = require('node:worker_threads');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

const storage = process.env.TAGLINE_MODEL_CACHE || path.join(os.homedir(), '.tagline-test-models');
let worker;
let sequence = 0;
const pending = new Map();
function startWorker() {
  worker = new Worker(path.join(__dirname, '..', 'electron', 'embeddingWorker.cjs'), { workerData: { storage } });
  worker.on('message', (m) => {
    if (m.progress) return;
    const task = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) task.reject(new Error(m.error));
    else task.resolve(m.result);
  });
  worker.on('error', (e) => { for (const task of pending.values()) task.reject(e); });
}
startWorker();
const request = (message) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  worker.postMessage({ ...message, id });
});
const documents = {
  'grid.md': 'The electric grid distributes energy to households. Wind and solar power need upgrades to transmission infrastructure.',
  'politics.md': 'Congress will debate the president political capital and election strategy.',
  'food.md': 'A recipe for chocolate brownies uses butter sugar flour and eggs.',
};

(async () => {
  try {
    await request({ type: 'download' }); // Explicit public, keyless download; cached on subsequent runs.
    await worker.terminate();
    startWorker(); // A fresh process must be able to load the cache without remote access.
    const result = await request({ type: 'search', vault: 'semantic-smoke', query: 'renewable electricity and power networks', documents });
    assert.equal(result[0].path, 'grid.md');
    assert.ok(result[0].score > result[1].score + 0.2, 'Relevant evidence should beat the distractor by > 0.2');
    const changed = { ...documents, 'grid.md': documents['food.md'], 'food.md': documents['grid.md'] };
    const refreshed = await request({ type: 'search', vault: 'semantic-smoke', query: 'renewable electricity and power networks', documents: changed });
    assert.equal(refreshed[0].path, 'food.md', 'Editing documents must invalidate stale vectors');
    console.log('PASS: public download, local inference, semantic ranking, cache invalidation.');
    console.log(`Reusable model cache: ${storage}`);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally { await worker.terminate(); }
})();
