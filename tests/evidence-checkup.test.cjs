const { test } = require('node:test');
const assert = require('node:assert/strict');

test('scanCards parses cite lines written by createCitation and ignores cards without one', async () => {
  const { createCitation } = await import('../src/lib/citation.js');
  const { scanCards } = await import('../src/lib/evidenceCheckup.js');
  const cite = createCitation({
    author: 'Smith', year: '2019', title: 'A *study*', publication: 'Journal Vol 2',
    url: 'https://example.com/article', accessed: '2024-01-02',
  });
  const cards = scanCards({
    'a.md': `#### Tag one\n${cite}\nbody\n\n#### Tag two\nno cite here\n\n# Heading\n#### Tag three\n**Jones 2024**\n`,
  });
  assert.equal(cards.length, 3);
  assert.deepEqual(cards[0].citation, {
    author: 'Smith', year: '2019', title: 'A *study*', publication: 'Journal Vol 2',
    url: 'https://example.com/article', accessed: '2024-01-02',
  });
  assert.equal(cards[1].citation, null);
  assert.equal(cards[2].title, 'Tag three');
  assert.deepEqual(
    { author: cards[2].citation.author, year: cards[2].citation.year, url: cards[2].citation.url },
    { author: 'Jones', year: '2024', url: '' },
  );
});

test('auditCards flags missing citations, incomplete fields, and stale dates per the chosen checks', async () => {
  const { scanCards, auditCards } = await import('../src/lib/evidenceCheckup.js');
  const { createCitation } = await import('../src/lib/citation.js');
  const cite = createCitation({ author: 'Smith', year: '2019', title: 'T', publication: 'P', url: 'https://example.com/article', accessed: '2024-01-02' });
  const cards = scanCards({ 'a.md': `#### One\n${cite}\n\n#### Two\nnothing\n\n#### Three\n**Jones 2024**\n` });
  const now = new Date('2026-11-01T12:00:00');

  const all = auditCards(cards, {}, now);
  assert.deepEqual(all.map((issue) => [issue.card, issue.kind]), [
    ['One', 'stale_date'],
    ['Two', 'missing_citation'],
    ['Three', 'missing_fields'],
  ]);
  assert.deepEqual(all[2].fields, ['title', 'publication', 'url', 'accessed']);
  assert.equal(all[0].age, 7);

  const onlyStale = auditCards(cards, { checks: { citations: false } }, now);
  assert.deepEqual(onlyStale.map((issue) => issue.kind), ['stale_date']);

  const threshold = auditCards(cards, { checks: { citations: false }, staleYears: 10 }, now);
  assert.equal(threshold.length, 0);

  const urlOnly = auditCards(cards, { checks: { stale: false }, requiredFields: ['url'] }, now);
  assert.deepEqual(urlOnly.map((issue) => [issue.card, issue.kind, issue.fields]), [
    ['Two', 'missing_citation', undefined],
    ['Three', 'missing_fields', ['url']],
  ]);
});

test('linkIssues reports only dead links and keeps archived copies', async () => {
  const { scanCards, citedUrls, linkIssues } = await import('../src/lib/evidenceCheckup.js');
  const cards = scanCards({ 'a.md': '#### One\n**Smith 2020** — [https://example.com/gone](https://example.com/gone)\n\n#### Two\n**Jones 2021** — [https://example.com/slow](https://example.com/slow)\n' });
  assert.deepEqual(citedUrls(cards), ['https://example.com/gone', 'https://example.com/slow']);
  const issues = linkIssues(cards, {
    'https://example.com/gone': { status: 'dead', reason: 'HTTP 404', archiveUrl: 'https://web.archive.org/web/2020/https://example.com/gone' },
    'https://example.com/slow': { status: 'unverified', reason: 'timed out' },
  });

  assert.deepEqual(issues, [{
    path: 'a.md', card: 'One', lineIndex: 0, kind: 'dead_link', url: 'https://example.com/gone', reason: 'HTTP 404',
    archiveUrl: 'https://web.archive.org/web/2020/https://example.com/gone',
  }]);
});

test('source comparison flags only comparable differences and reports unavailable sources', async () => {
  const { scanCards, sourceIssues } = await import('../src/lib/evidenceCheckup.js');
  const cards = scanCards({
    'a.md': '#### One\n**Smith 2020** — "Study", Journal, [x](https://example.com/a)\n' +
      '#### Two\n**Jones 24** — [x](https://example.com/b)\n' +
      '#### Three\n**Lee 2021** — [x](https://example.com/c)\n',
  });
  const issues = sourceIssues(cards, {
    'https://example.com/a': { metadata: { author: 'Jane Smith', year: '2022', title: 'Study', publication: 'Journal' } },
    'https://example.com/b': { metadata: { year: '2024' } },
    'https://example.com/c': { error: 'HTTP 403' },
  });
  assert.deepEqual(issues.map((item) => [item.card, item.kind, item.field]), [
    ['One', 'source_mismatch', 'year'], ['Two', 'source_not_comparable', undefined],
    ['Three', 'source_unavailable', undefined],
  ]);
  assert.equal(issues[0].citationValue, '2020');
  assert.equal(issues[0].sourceValue, '2022');
});

