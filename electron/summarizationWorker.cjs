const { parentPort, workerData } = require('node:worker_threads');
const path = require('node:path');

const MODEL = 'Xenova/long-t5-tglobal-base-16384-book-summary';
const MAX_INPUT_TOKENS = 16384;
let summarizer;
let queue = Promise.resolve();

async function getSummarizer(report) {
  if (summarizer) {
    return summarizer;
  }
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
      progress_callback: (progress) =>
        report(
          progress.status === 'progress'
            ? `Downloading ${progress.file}: ${Math.round(progress.progress || 0)}%`
            : `${progress.status}: ${progress.file || MODEL}`
        ),
    });
    return summarizer;
  } finally {
    env.allowRemoteModels = false;
    env.fetch = fetcher;
  }
}

async function summarize(content, report) {
  const { model, tokenizer } = await getSummarizer(report);
  report('Summarizing document locally...');
  const taskPrefix = model.config.task_specific_params?.summarization?.prefix || '';
  const text = taskPrefix + (model.config.prefix || '') + content;
  // Pipeline generation options do not reach the tokenizer. Bound encoder inputs explicitly.
  let inputs = tokenizer(text, {
    padding: true,
    truncation: true,
    max_length: MAX_INPUT_TOKENS,
  });
  const globalBlockSize = model.config.global_block_size ?? 16;
  // Transient-global attention creates floor(sequence_length / block_size) global tokens.
  // Its ONNX reshape cannot handle zero global tokens, so pad only short inputs.
  if (inputs.input_ids.dims[1] < globalBlockSize) {
    inputs = tokenizer(text, {
      padding: 'max_length',
      truncation: true,
      max_length: globalBlockSize,
    });
  }
  const result = await model.generate({ ...inputs, max_new_tokens: 512 });
  const summary = tokenizer.batch_decode(result, { skip_special_tokens: true })[0];
  if (typeof summary !== 'string' || !summary.trim()) {
    throw new Error('The model returned an empty summary.');
  }
  return summary.trim();
}

parentPort.on('message', (message) => {
  queue = queue.then(async () => {
    const report = (detail) => parentPort.postMessage({ id: message.id, progress: detail });
    try {
      const result =
        message.type === 'summarize'
          ? await summarize(message.content, report)
          : (await getSummarizer(report), { ready: true, model: MODEL });
      parentPort.postMessage({ id: message.id, result });
    } catch (error) {
      parentPort.postMessage({
        id: message.id,
        error: `Document summarization failed: ${error.message}`,
      });
    }
  });
});
