const { test } = require('node:test');
const assert = require('node:assert/strict');

test('card links preserve cell text and resolve to the selected duplicate filename', async () => {
  const { linkCardInCell, flowsUsingCard } = await import('../src/lib/flowCardLinks.js');
  const { buildIndex, rewriteFlowLinks } = await import('../src/lib/vault.js');
  const cell = linkCardInCell('Argument', 'Evidence/Card.md');
  assert.equal(cell, 'Argument\n[[Evidence/Card.md|Card]]');
  assert.equal(linkCardInCell('Argument\n', 'Evidence/Card.md'), cell);
  assert.equal(linkCardInCell('', 'Evidence/Card.md'), '[[Evidence/Card.md|Card]]');
  assert.throws(() => linkCardInCell('', 'Bad#name.md'), /cannot be represented/);
  const flow = JSON.stringify({
    version: 1,
    metadata: 'keep',
    sheets: [{ name: 'Case', columns: ['1AC'], rows: [[cell]] }],
  });
  const contents = { 'Card.md': '', 'Evidence/Card.md': '', 'Round.flow': flow, 'Note.md': '[[Evidence/Card.md]]' };
  const index = buildIndex(contents);
  assert.deepEqual(index.links['Round.flow'], ['Evidence/Card.md']);
  assert.deepEqual(flowsUsingCard(index, 'Evidence/Card.md'), ['Round.flow']);
  assert.deepEqual(flowsUsingCard(index, 'Card.md'), []);
  const renamed = JSON.parse(rewriteFlowLinks(flow, 'Evidence/Card.md', 'Evidence/New.md', Object.keys(contents)));
  assert.equal(renamed.version, 1);
  assert.equal(renamed.metadata, 'keep');
  assert.equal(renamed.sheets[0].rows[0][0], 'Argument\n[[Evidence/New.md|Card]]');
  const updatedIndex = buildIndex({ 'Evidence/New.flow': '', 'Evidence/New.md': '', 'Round.flow': JSON.stringify(renamed) });
  assert.deepEqual(flowsUsingCard(updatedIndex, 'Evidence/New.md'), ['Round.flow']);
  assert.equal(rewriteFlowLinks('invalid JSON', 'Card.md', 'New.md', Object.keys(contents)), 'invalid JSON');
  assert.equal(rewriteFlowLinks(flow, 'Card.md', 'New.md', Object.keys(contents)), flow);
});

test('wikilink titles show the resolved path and escape HTML attributes', async () => {
  const { createMarkdownParser } = await import('../src/lib/markdown.js');
  const parser = createMarkdownParser(() => 'Folder/Card & "quoted".md');
  const html = parser.parse('[[Card#Evidence|Alias]]');
  assert.match(html, /title="Folder\/Card &amp; &quot;quoted&quot;\.md#Evidence"/);
  assert.match(html, />Alias<\/a>/);
  assert.match(createMarkdownParser(() => null).parse('[[Missing]]'), /title="Missing"/);
});