test('comments target duplicate card headings, refresh idempotently and preserve other categories', async () => {
  const { scanCards, auditCards, annotateEvidence } = await import('../src/lib/evidenceCheckup.js');
  const files = { 'a.md': '#### Same\r\n**Smith 2024**\r\nbody\r\n#### Same\r\nNo citation\r\n' };
  const cards = scanCards(files);
  const issues = auditCards(cards, { checks: { stale: false } });
  const describe = (issue) => issue.kind === 'missing_citation' ? 'No citation --- needs review.' : `Missing ${issue.fields.join(', ')}.`;
  const result = annotateEvidence(files, cards, issues, ['citation'], describe);
  assert.match(result['a.md'], /#### Same\r\n<!-- Evidence checkup \(citation\): Missing title, publication, url, accessed\. -->\r\n\*\*Smith/);
  assert.match(result['a.md'], /#### Same\r\n<!-- Evidence checkup \(citation\): No citation - - - needs review\. -->\r\nNo citation/);
  const rescanned = scanCards(result);
  const again = annotateEvidence(result, rescanned, auditCards(rescanned, { checks: { stale: false } }), ['citation'], describe);
  assert.deepEqual(again, result);
  const linkIssue = { path: 'a.md', card: 'Same', lineIndex: rescanned[0].lineIndex, kind: 'dead_link' };
  const withLink = annotateEvidence(result, rescanned, [linkIssue], ['link'], () => 'Link is dead.');
  assert.match(withLink['a.md'], /Evidence checkup \(citation\).* -->\r\n<!-- Evidence checkup \(link\): Link is dead\. -->/);
  const sourceCard = scanCards(withLink)[0];
  const withSource = annotateEvidence(withLink, scanCards(withLink),
    [{ path: 'a.md', lineIndex: sourceCard.lineIndex, kind: 'source_mismatch' },
    { path: 'a.md', lineIndex: sourceCard.lineIndex, kind: 'source_unavailable' }], ['source'], () => 'Source mismatch.');
  assert.match(withSource['a.md'], /Evidence checkup \(source\): Source mismatch\./);
  const resolved = annotateEvidence(withSource, scanCards(withSource), [], ['citation'], describe);
  assert.doesNotMatch(resolved['a.md'], /Evidence checkup \(citation\)/);
  assert.match(resolved['a.md'], /Evidence checkup \(link\)/);
  assert.match(resolved['a.md'], /Evidence checkup \(source\)/);
});

test('checkup never scans or annotates structured vault files', async () => {
  const { scanCards, annotateEvidence } = await import('../src/lib/evidenceCheckup.js');
  const files = { 'notes.md': '#### Card\nNo citation', 'grid.flow': '#### Not a Markdown card\nData' };
  const cards = scanCards(files);
  assert.deepEqual(cards.map((card) => card.path), ['notes.md']);
  const result = annotateEvidence(files, cards, [{ ...cards[0], kind: 'missing_citation' }], ['citation'], () => 'No citation.');
  assert.equal(result['grid.flow'], files['grid.flow']);
});

test('checkup comments survive visual editing and can be refreshed afterward', async () => {
  const { Editor } = await import('@tiptap/core');
  const { visualExtensions } = await import('../src/lib/visualExtensions.js');
  const { scanCards, annotateEvidence } = await import('../src/lib/evidenceCheckup.js');
  const editor = new Editor({
    element: null, extensions: visualExtensions(), contentType: 'markdown',
    content: '#### Card\n<!-- Evidence checkup (citation): No citation. -->\n<!-- Evidence checkup (source): Mismatch. -->\nText',
  });
  try {
    const markdown = editor.getMarkdown();
    assert.match(markdown, /<!-- Evidence checkup \(citation\): No citation\. -->/);
    assert.match(markdown, /<!-- Evidence checkup \(source\): Mismatch\. -->/);
    const files = { 'a.md': markdown };
    const cards = scanCards(files);
    const result = annotateEvidence(files, cards, [], ['citation'], () => '');
    assert.doesNotMatch(result['a.md'], /Evidence checkup \(citation\)/);
    assert.match(result['a.md'], /Evidence checkup \(source\)/);
    assert.match(result['a.md'], /Text/);
  } finally { editor.destroy(); }
});

test('normalizeCheckup clamps numeric settings and drops unknown fields', async () => {
  const { normalizeCheckup, DEFAULT_CHECKUP } = await import('../src/lib/evidenceCheckup.js');
  assert.equal(normalizeCheckup({ staleYears: 'abc' }).staleYears, DEFAULT_CHECKUP.staleYears);
  assert.equal(normalizeCheckup({ staleYears: 500 }).staleYears, 100);
  assert.equal(normalizeCheckup({ linkTimeoutSeconds: 0 }).linkTimeoutSeconds, 1);
  assert.deepEqual(normalizeCheckup({ requiredFields: ['url', 'bogus'] }).requiredFields, ['url']);
});

test('checkLinks rejects malformed input and skips non-public or non-HTTP URLs without network access', async () => {
  const { checkLinks } = require('../electron/evidenceLinks.cjs');
  await assert.rejects(checkLinks('https://example.com'), /list of URLs/);
  await assert.rejects(checkLinks([42]), /list of URLs/);
  const results = await checkLinks(['http://127.0.0.1/private', 'file:///etc/passwd'], { timeoutSeconds: 1 });
  assert.equal(results['http://127.0.0.1/private'].status, 'skipped');
  assert.equal(results['file:///etc/passwd'].status, 'skipped');
});
