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

test('Flow cell markdown subset renders inline formatting', async () => {
  const { createMarkdownParser } = await import('../src/lib/markdown.js');
  const parser = createMarkdownParser(() => null);
  const html = parser.parse(
    '**bold** *italic* ~~strike~~ ==highlight== ++underline++ `code` [link](https://example.com) [[Note]]'
  );
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<del>strike<\/del>/);
  assert.match(html, /<mark>highlight<\/mark>/);
  assert.match(html, /<u>underline<\/u>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.match(html, /internal-link/);
});
