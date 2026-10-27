const { test } = require('node:test');
const assert = require('node:assert/strict');

test('passage proximity ranks a focused warrant above scattered term mentions', async () => {
  const { searchVault } = await import('../src/lib/search.js');
  const contents = {
    'A scattered.md': `Grid evidence.\n${'Unrelated text. '.repeat(60)}\nTransmission evidence.`,
    'Z focused.md': 'Grid upgrades improve transmission.',
  };
  const results = searchVault(contents, { tags: {} }, 'grid transmission');
  assert.equal(results[0].path, 'Z focused.md');
  assert.equal(results[0].matches[0].line, 0);
  const padding = 'Other evidence. '.repeat(20);
  const equallyLong = {
    'A scattered.md': `Grid ${padding}upgrades transmission.`,
    'Z focused.md': `Grid upgrades transmission. ${padding}`,
  };
  assert.equal(searchVault(equallyLong, { tags: {} }, 'grid transmission')[0].path, 'Z focused.md',
    'Proximity must break ties between passages with the same words and no exact query phrase');
});

test('single-edit typo recovery is explicit, conservative and never relaxes constraints', async () => {
  const { searchVault } = await import('../src/lib/search.js');
  const contents = {
    'Neg.md': '#neg\nTransmission infrastructure improves resilience.',
    'Aff.md': '#aff\nTransmission infrastructure improves resilience.',
  };
  const index = { tags: { neg: ['Neg.md'], aff: ['Aff.md'] } };
  for (const typo of ['transmision', 'transmisssion', 'transmissiom', 'transmisison']) {
    const results = searchVault(contents, index, `tag:neg ${typo}`);
    assert.deepEqual(results.map((result) => result.path), ['Neg.md'], typo);
    assert.equal(results[0].approximate, true);
    assert.deepEqual(results[0].matchedTerms, ['transmission']);
  }
  assert.deepEqual(searchVault(contents, index, 'tag:missing transmision'), []);
  assert.deepEqual(searchVault(contents, index, '"transmision"'), []);
  assert.deepEqual(searchVault(contents, index, 'transmision nonexistent'), []);
  assert.deepEqual(searchVault({ 'Test.md': 'grid' }, { tags: {} }, 'gird'), []);
  const exact = searchVault({ ...contents, 'Exact.md': 'transmision' }, index, 'transmision');
  assert.deepEqual(exact.map((result) => result.path), ['Exact.md']);
  assert.equal(exact[0].approximate, undefined);
});

test('prepared engines keep a content snapshot and new engines reflect edits and removals', async () => {
  const { createSearchEngine, searchVault } = await import('../src/lib/search.js');
  const contents = { 'Grid.md': '# Grid\nTransmission infrastructure.' };
  const index = { tags: {} };
  const search = createSearchEngine(contents, index);
  for (const query of ['grid', 'transmission', 'transmision', '"transmission infrastructure"']) {
    assert.deepEqual(search(query), searchVault(contents, index, query));
  }
  contents['Grid.md'] = 'New evidence about agriculture.';
  assert.equal(search('transmission').length, 1);
  assert.equal(createSearchEngine(contents, index)('transmission').length, 0);
  delete contents['Grid.md'];
  assert.deepEqual(createSearchEngine(contents, index)('agriculture'), []);
});

test('excerpts expose deep matches, fold accents and preserve original characters', async () => {
  const { searchExcerpt } = await import('../src/lib/search.js');
  const text = `${'Background context. '.repeat(40)}Électricité improves grid resilience.`;
  const excerpt = searchExcerpt(text, ['electricite', 'grid']);
  assert.deepEqual(excerpt.filter((part) => part.match).map((part) => part.text), ['Électricité', 'grid']);
  assert.ok(excerpt.map((part) => part.text).join('').startsWith('…'));
  assert.ok(excerpt.map((part) => part.text).join('').length <= 202);
  assert.deepEqual(searchExcerpt('No matching text', ['grid']), [{ text: 'No matching text', match: false }]);
  assert.equal(searchExcerpt('😀 Électricité', ['electricite']).filter((part) => part.match)[0].text, 'Électricité');
  const dense = `${'grid '.repeat(60)}resilience`;
  assert.ok(searchExcerpt(dense, ['grid', 'resilience']).map((part) => part.text).join('').length <= 202);
});

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
