const { test } = require('node:test');
const assert = require('node:assert/strict');

test('Markdown link resolution stays scoped to each render', async () => {
  const { createMarkdownParser } = await import('../src/lib/markdown.js');
  let nestedHtml;
  const parser = createMarkdownParser((target) => {
    if (target === 'First') {
      nestedHtml = createMarkdownParser(() => null).parse('[[Nested]]');
    }
    return true;
  });
  const html = parser.parse('[[First]] [[Second]]');

  assert.match(nestedHtml, /class="internal-link unresolved"/);
  assert.equal((html.match(/class="internal-link"/g) || []).length, 2);
  assert.doesNotMatch(html, /internal-link unresolved/);
});
