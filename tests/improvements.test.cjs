const { test } = require('node:test');
const assert = require('node:assert/strict');

test('cache limits trim immediately, enforce character budgets, and allow disabling', async () => {
  const { configureVisualCache, cacheDocument, cachedDocument } = await import('../src/lib/visualCache.js');
  const json = { type: 'doc', content: [] };
  configureVisualCache(2, 1000);
  cacheDocument('a', json); cacheDocument('b', json);
  cachedDocument('a');
  cacheDocument('c', json);
  assert.equal(cachedDocument('b'), null);
  assert.deepEqual(cachedDocument('a'), json);
  configureVisualCache(1, 1000);
  assert.equal(cachedDocument('c'), null);
  configureVisualCache(1, 1);
  assert.equal(cachedDocument('a'), null);
  cacheDocument('large', json);
  assert.equal(cachedDocument('large'), null);
  configureVisualCache(0, 1000);
  cacheDocument('disabled', json);
  assert.equal(cachedDocument('disabled'), null);
  assert.throws(() => configureVisualCache(-1, 0));
  configureVisualCache(16, 4_000_000);
});

test('citation creator validates, escapes markup, and reading time counts only the spoken lead', async () => {
  const { createCitation, spokenCitations } = await import('../src/lib/citation.js');
  const { cardStats, formatDuration } = await import('../src/lib/card.js');
  const cite = createCitation({ author: 'Smith', year: '2024', title: 'A *study*', url: 'https://example.com/a(b)' });
  assert.ok(cite.startsWith('**Smith 2024**'));
  assert.ok(cite.includes('\\*study\\*'));
  assert.throws(() => createCitation({ author: '', year: '24' }));
  assert.throws(() => createCitation({ author: 'X', year: '2024', url: 'file:///bad' }));
  assert.equal(spokenCitations('**Smith 24 — Example Journal 2024**'), 'Smith 24');
  const stats = cardStats(`#### Tag\n${cite}\n==Read these words==`);
  assert.equal(stats.citationWords, 2);
  assert.equal(stats.highlighted, 3);
  assert.equal(stats.readWords, 5);
  assert.equal(cardStats('<mark>read <sup>this</sup></mark>').highlighted, 2);
  assert.equal(formatDuration(61), '1:01');
  assert.equal(formatDuration(12), '0:12');
});

test('full text ranking favors titles and headings before limiting, respects phrases and tags', async () => {
  const { searchVault } = await import('../src/lib/search.js');
  const contents = {
    'A.md': '# Other\n' + 'grid transmission text '.repeat(100),
    'Grid.md': '# Grid\n## Transmission\nUseful evidence.',
    'Phrase.md': '# Phrase\npolitical capital costs',
    'Split.md': '# Split\npolitical other capital',
    'Résumé.md': '# Résumé\nélectricité',
  };
  const index = { tags: { aff: ['Grid.md'] } };
  assert.equal(searchVault(contents, index, 'grid transmission', 1)[0].path, 'Grid.md');
  assert.deepEqual(searchVault(contents, index, '"political capital"').map((r) => r.path), ['Phrase.md']);
  assert.deepEqual(searchVault(contents, index, 'tag:aff grid').map((r) => r.path), ['Grid.md']);
  assert.equal(searchVault(contents, index, 'electricite')[0].path, 'Résumé.md');
  assert.equal(searchVault(contents, index, '', 1).length, 0);
  const { lexicalAffinity } = require('../electron/embeddingMath.cjs');
  assert.equal(lexicalAffinity('grid grid infrastructure', 'Grid upgrades'), 0.5);
  assert.equal(lexicalAffinity('electricite', 'électricité'), 1);
  assert.equal(lexicalAffinity('', 'text'), 0);
});

test('folder normalization preserves existing paths and filenames; migration is deepest first', async () => {
  const { normalizeFolders, migrationPlan } = await import('../src/lib/folderPaths.js');
  const { rewriteLinks } = await import('../src/lib/vault.js');
  assert.equal(normalizeFolders('New Folder/A note.md', false), 'New_Folder/A note.md');
  assert.equal(normalizeFolders('Old Folder/New Folder/A.md', false, ['Old Folder']), 'Old Folder/New_Folder/A.md');
  assert.equal(normalizeFolders('New Folder', true), 'New_Folder');
  const tree = [{ type: 'folder', path: 'A B', children: [{ type: 'folder', path: 'A B/C D', children: [] }] }];
  assert.deepEqual(migrationPlan(tree), [{ from: 'A B/C D', to: 'A B/C_D' }, { from: 'A B', to: 'A_B' }]);
  assert.equal(rewriteLinks('[[A B/Card#Tag|label]]', 'A B/Card.md', 'A_B/Card.md', ['A B/Card.md']),
    '[[A_B/Card#Tag|label]]');
});
