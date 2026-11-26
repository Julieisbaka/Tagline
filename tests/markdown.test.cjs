const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Markdown link resolution stays scoped to each render', async () => {
  const { createMarkdownParser } = await import('../src/lib/markdown/markdown.js');
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

test('Markdown sanitization forbids remote media elements', async () => {
  const { MARKDOWN_FORBID_TAGS } = await import('../src/lib/markdown/markdown.js');

  for (const tag of ['audio', 'video', 'source', 'track']) {
    assert.ok(MARKDOWN_FORBID_TAGS.includes(tag), `${tag} must not load remote media`);
  }
});

test('Flow cell markdown subset renders inline formatting', async () => {
  const { createMarkdownParser } = await import('../src/lib/markdown/markdown.js');
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

test('heading titles and anchors agree with rendered inline Markdown', async () => {
  const { createMarkdownParser, headingText, slugify } =
    await import('../src/lib/markdown/markdown.js');
  const { outline } = await import('../src/lib/vault/vault.js');
  const cases = [
    ['**Bold** [[Note#Section|Alias]] &amp; <em>More</em>', 'Bold Alias & More'],
    [
      '[[Note#Section]] and ++underlined++ ==highlight==',
      'Note › Section and underlined highlight',
    ],
    ['[Link](https://example.com) `code` ~~old~~', 'Link code old'],
    ['C++ &lt;literal&gt; &#x1F680;', 'C++ <literal> 🚀'],
    ['日本語', '日本語'],
    ['!!!', '!!!'],
    ['<script>hidden</script>Visible', 'Visible'],
  ];
  const parser = createMarkdownParser(() => null);
  for (const [source, expected] of cases) {
    const heading = outline(`# ${source}\n`)[0];
    assert.equal(heading.text, source, 'outline preserves editable source');
    assert.equal(headingText(heading.text), expected);
    const html = parser.parse(`# ${source}\n`);
    assert.ok(html.includes(`id="${slugify(source)}"`), html);
  }
});

test('heading normalization resolves document reference links', async () => {
  const { createMarkdownParser, headingText, slugify } =
    await import('../src/lib/markdown/markdown.js');
  const { outline } = await import('../src/lib/vault/vault.js');
  const content = '# [Clean][ref] **energy**\n\n[ref]: https://example.com\n';
  const raw = outline(content)[0].text;
  assert.equal(headingText(raw, content), 'Clean energy');
  assert.equal(slugify(raw, content), 'clean-energy');
  assert.match(createMarkdownParser(() => null).parse(content), /id="clean-energy"/);
  assert.equal(headingText(raw), '[Clean][ref] energy');
});

test('heading link lookups resolve source, display, and slug fragments with document references', async () => {
  const { slugify } = await import('../src/lib/markdown/markdown.js');
  const { outline } = await import('../src/lib/vault/vault.js');
  const content =
    '# Other\n\n# [Clean][ref] **energy**\n\nSection body\n\n# Next\n\n[ref]: https://example.com\n';
  const headings = outline(content);
  for (const file of [
    'src/App/useAppOperations.js',
    'src/App/useAppCommandContext.js',
    'src/components/CanvasFilePreview.jsx',
  ]) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const predicate = source.match(
      /\((?:x|heading)\)\s*=>\s*slugify\([^\n]+?\)\s*===\s*slugify\([^\n]+?\)(?=\s*\n)/
    );
    assert.ok(predicate, `heading lookup exists in ${file}`);
    for (const fragment of ['[Clean][ref] **energy**', 'Clean energy', 'clean-energy', 'Missing']) {
      const matches = vm.runInNewContext(predicate[0], {
        slugify,
        content,
        heading: fragment,
        subpath: `#${fragment}`,
        path: 'Note.md',
        v: { contents: { 'Note.md': content } },
        contents: { 'Note.md': content },
        link: { path: 'Note.md', heading: fragment },
      });
      assert.equal(
        headings.findIndex(matches),
        fragment === 'Missing' ? -1 : 1,
        `${file}: ${fragment}`
      );
    }
  }
});
