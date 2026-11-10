const test = require('node:test');
const assert = require('node:assert/strict');

test('smart paste recognizes a tag, citation and evidence without losing text', async () => {
  const { smartPasteMarkdown } = await import('../src/lib/smartPaste.js');
  const input =
    'Climate action works\nSmith 2024 — Climate research\nA long evidence paragraph explaining why climate action is effective.';
  assert.equal(
    smartPasteMarkdown(input),
    '#### Climate action works\n**Smith 2024 — Climate research**\nA long evidence paragraph explaining why climate action is effective.'
  );
  assert.equal(
    smartPasteMarkdown('An article title\nAn ordinary paragraph about 2024 and other subjects.'),
    'An article title\nAn ordinary paragraph about 2024 and other subjects.'
  );
  assert.equal(
    smartPasteMarkdown(
      '#### Already tagged\n**Smith 2024**\nA long evidence paragraph explaining why climate action is effective.'
    ),
    '#### Already tagged\n**Smith 2024**\nA long evidence paragraph explaining why climate action is effective.'
  );
});
