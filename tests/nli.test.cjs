const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chunkPremise, softmax } = require('../electron/nliMath.cjs');
const { validateAnalysis, REPO_PATTERN, DEFAULT_REPO } = require('../electron/nli.cjs');

const words = (text) => text.split(/\s+/).filter(Boolean).length;

test('premises are packed into sentence-aligned passages within the token budget', () => {
  const text = Array.from({ length: 30 }, (_, i) => `Sentence ${i} has five words.`).join(' ');
  const { chunks, truncated } = chunkPremise(text, words, 20);
  assert.equal(truncated, false);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => words(chunk) <= 20 && /\.$/.test(chunk)));
  assert.equal(chunks.join(' '), text);
});

test('oversized sentences are split on words and long documents are capped', () => {
  const sentence = Array.from({ length: 100 }, (_, i) => `w${i}`).join(' ');
  const { chunks } = chunkPremise(sentence, words, 20);
  assert.ok(chunks.every((chunk) => words(chunk) <= 20));
  assert.equal(chunks.join(' '), sentence);
  const capped = chunkPremise(Array.from({ length: 200 }, () => 'One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen.').join(' '), words, 20, 5);
  assert.equal(capped.chunks.length, 5);
  assert.equal(capped.truncated, true);
  assert.throws(() => chunkPremise('text', words, 4), /no room/);
  assert.throws(() => chunkPremise('  \n ', words, 20), /empty/);
});

test('softmax is numerically stable', () => {
  const [a, b] = softmax([1000, 1000]);
  assert.equal(a, 0.5);
  assert.equal(b, 0.5);
  assert.ok(Math.abs(softmax([3, -2]).reduce((s, v) => s + v, 0) - 1) < 1e-12);
});

test('analysis requests are validated before reaching the model', () => {
  assert.deepEqual(validateAnalysis({ premise: ' text ', hypotheses: [' a ', '', 'b'] }), { premise: 'text', hypotheses: ['a', 'b'] });
  assert.throws(() => validateAnalysis({ premise: '', hypotheses: ['a'] }), /no text/);
  assert.throws(() => validateAnalysis({ premise: 'x', hypotheses: [] }), /at least one/);
  assert.throws(() => validateAnalysis({ premise: 'x', hypotheses: Array(11).fill('h') }), /at most 10/);
  assert.throws(() => validateAnalysis({ premise: 'x'.repeat(200001), hypotheses: ['h'] }), /too long/);
  assert.throws(() => validateAnalysis(null), /Invalid/);
  assert.match(DEFAULT_REPO, REPO_PATTERN);
  for (const bad of ['../etc', 'owner', 'a/b/c', 'https://huggingface.co/a/b', 'own er/x']) assert.doesNotMatch(bad, REPO_PATTERN);
});

test('note Markdown becomes clean premise text and hypotheses follow the model card templates', async () => {
  const { premiseText, buildHypotheses, entailmentLabel } = await import('../src/lib/nli.js');
  const note = '---\ntags: [x]\n---\n# Tag\n\n**Smith 24** [[Cards|cards]]\n\n> ==Highlighted== evidence about `AI` &amp; jobs.\n- item';
  assert.equal(premiseText(note), 'Tag\n\nSmith 24 cards\n\nHighlighted evidence about AI and jobs.\nitem');
  assert.deepEqual(buildHypotheses('stance', 'tariffs help workers.\n\n nuclear war '), [
    'The author of this text believes tariffs help workers.',
    'The author of this text believes nuclear war.',
  ]);
  assert.deepEqual(buildHypotheses('topic', 'trade'), ['This text is about trade.']);
  assert.deepEqual(buildHypotheses('custom', 'Exactly this.'), ['Exactly this.']);
  assert.equal(entailmentLabel(0.95), 'Strongly supported');
  assert.equal(entailmentLabel(0.1), 'Not supported');
});
