const { test } = require('node:test');
const assert = require('node:assert/strict');

test('quote comparison highlights normalized word matches and flags gaps or altered wording', async () => {
  const { verifyQuote } = await import('../src/lib/quoteVerification.js');
  const source = 'The climate is changing quickly, and the world must act today.';
  let result = verifyQuote('the climate is changing quickly', source);
  assert.equal(result.status, 'match');
  assert.equal(
    source.slice(result.ranges[0].start, result.ranges[0].end),
    'The climate is changing quickly'
  );
  result = verifyQuote('The climate is changing ... the world must act today', source);
  assert.equal(result.status, 'omission');
  assert.equal(result.ranges.length, 2);
  result = verifyQuote('The climate is changing rapidly', source);
  assert.equal(result.status, 'review');
  assert.equal(result.matched, 4);
  assert.equal(verifyQuote('completely different words', source).status, 'review');
  assert.equal(verifyQuote('', source).status, 'unverified');
  assert.equal(
    verifyQuote('the climate is changing the world must act today', source).status,
    'omission'
  );
  assert.equal(verifyQuote('... !!!', source).status, 'unverified');
  assert.equal(verifyQuote('words', '!!!').status, 'unverified');
  assert.equal(verifyQuote('one two one two', 'one two one two').status, 'match');
  assert.equal(verifyQuote('absent '.repeat(205), source).limited, true);
});

test('card quote preparation removes headings and citation lines', async () => {
  const { cardQuote } = await import('../src/lib/quoteVerification.js');
  assert.equal(
    cardQuote('#### Tag\n**Smith 2024** — Citation\n==Actual evidence=='),
    'Actual evidence'
  );
  assert.equal(
    cardQuote('#### Tag\n**Smith 2024** — Citation\n**Water &amp; air** are vital.'),
    'Water & air are vital.'
  );
  assert.equal(cardQuote('&lt;script&gt;alert(1)&lt;/script&gt; Safe'), 'alert(1) Safe');
  assert.equal(cardQuote('&#60;script&#62;alert(1)&#60;/script&#62; Safe'), 'alert(1) Safe');
  assert.equal(cardQuote('#### Tag\n**This is evidence**', false), 'This is evidence');
});
