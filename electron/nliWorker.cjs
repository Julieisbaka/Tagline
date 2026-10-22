const { parentPort } = require('node:worker_threads');
const path = require('node:path');
const { chunkPremise, softmax, MAX_POSITIONS } = require('./nliMath.cjs');

let loaded = null;
let queue = Promise.resolve();

async function load({ source, storage, token, online }, report) {
  if (loaded) return loaded.info;
  const { env, AutoTokenizer, AutoModelForSequenceClassification } = await import('@huggingface/transformers');
  delete process.env.HF_TOKEN;
  delete process.env.HF_ACCESS_TOKEN;
  env.allowLocalModels = true;
  let id;
  if (source.folder) {
    env.localModelPath = path.dirname(source.folder);
    env.allowRemoteModels = false;
    id = path.basename(source.folder);
  } else {
    env.cacheDir = path.join(storage, 'models');
    env.localModelPath = path.join(storage, 'models');
    env.allowRemoteModels = online;
    id = source.repo;
  }
  const fetcher = globalThis.fetch;
  env.fetch = async (url, options = {}) => {
    const headers = new Headers(options.headers);
    headers.delete('authorization');
    if (token && new URL(url).origin === 'https://huggingface.co') headers.set('Authorization', `Bearer ${token}`);
    const timeout = AbortSignal.timeout(600000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    return fetcher(url, { ...options, headers, signal });
  };
  const options = {
    local_files_only: !env.allowRemoteModels,
    progress_callback: (p) => report(p.status === 'progress'
      ? `Downloading ${p.file}: ${Math.round(p.progress || 0)}%` : `${p.status}: ${p.file || id}`),
  };
  try {
    const tokenizer = await AutoTokenizer.from_pretrained(id, options);
    const model = await AutoModelForSequenceClassification.from_pretrained(id, { ...options, dtype: 'q8', device: 'cpu' });
    const labels = Object.entries(model.config.id2label || {});
    const entailment = labels.find(([, label]) => String(label).toLowerCase() === 'entailment');
    if (labels.length !== 2 || !entailment) {
      await model.dispose?.();
      throw new Error('This model is not a two-label entailment classifier.');
    }
    loaded = { tokenizer, model, entailment: Number(entailment[0]), info: { ready: true, model: source.folder || source.repo } };
    return loaded.info;
  } finally {
    env.allowRemoteModels = false;
    env.fetch = fetcher;
  }
}

async function analyze({ premise, hypotheses }, report) {
  if (!loaded) throw new Error('Load the model first.');
  const { tokenizer, model, entailment } = loaded;
  const count = (text) => tokenizer.encode(text, { add_special_tokens: false }).length;
  const longest = Math.max(...hypotheses.map(count));
  if (longest > 128) throw new Error('Hypotheses must be at most 128 tokens.');
  const { chunks, truncated } = chunkPremise(premise, count, MAX_POSITIONS - longest - 4);
  const results = [];
  for (const [i, hypothesis] of hypotheses.entries()) {
    const scores = [];
    for (let start = 0; start < chunks.length; start += 8) {
      report(`Hypothesis ${i + 1} / ${hypotheses.length}: passage ${start + 1} / ${chunks.length}`);
      const batch = chunks.slice(start, start + 8);
      const inputs = tokenizer(batch, {
        text_pair: batch.map(() => hypothesis), padding: true, truncation: true, max_length: MAX_POSITIONS,
      });
      const { logits } = await model(inputs);
      const width = logits.dims[1];
      for (let row = 0; row < batch.length; row++) {
        scores.push(softmax(Array.from(logits.data.slice(row * width, row * width + width)))[entailment]);
      }
    }
    const best = scores.reduce((top, score, index) => score > scores[top] ? index : top, 0);
    results.push({ hypothesis, entailment: scores[best], passage: chunks[best], passageIndex: best, scores });
  }
  return { results, passages: chunks.length, truncated };
}

parentPort.on('message', (message) => {
  queue = queue.then(async () => {
    const report = (detail) => parentPort.postMessage({ id: message.id, progress: detail });
    try {
      const result = message.type === 'analyze' ? await analyze(message, report) : await load(message, report);
      parentPort.postMessage({ id: message.id, result });
    } catch (e) {
      parentPort.postMessage({ id: message.id, error: `Political DEBATE model failed: ${e.message}` });
    }
  });
});
