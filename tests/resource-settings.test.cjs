const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { modelCache, withModelPathsLock } = require('../electron/modelCache.cjs');

test('low-resource limits preserve smaller settings and restore original values', async () => {
  const { resourceLimits } = await import('../src/lib/resourceLimits.js');
  const original = {
    visualCacheEntries: 16,
    visualCacheCharacters: 4000000,
    searchMaxResults: 200,
  };
  assert.deepEqual(resourceLimits({ ...original, lowResourceMode: true }), {
    visualCacheEntries: 8,
    visualCacheCharacters: 2000000,
    searchMaxResults: 20,
  });
  assert.deepEqual(resourceLimits({ ...original, lowResourceMode: false }), original);
  const smaller = { visualCacheEntries: 2, visualCacheCharacters: 1000, searchMaxResults: 5 };
  assert.deepEqual(resourceLimits({ ...smaller, lowResourceMode: true }), smaller);
});

test('model cache only removes app-owned files and protects selected folders and symlinks', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-cache-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const storage = path.join(root, 'semantic-search');
  const models = path.join(storage, 'models');
  await fs.mkdir(path.join(models, 'repo'), { recursive: true });
  await fs.writeFile(path.join(models, 'repo', 'model'), '12345');
  await fs.writeFile(path.join(storage, 'huggingface-token.bin'), 'token');
  await fs.writeFile(path.join(storage, 'index'), 'index');
  const cache = modelCache(root, 'semantic-search');
  assert.equal(await cache.size(), 5);
  await assert.rejects(cache.remove(path.join(models, 'repo')), /overlaps/);
  await assert.rejects(cache.remove(root), /overlaps/);
  await withModelPathsLock(async () => {
    await assert.rejects(cache.remove(), /storage operation/);
  });
  await cache.remove(path.join(root, 'external'));
  assert.equal(await fs.readFile(path.join(storage, 'huggingface-token.bin'), 'utf8'), 'token');
  assert.equal(await fs.readFile(path.join(storage, 'index'), 'utf8'), 'index');
  assert.equal(await cache.size(), 0);
  const outside = path.join(root, 'external');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'keep'), 'safe');
  await fs.symlink(outside, models, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(cache.remove(), /not a regular directory/);
  assert.equal(await fs.readFile(path.join(outside, 'keep'), 'utf8'), 'safe');
});

test('low-resource mode suppresses startup autoload but permits manual models and safe removal', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-models-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'semantic-search', 'models', 'Xenova', 'all-MiniLM-L6-v2');
  await fs.mkdir(path.join(dir, 'onnx'), { recursive: true });
  for (const file of [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/model_quantized.onnx',
  ]) {
    await fs.writeFile(path.join(dir, file), 'test');
  }
  const instances = [];
  let finishTermination;
  class Worker extends EventEmitter {
    constructor(file) {
      super();
      this.file = file;
      instances.push(this);
    }
    postMessage(message) {
      setImmediate(() => this.emit('message', { id: message.id, result: { ready: true } }));
    }
    terminate() {
      return new Promise((resolve) => {
        finishTermination = resolve;
      });
    }
  }
  const load = async (file) => {
    const filename = path.join(__dirname, '..', 'electron', file);
    const module = { exports: {} };
    vm.runInNewContext(await fs.readFile(filename, 'utf8'), {
      module,
      __dirname: path.dirname(filename),
      console,
      require: (name) =>
        name === 'node:worker_threads' ? { Worker } : createRequire(filename)(name),
    });
    return module.exports;
  };
  const app = new EventEmitter();
  app.getPath = () => root;
  const handlers = {};
  let config = { lowResourceMode: true, modelAutoload: true };
  const opts = {
    app,
    ipcMain: {
      handle: (name, handler) => {
        handlers[name] = handler;
      },
    },
    safeStorage: { isAsyncEncryptionAvailable: async () => true },
    getVaultRoot: () => root,
    readConfig: () => config,
    writeConfig: (patch) => {
      config = { ...config, ...patch };
    },
    assertModelSender: (event) => {
      if (event !== 'trusted') {
        throw new Error('untrusted');
      }
    },
  };
  (await load('embeddings.cjs')).registerEmbeddings(opts);
  (await load('summarization.cjs')).registerSummarization(opts);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(instances.length, 0);
  assert.equal(handlers['embeddings:lowResource:get']('trusted'), true);
  assert.throws(() => handlers['embeddings:lowResource:set']('untrusted', false), /untrusted/);
  assert.throws(() => handlers['embeddings:lowResource:set']('trusted', 'false'), /Invalid/);
  await handlers['embeddings:download']();
  await handlers['summary:load']();
  assert.equal(instances.length, 2);
  const removal = handlers['embeddings:manage']('trusted', true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof finishTermination, 'function');
  await assert.rejects(handlers['embeddings:download'](), /already running/);
  assert.ok(await fs.stat(dir));
  finishTermination();
  await removal;
  await assert.rejects(fs.stat(dir), { code: 'ENOENT' });
  assert.equal((await handlers['embeddings:status']()).ready, false);
  assert.equal(handlers['embeddings:lowResource:set']('trusted', false), false);
  assert.equal(config.modelAutoload, true);
});

