const { test } = require('node:test');
const assert = require('node:assert/strict');

test('standardizes highlight and bold whitespace', async () => {
  const { standardizeAll } = await import('../src/lib/standardizeFormatting.js');
  assert.equal(standardizeAll('==word =='), '==word== ');
  assert.equal(standardizeAll('**word **'), '**word** ');
  assert.equal(standardizeAll('== word =='), ' ==word== ');
  assert.equal(standardizeAll('==  =='), '  ');
});

test('joins adjacent highlights across spaces and punctuation only', async () => {
  const { standardizeHighlights } = await import('../src/lib/standardizeFormatting.js');
  assert.equal(standardizeHighlights('==A== ==B=='), '==A B==');
  assert.equal(standardizeHighlights('==A==, ==B=='), '==A, B==');
  assert.equal(standardizeHighlights('==A== and ==B=='), '==A== and ==B==');
  assert.equal(standardizeHighlights('==A==\n==B=='), '==A==\n==B==');
});

test('preserves code and is idempotent', async () => {
  const { standardizeAll } = await import('../src/lib/standardizeFormatting.js');
  const input = '`==code ==`\n\n```md\n**code **\n```\n==A==, ==B==';
  const formatted = standardizeAll(input);
  assert.equal(formatted, '`==code ==`\n\n```md\n**code **\n```\n==A, B==');
  assert.equal(standardizeAll(formatted), formatted);
});
