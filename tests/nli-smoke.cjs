// End-to-end check of the Political DEBATE worker.
// Local folder: set TAGLINE_NLI_MODEL=<folder from scripts/convert-political-debate.py> && npm run test:nli
// Published repo: set TAGLINE_NLI_REPO=Appleinteligence/Political_DEBATE_large_v1.0-onnx && npm run test:nli
//   (downloads about 650 MB into a temporary cache without a token, as the app does)
const { Worker } = require('node:worker_threads');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const folder = process.env.TAGLINE_NLI_MODEL;
const repo = process.env.TAGLINE_NLI_REPO;
if (!folder && !repo) {
  console.log('SKIP: set TAGLINE_NLI_MODEL to a converted folder or TAGLINE_NLI_REPO to a published repo.');
  process.exit(0);
}
const storage = repo ? fs.mkdtempSync(path.join(os.tmpdir(), 'tagline-nli-hub-')) : '';

const worker = new Worker(path.join(__dirname, '..', 'electron', 'nliWorker.cjs'));
let sequence = 0;
const call = (message) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const listener = (reply) => {
    if (reply.id !== id || reply.progress) return;
    worker.off('message', listener);
    if (reply.error) reject(new Error(reply.error)); else resolve(reply.result);
  };
  worker.on('message', listener);
  worker.postMessage({ ...message, id });
});

(async () => {
  const started = Date.now();
  await call(repo
    ? { type: 'load', source: { repo }, storage, online: true, token: '' }
    : { type: 'load', source: { folder: path.resolve(folder) }, storage: '', online: false, token: '' });
  console.log(`Loaded ${repo ? `${repo} from Hugging Face` : 'local folder'} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  const premise = 'The senator argued that raising the minimum wage would lift millions of families out of poverty ' +
    'and that Congress must pass the increase this year. She dismissed claims that it would cost jobs.';
  const result = await call({ type: 'analyze', premise, hypotheses: [
    'The author of this text supports raising the minimum wage.',
    'The author of this text opposes raising the minimum wage.',
    'This text is about foreign policy.',
  ] });
  for (const item of result.results) console.log(`${(item.entailment * 100).toFixed(1)}%  ${item.hypothesis}`);
  const [support, oppose, topic] = result.results.map((item) => item.entailment);
  assert.ok(support > 0.5, 'Supportive stance is entailed');
  assert.ok(oppose < 0.5 && topic < 0.5, 'Opposing stance and unrelated topic are not entailed');

  const long = Array.from({ length: 120 }, (_, i) => `Filler sentence number ${i} discusses local weather patterns.`)
    .join(' ') + ' ' + premise;
  const chunked = await call({ type: 'analyze', premise: long, hypotheses: ['The author of this text supports raising the minimum wage.'] });
  assert.ok(chunked.passages > 1, 'Long documents are split into passages');
  assert.ok(chunked.results[0].entailment > 0.5, 'Evidence in a late passage is still found');
  assert.match(chunked.results[0].passage, /minimum wage/);
  console.log(`PASS: load, stance, topic, and ${chunked.passages}-passage analysis.`);
})().catch((e) => { console.error('FAIL:', e); process.exitCode = 1; }).finally(async () => {
  await worker.terminate();
  if (storage) fs.rmSync(storage, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});
