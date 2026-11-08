const { test } = require('node:test');
const assert = require('node:assert/strict');

test('extracts generated citations and keeps commas in publication names', async () => {
  const { createCitation } = await import('../src/lib/citation.js');
  const { extractCardCitation } = await import('../src/lib/citationExtraction.js');
  const source = createCitation({
    author: 'Smith',
    year: '2021',
    title: 'Title, with comma',
    publication: 'Journal, Series B',
    url: 'https://example.com/a',
    accessed: '2024-01-02',
  });
  const { citation, uncertainFields } = extractCardCitation(source);
  assert.deepEqual(citation, {
    author: 'Smith',
    year: '2021',
    title: 'Title, with comma',
    publication: 'Journal, Series B',
    url: 'https://example.com/a',
    accessed: '2024-01-02',
  });
  assert.deepEqual(uncertainFields, []);
});

test('extracts an unbolded author-year citation with a quoted title and bare URL', async () => {
  const { extractCardCitation } = await import('../src/lib/citationExtraction.js');
  const { citation, uncertainFields } = extractCardCitation(
    'Smith (2020), "Research report", Journal, https://example.com/article, Accessed 2024-02-29'
  );
  assert.deepEqual(citation, {
    author: 'Smith',
    year: '2020',
    title: 'Research report',
    publication: 'Journal',
    url: 'https://example.com/article',
    accessed: '2024-02-29',
  });
  assert.deepEqual(uncertainFields, []);
});

test('expands two-digit years to 20xx unless that year is still in the future', async () => {
  const { extractCardCitation, expandTwoDigitYear } =
    await import('../src/lib/citationExtraction.js');
  const { scanCards, auditCards, citedUrls } = await import('../src/lib/evidenceCheckup.js');
  const files = {
    'notes.md':
      '#### Card\n**Smith 24** — Journal, [site](https://example.com), Accessed 2023-02-29\n',
  };
  const cards = scanCards(files);
  assert.equal(cards[0].citation.author, 'Smith');
  assert.equal(cards[0].citation.year, String(expandTwoDigitYear(24)));
  assert.equal(cards[0].citation.publication, '');
  assert.equal(cards[0].citation.accessed, '');
  assert.deepEqual(cards[0].citationUncertainFields, ['accessed', 'publication']);
  const issues = auditCards(cards, { checks: { stale: true } }, new Date('2026-01-01'));
  assert.deepEqual(
    issues.map(({ kind, fields }) => ({ kind, fields })),
    [
      { kind: 'missing_fields', fields: ['title'] },
      { kind: 'uncertain_fields', fields: ['publication', 'accessed'] },
    ]
  );
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
      assert.equal(body.slice(result.fieldSpans.year.start, result.fieldSpans.year.end), '50');
    } else {
      assert.equal(result.citation, null);
    }
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
    author: 'Smith',
    year: '2022',
    title: 'A study',
    publication: 'Policy Journal',
    url: 'https://example.com/report',
    accessed: '2024-03-05',
  });
  assert.equal(cards[1].citation.author, 'Jones');
  assert.equal(cards[1].citation.year, '2023');
  assert.equal(cards[1].citation.url, 'https://doi.org/10.5555/example.2023');
  assert.equal(cards[2].citation.url, 'https://example.com/archive_(2022)');
});

