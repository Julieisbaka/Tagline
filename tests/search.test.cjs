const { test } = require('node:test');
const assert = require('node:assert/strict');

test('hybrid keywords retrieve partial terms without relaxing full-text AND matching', async () => {
  const { searchVault } = await import('../src/lib/search.js');
  const contents = {
    'Grid.md': '# Grid\nTransmission infrastructure.',
    'Solar.md': 'Solar electricity improves energy supply.',
    'Food.md': 'Chocolate and butter.',
  };
  const index = { tags: {} };
  assert.deepEqual(searchVault(contents, index, 'grid solar'), []);
  assert.deepEqual(new Set(searchVault(contents, index, 'grid solar', 10, { matchAll: false })
    .map((item) => item.path)), new Set(['Grid.md', 'Solar.md']));
  assert.ok(searchVault(contents, index, 'grid solar', 10, { matchAll: false })
    .every((item) => Number.isFinite(item.rank)));
});

test('semantic and keyword candidates share mandatory tags and accent-folded phrase filters', async () => {
  const { filterSearchDocuments, searchVault } = await import('../src/lib/search.js');
  const contents = {
    'Exact.md': '#neg\nPolitical capital and électricité.',
    'Split.md': '#neg\nPolitical unrelated capital and electricity.',
    'Other.md': '#aff\nPolitical capital.',
    'Round.flow': 'Political capital.',
  };
  const index = { tags: { neg: ['Exact.md', 'Split.md'], aff: ['Other.md'] } };
  assert.deepEqual(filterSearchDocuments(contents, index, 'tag:neg "political capital" energy'), {
    'Exact.md': contents['Exact.md'],
  });
  assert.deepEqual(searchVault(contents, index, 'tag:neg "political capital" energy', 10, { matchAll: false })
    .map((item) => item.path), ['Exact.md']);
  assert.deepEqual(Object.keys(filterSearchDocuments(contents, index, '"ELECTRICITE"')), ['Exact.md']);
  assert.deepEqual(filterSearchDocuments(contents, index, 'tag:missing'), {});
  assert.deepEqual(Object.keys(filterSearchDocuments(contents, index, 'tag:neg')), ['Exact.md', 'Split.md']);
});

test('rank fusion promotes agreement, retrieves semantic-only matches and limits after fusion', async () => {
  const { mergeHybridResults } = await import('../src/lib/search.js');
  const keywords = [
    { path: 'Exact.md', rank: 1000, matches: [{ line: 4, text: 'Exact keyword phrase' }] },
    { path: 'Both.md', rank: 50, matches: [{ line: 2, text: 'Related evidence' }] },
  ];
  const semantic = [
    { path: 'Meaning.md', score: 0.95, line: 8, text: 'A relevant paraphrase' },
    { path: 'Both.md', score: 0.9, line: 5, text: 'Best matching passage' },
  ];
  const results = mergeHybridResults(keywords, semantic, 3);
  assert.equal(results.length, 3);
  assert.equal(results[0].path, 'Both.md', 'Agreement across independent rankings should win');
  assert.deepEqual(results[0].sources, ['keyword', 'semantic']);
  assert.equal(results[0].score, 0.9);
  assert.deepEqual(results[0].matches.map((match) => match.line), [2, 5]);
  assert.deepEqual(mergeHybridResults(keywords, semantic, 1), [results[0]]);
  assert.ok(results.some((item) => item.path === 'Meaning.md'));
  const rescaled = mergeHybridResults(keywords.map((item) => ({ ...item, rank: item.rank * 1e8 })),
    semantic.map((item) => ({ ...item, score: item.score / 1000 })), 3);
  assert.deepEqual(rescaled.map((item) => item.path), results.map((item) => item.path),
    'Unlike score scales must not change rank fusion');
});

test('fusion avoids duplicated files, sources and snippets and bounds excerpt count', async () => {
  const { mergeHybridResults } = await import('../src/lib/search.js');
  const keyword = {
    path: 'Card.md', matches: [
      { line: 0, text: 'zero' }, { line: 1, text: 'one' },
      { line: 2, text: 'two' }, { line: 3, text: 'three' }, { line: 4, text: 'four' },
    ]
  };
  const semantic = { path: 'Card.md', score: 0.7, line: 0, text: 'zero' };
  const [result] = mergeHybridResults([keyword, keyword], [semantic, semantic]);
  assert.deepEqual(result.sources, ['keyword', 'semantic']);
  assert.equal(result.rank, 2 / 61);
  assert.equal(result.matches.length, 4);
  assert.equal(new Set(result.matches.map((item) => item.line)).size, 4);
});

test('keyword-only and semantic-only fusion preserve rankings and deterministic ties', async () => {
  const { mergeHybridResults } = await import('../src/lib/search.js');
  const keywords = [{ path: 'Z.md', matches: [] }, { path: 'A.md', matches: [] }];
  const semantic = [{ path: 'B.md', score: 0.9, line: 0, text: 'evidence' }];
  assert.deepEqual(mergeHybridResults(keywords, []).map((item) => item.path), ['Z.md', 'A.md']);
  assert.deepEqual(mergeHybridResults([], semantic)[0].sources, ['semantic']);
  assert.deepEqual(mergeHybridResults([keywords[0]], semantic).map((item) => item.path), ['B.md', 'Z.md']);
  assert.deepEqual(mergeHybridResults([], []), []);
  for (const limit of [0, -1, 1.5, 1001, NaN]) {
    assert.throws(() => mergeHybridResults([], [], limit), /Maximum search results/);
  }
});
