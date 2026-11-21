const { test } = require('node:test');
const assert = require('node:assert/strict');

const flowFile = (sheets) => JSON.stringify({ version: 1, sheets });

test('flow documents expose sheet and column headings plus cell text', async () => {
  const { flowDocument } = await import('../src/lib/flowText.js');
  const content = flowFile([
    {
      name: 'Case',
      columns: ['1AC', '1NC'],
      rows: [
        ['Aff plan text', ''],
        ['', 'Neg block text'],
      ],
    },
  ]);
  const { text, cells } = flowDocument(content);
  assert.ok(text.includes('# Case'));
  assert.ok(text.includes('## 1AC'));
  assert.ok(text.includes('## 1NC'));
  assert.ok(text.includes('Aff plan text'));
  assert.ok(text.includes('Neg block text'));
  assert.ok(!text.includes('"version"'));
  assert.equal(cells, 'Aff plan text\nNeg block text');
  assert.deepEqual(flowDocument('not json'), { text: 'not json', cells: 'not json', cellMap: [] });
});

test('keyword search finds flow cells and treats sheet and column names as headings', async () => {
  const { searchVault, filterSearchDocuments } = await import('../src/lib/search.js');
  const contents = {
    'Round.flow': flowFile([
      {
        name: 'Case',
        columns: ['1AC', '1NC'],
        rows: [
          ['Aff plan text', ''],
          ['', 'Neg block text'],
        ],
      },
    ]),
    'Notes.md': '#neg\nPolitical capital.',
  };
  const index = { tags: { neg: ['Notes.md'] } };
  const found = searchVault(contents, index, 'Aff plan text');
  assert.equal(found[0].path, 'Round.flow');
  assert.ok(found[0].matches.some((match) => match.text.includes('Aff plan text')));
  assert.ok(searchVault(contents, index, 'Case 1AC').some((result) => result.path === 'Round.flow'));
  const filtered = filterSearchDocuments(contents, index, '"Neg block"');
  assert.deepEqual(Object.keys(filtered), ['Round.flow']);
  assert.ok(filtered['Round.flow'].includes('Neg block text'));
});

test('flow cells contribute links, backlinks and tags to the vault index', async () => {
  const { buildIndex } = await import('../src/lib/vault.js');
  const contents = {
    'Round.flow': flowFile([
      { name: 'Case', columns: ['1AC'], rows: [['See [[Notes]] and #neg']] },
    ]),
    'Notes.md': 'Links to [[Round.flow#Case]].',
  };
  const index = buildIndex(contents);
  assert.deepEqual(index.links['Round.flow'], ['Notes.md']);
  assert.deepEqual(index.backlinks['Round.flow'], ['Notes.md']);
  assert.ok(index.backlinks['Notes.md'].includes('Round.flow'));
  assert.ok(index.tags.neg.includes('Round.flow'));
});

test('flowDocument maps synthetic cell lines back to sheet, row and column', async () => {
  const { flowDocument } = await import('../src/lib/flowText.js');
  const content = flowFile([
    {
      name: 'Case',
      columns: ['1AC', '1NC'],
      rows: [
        ['Aff plan text', ''],
        ['', 'Neg block text'],
      ],
    },
  ]);
  const { text, cellMap } = flowDocument(content);
  // Lines: 0 '# Case', 1 '## 1AC', 2 'Aff plan text', 3 '## 1NC', 4 'Neg block text'
  assert.equal(cellMap[0], undefined);
  assert.equal(cellMap[1], undefined);
  assert.deepEqual(cellMap[2], { sheetIndex: 0, row: 0, column: 0 });
  assert.equal(cellMap[3], undefined);
  assert.deepEqual(cellMap[4], { sheetIndex: 0, row: 1, column: 1 });
  assert.ok(text.includes('# Case'));
  assert.ok(text.includes('Aff plan text'));
});