test('builds arXiv and ISBN links and keeps BCE and range years', async () => {
  const { extractCardCitation, expandTwoDigitYear } =
    await import('../src/lib/citationExtraction.js');
  const currentYear = new Date().getFullYear();
  const futureTwoDigit = String((currentYear + 1) % 100).padStart(2, '0');
  const arxiv = extractCardCitation('**Vaswani 2017** — "Attention", arXiv:1706.03762');
  assert.equal(arxiv.citation.author, 'Vaswani');
  assert.equal(arxiv.citation.year, '2017');
  assert.equal(arxiv.citation.title, 'Attention');
  assert.equal(arxiv.citation.url, 'https://arxiv.org/abs/1706.03762');
  assert.deepEqual(arxiv.uncertainFields, []);

  const legacy = extractCardCitation('**Witten 1999** — arXiv:hep-th/9901001');
  assert.equal(legacy.citation.url, 'https://arxiv.org/abs/hep-th/9901001');

  const isbn = extractCardCitation(
    '**Knuth 1997** — "The Art of Computer Programming", ISBN 978-0-201-89683-1'
  );
  assert.equal(isbn.citation.title, 'The Art of Computer Programming');
  assert.equal(isbn.citation.publication, '');
  assert.equal(isbn.citation.url, 'https://openlibrary.org/isbn/9780201896831');

  const bce = extractCardCitation('**Plato, 399 BCE** — "Apology"');
  assert.equal(bce.citation.author, 'Plato');
  assert.equal(bce.citation.year, '399 BCE');
  assert.equal(bce.citation.title, 'Apology');

  const range = extractCardCitation('**Smith 1990-2000** — "Study"');
  assert.equal(range.citation.author, 'Smith');
  assert.equal(range.citation.year, '2000');
  assert.equal(range.citation.title, 'Study');

  const rolled = extractCardCitation(`**Older ${futureTwoDigit}** — "Study"`);
  assert.equal(rolled.citation.year, String(expandTwoDigitYear(futureTwoDigit)));
  assert.ok(Number(rolled.citation.year) <= currentYear - 99);
});

test('validates ISBN check digits before linking', async () => {
  const { extractCardCitation, isValidIsbn } = await import('../src/lib/citationExtraction.js');
  assert.equal(isValidIsbn('978-0-201-89683-1'), true);
  assert.equal(isValidIsbn('0-306-40615-2'), true);
  assert.equal(isValidIsbn('0-8044-2957-X'), true);
  assert.equal(isValidIsbn('978-0-201-89683-2'), false);
  assert.equal(isValidIsbn('0-306-40615-3'), false);
  assert.equal(isValidIsbn('not-an-isbn'), false);

  const valid = extractCardCitation('**Knuth 1997** — ISBN 978-0-201-89683-1');
  assert.equal(valid.citation.url, 'https://openlibrary.org/isbn/9780201896831');
  assert.deepEqual(valid.uncertainFields, []);

  const invalid = extractCardCitation('**Knuth 1997** — ISBN 978-0-201-89683-2');
  assert.equal(invalid.citation.url, '');
  assert.deepEqual(invalid.uncertainFields, ['url']);
});

