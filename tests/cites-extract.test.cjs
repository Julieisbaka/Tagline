const test = require('node:test');
const assert = require('node:assert/strict');

test('citesExtract and health report', async () => {
  const { scanCards, citesExtract, vaultHealthReport } =
    await import('../src/lib/evidenceCheckup.js');
  const files = {
    'a.md':
      '#### Tag one\n\nSmith 20, Jane Smith, 2020, Title, https://x.test/a\n\nFirst point. Middle. Last point.\n',
  };
  const cards = scanCards(files);
  const plain = citesExtract(files, cards);
  assert.match(plain, /Smith 20/);
  assert.doesNotMatch(plain, /Tag one|First point/);
  const full = citesExtract(files, cards, { tagline: true, firstLast: true });
  assert.match(full, /\*\*Tag one\*\*/);
  assert.match(full, /First point\. … Last point\./);
  assert.doesNotMatch(full, /Middle/);
  const report = vaultHealthReport(cards, {
    'https://x.test/a': { status: 'dead', reason: '404' },
  });
  assert.match(report, /## a\.md/);
  assert.match(report, /<https:\/\/x\.test\/a> \(404\)/);
});

test('citesExtract does not reintroduce HTML comment openers while stripping comments', async () => {
  const { scanCards, citesExtract } = await import('../src/lib/evidenceCheckup.js');
  const files = { 'a.md': '#### Card\n<!<!-- nested -->--\n\nBody.\n' };
  const extract = citesExtract(files, scanCards(files));
  assert.doesNotMatch(extract, /<!--/);
});
