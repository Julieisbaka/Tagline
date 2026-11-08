const test = require('node:test');
const assert = require('node:assert/strict');

test('double-click ranges exclude trailing whitespace and punctuation', async () => {
  const { wordRangeAt } = await import('../src/lib/wordSelection.js');
  assert.deepEqual(wordRangeAt('happy next', 4), [0, 5]);
  assert.deepEqual(wordRangeAt('happy next', 5), [0, 5]);
  assert.deepEqual(wordRangeAt('happy, next', 5), [0, 5]);
});

test('double-click ranges include Unicode letters and reject punctuation', async () => {
  const { wordRangeAt } = await import('../src/lib/wordSelection.js');
  assert.deepEqual(wordRangeAt('café 2026', 3), [0, 4]);
  assert.deepEqual(wordRangeAt('two words', 4), [4, 9]);
  assert.equal(wordRangeAt('?!', 0), null);
  assert.equal(wordRangeAt('', 0), null);
});
