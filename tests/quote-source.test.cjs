const { test } = require('node:test');
const assert = require('node:assert/strict');
const { articleText, fetchQuoteSource } = require('../electron/quoteSource.cjs');

test('source text extraction decodes entities and excludes non-visible content', () => {
  assert.equal(
    articleText(
      '<head><title>Ignore</title></head><article><p>First &amp; second</p><script>bad()</script><p hidden>hidden</p><p>Last<br>line</p></article>'
    ),
    'First & second\n\nLast\nline'
  );
  assert.equal(
    articleText(
      '<p>Before</p><div hidden><img><span>no</span></div><p style="display: none">hidden</p><p>After</p>'
    ),
    'Before\n\nAfter'
  );
});

test('source URLs reject local or invalid addresses before any network request', async () => {
  await assert.rejects(fetchQuoteSource('http://127.0.0.1/'), /private/);
  await assert.rejects(fetchQuoteSource('file:///secret'), /HTTP/);
  await assert.rejects(fetchQuoteSource('https://user:pass@example.com/'), /HTTP/);
  await assert.rejects(
    fetchQuoteSource('https://example.com/' + 'a'.repeat(2048)),
    /valid source URL/
  );
});
