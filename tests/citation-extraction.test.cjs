const { test } = require('node:test');
const assert = require('node:assert/strict');

test('extracts generated citations and keeps commas in publication names', async () => {
  const { createCitation } = await import('../src/lib/citation.js');
  const { extractCardCitation } = await import('../src/lib/citationExtraction.js');
  const source = createCitation({
    author: 'Smith', year: '2021', title: 'Title, with comma', publication: 'Journal, Series B',
    url: 'https://example.com/a', accessed: '2024-01-02',
  });
  const { citation, uncertainFields } = extractCardCitation(source);
  assert.deepEqual(citation, {
    author: 'Smith', year: '2021', title: 'Title, with comma', publication: 'Journal, Series B',
    url: 'https://example.com/a', accessed: '2024-01-02',
  });
  assert.deepEqual(uncertainFields, []);
});

test('extracts an unbolded author-year citation with a quoted title and bare URL', async () => {
  const { extractCardCitation } = await import('../src/lib/citationExtraction.js');
  const { citation, uncertainFields } = extractCardCitation(
    'Smith (2020), "Research report", Journal, https://example.com/article, Accessed 2024-02-29',
  );
  assert.deepEqual(citation, {
    author: 'Smith', year: '2020', title: 'Research report', publication: 'Journal',
    url: 'https://example.com/article', accessed: '2024-02-29',
  });
  assert.deepEqual(uncertainFields, []);
});

test('reports uncertain two-digit years, unstructured publication and invalid access dates without guessing', async () => {
  const { extractCardCitation } = await import('../src/lib/citationExtraction.js');
  const { scanCards, auditCards, citedUrls } = await import('../src/lib/evidenceCheckup.js');
  const files = { 'notes.md': '#### Card\n**Smith 24** — Journal, [site](https://example.com), Accessed 2023-02-29\n' };
  const cards = scanCards(files);
  assert.equal(cards[0].citation.author, 'Smith');
  assert.equal(cards[0].citation.year, '');
  assert.equal(cards[0].citation.publication, '');
  assert.equal(cards[0].citation.accessed, '');
  assert.deepEqual(cards[0].citationUncertainFields, ['year', 'accessed', 'publication']);
  const issues = auditCards(cards, { checks: { stale: true } }, new Date('2026-01-01'));
  assert.deepEqual(issues.map(({ kind, fields }) => ({ kind, fields })), [
    { kind: 'missing_fields', fields: ['title'] },
    { kind: 'uncertain_fields', fields: ['year', 'publication', 'accessed'] },
  ]);
  assert.deepEqual(citedUrls(cards), ['https://example.com']);
  assert.equal(extractCardCitation('**Jones**').uncertainFields.includes('author'), true);
});

test('does not interpret code, quoted examples or ordinary emphasis as citations', async () => {
  const { extractCardCitation } = await import('../src/lib/citationExtraction.js');
  for (const body of [
    '```\n**Smith 2020**\n```',
    '> **Smith 2020**',
    '**Inflation rose 50 percent**\nMore text.',
    'Paragraph.\n**An ordinary emphasis** — not a source',
  ]) {
    const result = extractCardCitation(body);
    if (body.startsWith('**Inflation')) {
      assert.deepEqual(result.uncertainFields, ['author', 'year']);
    } else assert.equal(result.citation, null);
  }
});

test('marks ambiguous quotes and unresolved reference links for review', async () => {
  const { extractCardCitation } = await import('../src/lib/citationExtraction.js');
  const result = extractCardCitation('**Smith 2024** — "A "quoted" title", [article][source]');
  assert.equal(result.citation.title, '');
  assert.equal(result.citation.url, '');
  assert.ok(result.uncertainFields.includes('title'));
  assert.ok(result.uncertainFields.includes('url'));
});

test('extracts multiline citations, note-wide reference links and written dates', async () => {
  const { scanCards } = await import('../src/lib/evidenceCheckup.js');
  const text = [
    '#### First',
    '**Smith, March 3, 2022**',
    'Title: A study',
    'Publication: Policy Journal',
    '[Article][report]',
    'Accessed March 5, 2024',
    'Evidence continues here.',
    '',
    '[report]: https://example.com/report',
    '#### Second',
    '**Jones, 15 May 2023**',
    'doi:10.5555/example.2023',
    '#### Third',
    '**Smith 2022 — "Study", [Archive]**',
    '',
    '[Archive]: https://example.com/archive_(2022)',
  ].join('\n');
  const cards = scanCards({ 'notes.md': text });
  assert.deepEqual(cards[0].citation, {
    author: 'Smith', year: '2022', title: 'A study', publication: 'Policy Journal',
    url: 'https://example.com/report', accessed: '2024-03-05',
  });
  assert.equal(cards[1].citation.author, 'Jones');
  assert.equal(cards[1].citation.year, '2023');
  assert.equal(cards[1].citation.url, 'https://doi.org/10.5555/example.2023');
  assert.equal(cards[2].citation.url, 'https://example.com/archive_(2022)');
});

test('marks invalid or ambiguous dates uncertain instead of inventing a year', async () => {
  const { extractCardCitation } = await import('../src/lib/citationExtraction.js');
  const invalid = extractCardCitation('**Smith, February 30, 2024** — "Study"');
  assert.equal(invalid.citation.year, '');
  assert.ok(invalid.uncertainFields.includes('year'));
  const invalidIso = extractCardCitation('**Smith 2024-02-31** — "Study"');
  assert.equal(invalidIso.citation.year, '');
  assert.ok(invalidIso.uncertainFields.includes('year'));
  const ambiguous = extractCardCitation('**Smith 2024** — "Study", Accessed 03/04/2024');
  assert.equal(ambiguous.citation.accessed, '');
  assert.ok(ambiguous.uncertainFields.includes('accessed'));
});