test('creates citations with BCE years that the extractor can round-trip', async () => {
  const { createCitation, spokenCitations } = await import('../src/lib/citation.js');
  const { extractCardCitation } = await import('../src/lib/citationExtraction.js');
  assert.equal(
    createCitation({ author: 'Plato', year: '399 BCE', title: 'Apology' }),
    '**Plato 399 BCE** — "Apology"'
  );
  assert.equal(createCitation({ author: 'Smith', year: '2024' }), '**Smith 2024**');

  const { citation, uncertainFields } = extractCardCitation(
    createCitation({ author: 'Plato', year: '399 BCE', title: 'Apology' })
  );
  assert.equal(citation.author, 'Plato');
  assert.equal(citation.year, '399 BCE');
  assert.equal(citation.title, 'Apology');
  assert.deepEqual(uncertainFields, []);

  assert.equal(spokenCitations('**Plato 399 BCE** — "Apology"'), 'Plato 399 BCE');
  assert.equal(spokenCitations('**Smith 1990-2000** — "Study"'), 'Smith 1990-2000');
  assert.equal(spokenCitations('**Smith 24 — Example Journal 2024**'), 'Smith 24');

  assert.throws(() => createCitation({ author: 'Smith', year: '399 BCEX' }));
  assert.throws(() => createCitation({ author: 'Smith', year: '20245' }));
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

test('parses wrapped bold cites and debate separators/forms', async () => {
  const { extractCardCitation } = await import('../src/lib/citationExtraction.js');
  const wrapped = extractCardCitation(
    '**Smith (2020) \u201cLong title\ncontinues here,\u201d Journal**'
  );
  assert.equal(wrapped.citation.author, 'Smith');
  assert.equal(wrapped.citation.year, '2020');
  assert.match(wrapped.citation.title, /Long title continues here/);

  const emdash = extractCardCitation('**Smith \u2014 2024** — "Study"');
  assert.equal(emdash.citation.author, 'Smith');
  assert.equal(emdash.citation.year, '2024');

  const nd = extractCardCitation('**United States, n.d.** — "Report"');
  assert.equal(nd.citation.author, 'United States');
  assert.equal(nd.citation.year, 'n.d.');

  const locator = extractCardCitation('**Jones 2021** — "Case", Journal, p. 4');
  assert.equal(locator.citation.author, 'Jones');
  assert.match(locator.citation.locator || '', /p\. 4/);

  assert.equal(typeof wrapped.fieldConfidence.author, 'number');
});

test('field spans trace original UTF-16 text through wrapping, escaping and normalization', async () => {
  const { extractCardCitation } = await import('../src/lib/citationExtraction.js');
  const body =
    '<!-- note -->\r\n**D\u00edaz\\_Garc\u00eda, March 3,\r\n2022**\r\n' +
    'Title: A wrapped\r\nPublication: Policy Journal\r\n' +
    '[Article](https://example.com/a_(b))\r\nAccessed March 5, 2024\r\n';
  const result = extractCardCitation(body);
  assert.equal(result.citation.author, 'D\u00edaz_Garc\u00eda');
  assert.equal(result.citation.year, '2022');
  assert.equal(result.citation.accessed, '2024-03-05');
  const fields = {
    author: 'D\u00edaz\\_Garc\u00eda',
    year: 'March 3,\r\n2022',
    title: 'A wrapped',
    publication: 'Policy Journal',
    url: 'https://example.com/a_(b)',
    accessed: 'March 5, 2024',
  };
  for (const [field, expected] of Object.entries(fields)) {
    const span = result.fieldSpans[field];
    assert.ok(span, `missing ${field} span`);
    assert.equal(body.slice(span.start, span.end), expected, field);
  }
});

test('field spans trace references, identifiers, and uncertain values to their source', async () => {
  const { extractCardCitation } = await import('../src/lib/citationExtraction.js');
  const references = { report: { href: 'https://example.com/long/path' } };
  const text = '**Smith 24** — "Study", [Article][report], Accessed 03/04/2024';
  const result = extractCardCitation(text, references);
  assert.equal(result.citation.url, references.report.href);
  assert.equal(
    text.slice(result.fieldSpans.url.start, result.fieldSpans.url.end),
    '[Article][report]'
  );
  assert.equal(text.slice(result.fieldSpans.year.start, result.fieldSpans.year.end), '24');
  assert.ok(result.uncertainFields.includes('accessed'));
  assert.equal(
    text.slice(result.fieldSpans.accessed.start, result.fieldSpans.accessed.end),
    '03/04/2024'
  );

  for (const [source, expected] of [
    ['**Lee 2020** — doi:10.5555/test.', '10.5555/test'],
    ['**Lee 2020** — arXiv:1706.03762', '1706.03762'],
    ['**Lee 2020** — ISBN 978-0-201-89683-1', '978-0-201-89683-1'],
    ['**Lee 2020** — [Missing][ref]', '[Missing][ref]'],
  ]) {
    const { fieldSpans } = extractCardCitation(source);
    assert.equal(source.slice(fieldSpans.url.start, fieldSpans.url.end), expected);
  }
});

test('spans distinguish repeated text and preserve Unicode offsets and year forms', async () => {
  const { extractCardCitation } = await import('../src/lib/citationExtraction.js');
  for (const [year, value] of [
    ['n.d.', 'n.d.'],
    ['1990-2000', '2000'],
    ['399 BCE', '399 BCE'],
  ]) {
    const text = `<!-- \ud83d\udcda -->\n**Smith ${year}** — "Journal", Journal, vol. 2, no. 3`;
    const { citation, fieldSpans } = extractCardCitation(text);
    assert.equal(citation.year, value);
    assert.equal(text.slice(fieldSpans.year.start, fieldSpans.year.end), year);
    assert.equal(text.slice(fieldSpans.title.start, fieldSpans.title.end), 'Journal');
    assert.equal(text.slice(fieldSpans.publication.start, fieldSpans.publication.end), 'Journal');
    assert.notEqual(fieldSpans.title.start, fieldSpans.publication.start);
    assert.equal(text.slice(fieldSpans.volume.start, fieldSpans.volume.end), '2');
    assert.equal(text.slice(fieldSpans.issue.start, fieldSpans.issue.end), '3');
  }
});

test('classifies personal, multiple and corporate authors without changing their text', async () => {
  const { extractCardCitation } = await import('../src/lib/citationExtraction.js');
  for (const [author, kind] of [
    ['Smith', 'name'],
    ['Jane Smith', 'first-last'],
    ['Smith, Jane', 'last-first'],
    ['Smith, Jane, Jones, Mary', 'multi'],
    ['Smith and Jones', 'multi'],
    ['Smith et al.', 'multi'],
    ['World Health Organization', 'corporate'],
    ['WHO', 'corporate'],
    ['United States, Department of State', 'corporate'],
    ['Research and Development Department', 'corporate'],
    ['University of Oxford and World Health Organization', 'multi'],
    ['World Health Organization and Jane Smith', 'multi'],
  ]) {
    const result = extractCardCitation(`**${author} 2020** — "Study"`);
    assert.equal(result.citation.author, author);
    assert.equal(result.authorKind, kind, author);
  }
});

test('Ibid resolves only with previous context and retains explicit locators', async () => {
  const { extractCardCitation } = await import('../src/lib/citationExtraction.js');
  const original = extractCardCitation(
    '**Jane Smith 2020** — "Study", Journal, p. 5, [a](https://example.com/a)'
  );
  const repeated = extractCardCitation('**Ibid., p. 12**', {}, original);
  assert.equal(repeated.ibidResolved, true);
  assert.equal(repeated.citation.author, 'Jane Smith');
  assert.equal(repeated.citation.title, 'Study');
  assert.equal(repeated.citation.url, 'https://example.com/a');
  assert.equal(repeated.citation.locator, 'p. 12');
  assert.equal(repeated.authorKind, 'first-last');
  assert.equal(repeated.citation.form, 'ibid');
  assert.ok(repeated.inheritedFields.includes('author'));
  assert.equal(repeated.inheritedFields.includes('locator'), false);
  assert.equal(repeated.fieldSpans.author, undefined);
  assert.deepEqual(repeated.fieldSpans.locator, { start: 9, end: 14 });
  const chained = extractCardCitation('Ibid.', {}, repeated);
  assert.equal(chained.citation.locator, 'p. 12');
  assert.equal(chained.citation.author, 'Jane Smith');
  const implicitPage = extractCardCitation('Ibid., at 42–45', {}, original);
  assert.equal(implicitPage.citation.locator, '42–45');
  assert.equal(
    'Ibid., at 42–45'.slice(
      implicitPage.fieldSpans.locator.start,
      implicitPage.fieldSpans.locator.end
    ),
    '42–45'
  );
  const unresolved = extractCardCitation('Ibid., p. 3');
  assert.equal(unresolved.ibidResolved, false);
  assert.equal(unresolved.citation.author, '');
  assert.ok(unresolved.uncertainFields.includes('author'));
  assert.equal(extractCardCitation('Ibid.', {}, unresolved).ibidResolved, false);
  assert.equal(extractCardCitation('Ibid is a word, not a citation.', {}, original).citation, null);
});

test('publication spans expose exact segments when other fields interrupt the source', async () => {
  const { extractCardCitation } = await import('../src/lib/citationExtraction.js');
  const text = '**Smith 2020** — "Study", Journal, vol. 2, Series B';
  const { fieldSpans } = extractCardCitation(text);
  assert.ok(fieldSpans.publication.segments.length > 1);
  const fragments = fieldSpans.publication.segments.map(({ start, end }) => text.slice(start, end));
  assert.ok(fragments.join('').includes('Journal'));
  assert.ok(fragments.join('').includes('Series B'));
  assert.ok(!fragments.join('').includes('vol. 2'));
});

test('Ibid propagates uncertain inherited fields and allows local overrides', async () => {
  const { extractCardCitation } = await import('../src/lib/citationExtraction.js');
  const source = extractCardCitation('**Smith, February 30, 2024** — "Study", Accessed 03/04/2024');
  const next = extractCardCitation('Ibid., Accessed 2024-05-01', {}, source);
  assert.ok(next.uncertainFields.includes('year'));
  assert.ok(next.inheritedFields.includes('year'));
  assert.equal(next.uncertainFields.includes('accessed'), false);
  assert.equal(next.citation.accessed, '2024-05-01');
});
