const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs/promises');
const path = require('node:path');
const { digest, chunksFor, cosine, lexicalAffinity } = require('./embeddingMath.cjs');

const MODEL = 'Xenova/all-MiniLM-L6-v2';
let pipelinePromise;
let extractor;
let queue = Promise.resolve();

async function transformers() {
  const { env, pipeline } = await import('@huggingface/transformers');
  env.cacheDir = path.join(workerData.storage, 'models');
  env.allowLocalModels = true;
  env.localModelPath = path.join(workerData.storage, 'models');
  // Do not use credentials inherited from the environment.
  delete process.env.HF_TOKEN;
  delete process.env.HF_ACCESS_TOKEN;
  return { env, pipeline };
}

async function loadModel(token, online, report) {
  if (extractor) return extractor;
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = (async () => {
    const { env, pipeline } = await transformers();
    env.allowRemoteModels = online;
    const fetcher = globalThis.fetch;
    env.fetch = async (url, options = {}) => {
      const headers = new Headers(options.headers);
      headers.delete('authorization');
      // Only send a user token to the actual Hugging Face origin.
      if (token && new URL(url).origin === 'https://huggingface.co') headers.set('Authorization', `Bearer ${token}`);
      const timeout = AbortSignal.timeout(180000);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      return fetcher(url, { ...options, headers, signal });
    };
    try {
      extractor = await pipeline('feature-extraction', MODEL, {
        dtype: 'q8', device: 'cpu', local_files_only: !online,
        progress_callback: (p) => report(p.status === 'progress'
          ? `Downloading ${p.file}: ${Math.round(p.progress || 0)}%` : `${p.status}: ${p.file || MODEL}`),
      });
      return extractor;
    } finally {
      env.allowRemoteModels = false;
      env.fetch = fetcher;
    }
  })();
  try {
    return await pipelinePromise;
  } finally {
    pipelinePromise = null;
  }
}

async function embed(model, text) {
  const result = await model(text, { pooling: 'mean', normalize: true });
  return Array.from(result.data);
}

async function search({ query, documents, vault, maxResults = 200 }, report) {
  const model = await loadModel('', false, report);
  const indexDir = path.join(workerData.storage, 'indexes');
  const indexFile = path.join(indexDir, `${digest(vault)}.json`);
  let cache = {};
  try {
    const saved = JSON.parse(await fs.readFile(indexFile, 'utf8'));
    if (saved.model === MODEL) cache = saved.documents;
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error(`Cannot read semantic index: ${e.message}`);
  }
  const nextCache = {};
  const queryVector = await embed(model, query);
  const matches = [];
  let count = 0;
  for (const [file, content] of Object.entries(documents)) {
    const chunks = chunksFor(content);
    const hash = digest(content);
    const cached = cache[file]?.hash === hash ? cache[file] : null;
    const vectors = cached ? cached.vectors : [];
    if (!cached) {
      for (const chunk of chunks) vectors.push(await embed(model, chunk.text));
    }
    nextCache[file] = { hash, vectors };
    let best = null;
    chunks.forEach((chunk, i) => {
      const score = cosine(queryVector, vectors[i]);
      const rank = score + 0.08 * lexicalAffinity(query, chunk.text)
        + 0.04 * lexicalAffinity(query, path.basename(file, '.md').replace(/_/g, ' '));
      if (!best || rank > best.rank) best = { path: file, score, rank, line: chunk.line, text: chunk.text.slice(0, 300) };
    });
    if (best) matches.push(best);
    report(`Indexed ${++count} / ${Object.keys(documents).length} notes locally`);
  }
  await fs.mkdir(indexDir, { recursive: true });
  await fs.writeFile(indexFile + '.tmp', JSON.stringify({ model: MODEL, documents: nextCache }));
  await fs.rename(indexFile + '.tmp', indexFile);
  return matches.sort((a, b) => b.rank - a.rank || a.path.localeCompare(b.path)).slice(0, maxResults);
}

parentPort.on('message', (message) => {
  queue = queue.then(async () => {
    const report = (detail) => parentPort.postMessage({ id: message.id, progress: detail });
    try {
      const result = message.type === 'search'
        ? await search(message, report)
        : await loadModel(message.token || '', message.type === 'download', report).then(() => ({ ready: true, model: MODEL }));
      parentPort.postMessage({ id: message.id, result });
    } catch (e) {
      parentPort.postMessage({ id: message.id, error: `Local embeddings failed: ${e.message}` });
    }
  });
});