test('MCP inference uses loaded app workers and respects shared busy and input checks', async (t) => {
  const { createMcpService } = require('../electron/mcp.cjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-mcp-models-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const instances = [];
  class Worker extends EventEmitter {
    constructor(file) {
      super();
      this.file = file;
      instances.push(this);
    }
    postMessage(message) {
      this.message = message;
      if (message.type !== 'load' && message.type !== 'download') {
        return;
      }
      setImmediate(() => this.emit('message', { id: message.id, result: { ready: true } }));
    }
    finish(result) {
      this.emit('message', { id: this.message.id, result });
    }
    terminate() {
      return Promise.resolve();
    }
  }
  const load = async (file) => {
    const filename = path.join(__dirname, '..', 'electron', file);
    const module = { exports: {} };
    vm.runInNewContext(await fs.readFile(filename, 'utf8'), {
      module,
      __dirname: path.dirname(filename),
      console,
      require: (name) =>
        name === 'node:worker_threads' ? { Worker } : createRequire(filename)(name),
    });
    return module.exports;
  };
  const handlers = {};
  const app = new EventEmitter();
  app.getPath = () => root;
  const opts = {
    app,
    ipcMain: { handle: (name, handler) => (handlers[name] = handler) },
    getVaultRoot: () => root,
    readConfig: () => ({ lowResourceMode: true, modelAutoload: true }),
    writeConfig: () => {},
    safeStorage: { isAsyncEncryptionAvailable: async () => true },
    readToken: async () => '',
    assertModelSender: () => {},
  };
  const models = {
    embeddings: (await load('embeddings.cjs')).registerEmbeddings(opts),
    summary: (await load('summarization.cjs')).registerSummarization(opts),
    nli: (await load('nli.cjs')).registerNli(opts),
  };
  const service = createMcpService({
    getVaultRoot: () => root,
    getAllowModels: () => true,
    getLocalModels: () => models,
  });
  const call = async (name, args) =>
    (
      await service.handle({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      })
    ).result;
  for (const [name, args] of [
    ['embed_text', { text: 'query' }],
    ['summarize_text', { text: 'text' }],
    ['analyze_hypotheses', { premise: 'text', hypotheses: ['claim'] }],
  ]) {
    assert.equal((await call(name, args)).isError, true);
  }
  assert.equal(instances.length, 0);
  await handlers['embeddings:download']();
  await handlers['summary:load']();
  await handlers['nli:load']();
  assert.equal(instances.length, 3);
  assert.equal((await call('embed_text', { text: 'x'.repeat(10001) })).isError, true);
  assert.equal((await call('summarize_text', { text: 'x'.repeat(500001) })).isError, true);
  const cases = [
    ['embed_text', { text: 'query' }, 'embeddings:download', [1, 2]],
    ['summarize_text', { text: 'document' }, 'summary:load', 'short'],
    [
      'analyze_hypotheses',
      { premise: 'text', hypotheses: ['claim'] },
      'nli:unload',
      [{ score: 0.7 }],
    ],
  ];
  for (const [index, [name, args, handler, result]] of cases.entries()) {
    const task = call(name, args);
    assert.equal((await call('local_model_status', {})).isError, undefined);
    await assert.rejects(handlers[handler](), /already running|busy|finish/);
    assert.equal((await call(name, args)).isError, true);
    instances[index].finish(result);
    assert.equal((await task).isError, undefined);
  }
});

test('embedding worker returns normalized vectors without loading on embed', async () => {
  const filename = path.join(__dirname, '..', 'electron', 'embeddingWorker.cjs');
  const port = new EventEmitter();
  const replies = [];
  port.postMessage = (reply) => replies.push(reply);
  let pipelineCalls = 0;
  let options;
  const transformers = {
    env: {},
    pipeline: async () => {
      pipelineCalls++;
      return async (text, opts) => {
        assert.equal(text, 'hello');
        options = opts;
        return { data: new Float32Array([0.6, 0.8]) };
      };
    },
  };
  const source = (await fs.readFile(filename, 'utf8')).replace(
    "await import('@huggingface/transformers')",
    'transformersStub'
  );
  vm.runInNewContext(source, {
    require: (name) =>
      name === 'node:worker_threads'
        ? { parentPort: port, workerData: { storage: 'test' } }
        : createRequire(filename)(name),
    transformersStub: transformers,
    process: { env: {} },
    globalThis: { fetch: () => {} },
    Headers,
    AbortSignal,
    URL,
  });
  const send = async (message) => {
    port.emit('message', message);
    await new Promise((resolve) => setImmediate(resolve));
    return replies.find((reply) => reply.id === message.id && !reply.progress);
  };
  assert.match(
    (await send({ id: 1, type: 'embed', text: 'hello' })).error,
    /Load the embedding model first/
  );
  assert.equal(pipelineCalls, 0);
  await send({ id: 2, type: 'load' });
  const result = await send({ id: 3, type: 'embed', text: 'hello' });
  assert.ok(Math.abs(result.result[0] - 0.6) < 0.00001);
  assert.ok(Math.abs(result.result[1] - 0.8) < 0.00001);
  assert.equal(options.pooling, 'mean');
  assert.equal(options.normalize, true);
  assert.equal(pipelineCalls, 1);
});
