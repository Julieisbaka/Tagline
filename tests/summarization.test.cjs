const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'electron', 'summarizationWorker.cjs'),
  'utf8'
);

function summaryWorker({ config = {}, summary = '  Local summary.  ', failure } = {}) {
  const tokenizations = [];
  const generations = [];
  const decodings = [];
  const messages = [];
  const output = { generated: true };
  const tokenizer = (text, options) => {
    tokenizations.push({ text, ...options });
    // Include EOS in the encoder length, like the LongT5 tokenizer.
    const ids = [
      ...text
        .trim()
        .split(/\s+/)
        .map((_, index) => BigInt(index + 2)),
      1n,
    ];
    if (options.truncation) {
      ids.length = Math.min(ids.length, options.max_length);
    }
    const mask = ids.map(() => 1n);
    if (options.padding === 'max_length') {
      while (ids.length < options.max_length) {
        ids.push(0n);
        mask.push(0n);
      }
    }
    return {
      input_ids: { type: 'int64', data: BigInt64Array.from(ids), dims: [1, ids.length] },
      attention_mask: { type: 'int64', data: BigInt64Array.from(mask), dims: [1, mask.length] },
    };
  };
  tokenizer.batch_decode = (result, options) => {
    assert.equal(result, output);
    decodings.push(options);
    return [summary];
  };
  const pipeline = () => {
    throw new Error('Pipeline invocation ignores encoder length options.');
  };
  pipeline.tokenizer = tokenizer;
  pipeline.model = {
    config,
    async generate(options) {
      generations.push(options);
      if (failure) {
        throw failure;
      }
      if (Math.floor(options.input_ids.dims[1] / (config.global_block_size ?? 16)) === 0) {
        throw new Error('TransientGlobalSelfAttention Reshape zero dimension');
      }
      assert.ok(options.input_ids.dims[1] <= 16384);
      return output;
    },
  };
  let onMessage;
  const context = vm.createContext({
    require(name) {
      if (name === 'node:worker_threads') {
        return {
          workerData: { storage: '.' },
          parentPort: {
            on(event, listener) {
              assert.equal(event, 'message');
              onMessage = listener;
            },
            postMessage(message) {
              messages.push(message);
            },
          },
        };
      }
      return require(name);
    },
    injectedSummarizer: pipeline,
  });
  vm.runInContext(`${source}\nsummarizer = injectedSummarizer;`, context);
  return {
    tokenizations,
    generations,
    decodings,
    messages,
    async send(message) {
      onMessage(message);
      await vm.runInContext('queue', context);
      return messages.findLast((item) => item.id === message.id && !item.progress);
    },
  };
}

function contentWithTokens(length) {
  return Array.from({ length: length - 1 }, (_, index) => `word${index}`).join(' ');
}

test('summary worker pads short encoder sequences and masks padding before generation', async () => {
  for (const length of [2, 15]) {
    const worker = summaryWorker();
    const reply = await worker.send({
      id: length,
      type: 'summarize',
      content: contentWithTokens(length),
    });
    assert.equal(reply.result, 'Local summary.');
    assert.equal(worker.tokenizations.length, 2);
    assert.equal(worker.tokenizations[0].max_length, 16384);
    assert.equal(worker.tokenizations[1].padding, 'max_length');
    assert.equal(worker.tokenizations[1].max_length, 16);
    const { input_ids, attention_mask, max_new_tokens } = worker.generations[0];
    assert.deepEqual(input_ids.dims, [1, 16]);
    assert.equal(input_ids.type, 'int64');
    assert.equal(input_ids.data[length - 1], 1n);
    assert.deepEqual([...input_ids.data.slice(length)], Array(16 - length).fill(0n));
    assert.deepEqual(
      [...attention_mask.data],
      [...Array(length).fill(1n), ...Array(16 - length).fill(0n)]
    );
    assert.equal(max_new_tokens, 512);
    assert.equal(worker.decodings[0].skip_special_tokens, true);
  }
});

test('summary worker leaves ordinary input lengths unchanged and truncates overlong input', async () => {
  for (const length of [16, 17, 256, 16384, 16385, 20000]) {
    const worker = summaryWorker();
    const reply = await worker.send({
      id: length,
      type: 'summarize',
      content: contentWithTokens(length),
    });
    assert.equal(reply.result, 'Local summary.');
    assert.equal(worker.tokenizations.length, 1);
    assert.equal(worker.tokenizations[0].truncation, true);
    const { input_ids, attention_mask } = worker.generations[0];
    assert.equal(input_ids.dims[1], Math.min(length, 16384));
    assert.equal(attention_mask.dims[1], input_ids.dims[1]);
    assert.ok([...attention_mask.data].every((value) => value === 1n));
  }
});

test('summary worker uses model global block size and preserves pipeline task prefixes', async () => {
  const worker = summaryWorker({
    config: {
      global_block_size: 32,
      prefix: 'global ',
      task_specific_params: { summarization: { prefix: 'task ' } },
    },
  });
  assert.equal(
    (await worker.send({ id: 1, type: 'summarize', content: 'document' })).result,
    'Local summary.'
  );
  assert.equal(worker.tokenizations[0].text, 'task global document');
  assert.equal(worker.tokenizations[1].max_length, 32);
  assert.equal(worker.generations[0].input_ids.dims[1], 32);
});

test('summary worker rejects empty decoded summaries and retains error context', async () => {
  for (const summary of ['', ' \n ', undefined]) {
    const worker = summaryWorker({ summary: summary ?? null });
    const reply = await worker.send({ id: 1, type: 'summarize', content: 'document' });
    assert.equal(
      reply.error,
      'Document summarization failed: The model returned an empty summary.'
    );
    assert.equal(reply.result, undefined);
  }
  const worker = summaryWorker({ failure: new Error('Inference failed') });
  const reply = await worker.send({ id: 1, type: 'summarize', content: 'document' });
  assert.equal(reply.error, 'Document summarization failed: Inference failed');
});

test('summary worker keeps load replies and serialized requests working', async () => {
  const worker = summaryWorker();
  const load = await worker.send({ id: 1, type: 'load' });
  assert.equal(load.result.ready, true);
  assert.equal(load.result.model, 'Xenova/long-t5-tglobal-base-16384-book-summary');
  assert.equal(worker.tokenizations.length, 0);
  const replies = await Promise.all([
    worker.send({ id: 2, type: 'summarize', content: 'first document' }),
    worker.send({ id: 3, type: 'summarize', content: 'second document' }),
  ]);
  assert.ok(replies.every((reply) => reply.result === 'Local summary.'));
  assert.deepEqual(
    worker.messages.filter((message) => message.result).map((message) => message.id),
    [1, 2, 3]
  );
});
