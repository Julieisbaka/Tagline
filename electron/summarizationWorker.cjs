const { parentPort, workerData } = require('node:worker_threads');
const path = require('node:path');

const MODEL = 'Xenova/long-t5-tglobal-base-16384-book-summary';
let summarizer;
let queue = Promise.resolve();

async function getSummarizer(report) {
  if (summarizer) return summarizer;
  const { env, pipeline } = await import('@huggingface/transformers');
  delete process.env.HF_TOKEN;
  delete process.env.HF_ACCESS_TOKEN;
  env.cacheDir = path.join(workerData.storage, 'models');
  env.localModelPath = path.join(workerData.storage, 'models');
  env.allowLocalModels = true;
  env.allowRemoteModels = true;
  const fetcher = globalThis.fetch;
  env.fetch = async (url, options = {}) => {
    const headers = new Headers(options.headers);
    headers.delete('authorization');
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(600000)])
      : AbortSignal.timeout(600000);
    return fetcher(url, { ...options, headers, signal });
  };
  try {
    summarizer = await pipeline('summarization', MODEL, {
      dtype: 'q8',
      device: 'cpu',
      progress_callback: (progress) => report(progress.status === 'progress'
        ? `Downloading ${progress.file}: ${Math.round(progress.progress || 0)}%`
        : `${progress.status}: ${progress.file || MODEL}`),
    });
    return summarizer;
  } finally {
    env.allowRemoteModels = false;
    env.fetch = fetcher;
  }
}

async function summarize(content, report) {
  const model = await getSummarizer(report);
  report('Summarizing document locally...');
  const result = await model(content, { max_new_tokens: 512 });
  const summary = Array.isArray(result) ? result[0]?.summary_text : result?.summary_text;
  if (typeof summary !== 'string' || !summary.trim()) throw new Error('The model returned an empty summary.');
  return summary.trim();
}

parentPort.on('message', (message) => {
  queue = queue.then(async () => {
    const report = (detail) => parentPort.postMessage({ id: message.id, progress: detail });
    try {
      const result = message.type === 'summarize'
        ? await summarize(message.content, report)
        : (await getSummarizer(report), { ready: true, model: MODEL });
      parentPort.postMessage({ id: message.id, result });
    } catch (error) {
      parentPort.postMessage({ id: message.id, error: `Document summarization failed: ${error.message}` });
    }
  });
});
