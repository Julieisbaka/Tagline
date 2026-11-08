const { test } = require('node:test');
const assert = require('node:assert/strict');

test('detects real card headings and preserves original line positions and boundaries', async () => {
  const { detectCards } = await import('../src/lib/cardDetection.js');
  const text = [
    '---',
    'description: |',
    '  #### Not a card',
    '---',
    '  #### First tag ###',
    '<!-- note',
    '#### Hidden',
    '-->',
    '__Smith 2024__ — "Study"',
    'Evidence',
    '```md',
    '#### In code',
    '**False 2022**',
    '```',
    '    #### Indented code',
    '> #### Quote',
    '##### Subheading',
    '~~~',
    '#### Also code',
    '~~~',
    '#### Second',
    '**Jones**',
    '# End',
  ].join('\r\n');
  const cards = detectCards(text);
  assert.deepEqual(
    cards.map(({ title, lineIndex, endLineIndex, confidence, weak }) => ({
      title,
      lineIndex,
      endLineIndex,
      confidence,
      weak,
    })),
    [
      { title: 'First tag', lineIndex: 4, endLineIndex: 20, confidence: 1, weak: false },
      { title: 'Second', lineIndex: 20, endLineIndex: 22, confidence: 1, weak: false },
    ]
  );
  assert.equal(typeof cards[0].startOffset, 'number');
  assert.ok(cards[0].endOffset > cards[0].startOffset);
});

test('fences, embedded comments, and ordinary bold evidence do not supply citations', async () => {
  const { scanCards } = await import('../src/lib/evidenceCheckup.js');
  const text = [
    '#### First',
    '<!-- **False 2024** -->',
    'Evidence paragraph.',
    '**Emphasized words** are important.',
    '```',
    '**Fake 2020**',
    '```',
    '**Smith 2023** — Journal',
    '#### Second',
    'Text',
    '**Bold evidence**',
    '#### Third',
    'No citation',
    '    **Indented 2024**',
  ].join('\n');
  const cards = scanCards({ 'notes.md': text });
  assert.deepEqual(
    cards.map((card) => card.citation?.author || null),
    ['Smith', null, null]
  );
});

test('checkup and card statistics share detection while comments target exact headings', async () => {
  const { scanCards, auditCards, annotateEvidence } = await import('../src/lib/evidenceCheckup.js');
  const { cardStats } = await import('../src/lib/card.js');
  const text =
    '---\nname: "#### fake"\n---\n```md\n#### fake\n```\n  #### Real ###\n__Smith 2024__\n';
  const files = { 'notes.md': text };
  const cards = scanCards(files);
  assert.equal(cardStats(text).cards, 1);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, 'Real');
  assert.equal(cards[0].citation.author, 'Smith');
  assert.equal(cards[0].citation.year, '2024');
  const issues = auditCards(cards, { checks: { stale: false } });
  const updated = annotateEvidence(files, cards, issues, ['citation'], () => 'Missing fields.');
  assert.match(
    updated['notes.md'],
    /  #### Real ###\n<!-- Evidence checkup \(citation\): Missing fields\. -->/
  );
  assert.match(updated['notes.md'], /```md\n#### fake\n```/);
});

test('unclosed fences and comments hide headings through the end of the document', async () => {
  const { detectCards } = await import('../src/lib/cardDetection.js');
  assert.equal(detectCards('````js\n```\n#### hidden\n').length, 0);
  assert.equal(detectCards('<!-- hidden\n#### hidden\n').length, 0);
  assert.equal(detectCards('~~~\n#### hidden\n~~~\n#### visible').length, 1);
  assert.equal(detectCards('Inline `<!--` is not a comment.\n#### visible').length, 1);
});

test('raw HTML and setext headings cannot produce or extend cards', async () => {
  const { detectCards } = await import('../src/lib/cardDetection.js');
  const text = [
    '#### First',
    '**Smith 2024**',
    '<pre>',
    '#### Fake',
    '**Fake 2020**',
    '</pre>',
    'New section',
    '---',
    '**Jones 2023**',
    '#### Second',
    '**Lee 2024**',
    '<script type="text/plain">',
    '#### Fake script',
    '</script>',
    '#### Third',
  ].join('\n');
  const cards = detectCards(text);
  assert.deepEqual(
    cards.map(({ title, lineIndex, endLineIndex }) => [title, lineIndex, endLineIndex]),
    [
      ['First', 0, 6],
      ['Second', 9, 14],
      ['Third', 14, 15],
    ]
  );
});

test('bold evidence with ordinary numbers is not mistaken for a citation', async () => {
  const { scanCards } = await import('../src/lib/evidenceCheckup.js');
  const text = [
    '#### First',
    '**Important evidence** continues here.',
    '**Inflation rose 50 percent**',
    '**Smith 24** — Journal',
    '#### Second',
    '**Jones**',
    '#### Third',
    'Text',
    '**More evidence** — not a citation',
  ].join('\n');
  assert.deepEqual(
    scanCards({ 'notes.md': text }).map((card) => card.citation?.author || null),
    ['Smith', 'Jones', null]
  );
});

test('parser ignores headings in lists, tables, blockquotes and HTML and retains CRLF locations', async () => {
  const { detectCards } = await import('../src/lib/cardDetection.js');
  const text = [
    '---',
    'name: test',
    '---',
    '- item',
    '  #### nested',
    '',
    '| a | b |',
    '| - | - |',
    '| #### table | x |',
    '',
    '<div>',
    '#### html',
    '</div>',
    '',
    '> #### quote',
    '',
    '#### Real',
    '',
    'Text',
    'Setext section',
    '---',
    '#### Last',
  ].join('\r\n');
  assert.deepEqual(
    detectCards(text).map(({ title, lineIndex, endLineIndex }) => ({
      title,
      lineIndex,
      endLineIndex,
    })),
    [
      { title: 'Real', lineIndex: 16, endLineIndex: 18 },
      { title: 'Last', lineIndex: 21, endLineIndex: 22 },
    ]
  );
});

test('cleans inline markdown in titles, handles trailing hashes and duplicate titles', async () => {
  const { detectCards } = await import('../src/lib/cardDetection.js');
  const text = [
    '#### **Heg** — AT: Economy ####',
    'cite',
    '#### **Heg** — AT: Economy',
    'cite',
  ].join('\n');
  const cards = detectCards(text);
  assert.deepEqual(
    cards.map((c) => c.title),
    ['Heg — AT: Economy', 'Heg — AT: Economy']
  );
});

test('##### subheads stay inside a card by default', async () => {
  const { detectCards } = await import('../src/lib/cardDetection.js');
  const cards = detectCards('#### Card\ntext\n##### Sub\nmore\n#### Next\n');
  assert.deepEqual(
    cards.map((c) => [c.title, c.endLineIndex]),
    [
      ['Card', 4],
      ['Next', 6],
    ]
  );
});

test('offsets are stable for selection/folding', async () => {
  const { detectCards } = await import('../src/lib/cardDetection.js');
  const text = '#### One\nbody\n#### Two\n';
  const [a, b] = detectCards(text);
  assert.equal(text.slice(a.startOffset, a.endOffset), '#### One\nbody\n');
  assert.equal(text.slice(b.startOffset).startsWith('#### Two'), true);
});

test('configurable depth and weak candidates with confidence', async () => {
  const { detectCards } = await import('../src/lib/cardDetection.js');
  const text = '### Top\n#### Card\n##### Sub\n';
  assert.deepEqual(
    detectCards(text, { depth: 3 }).map((c) => [c.title, c.depth, c.confidence]),
    [['Top', 3, 1]]
  );
  const weak = detectCards(text, { weak: true });
  assert.ok(weak.some((c) => c.title === 'Sub' && c.weak && c.confidence < 1));
  assert.ok(weak.some((c) => c.title === 'Card' && !c.weak));
});

test('explicit marker pairs take priority over headings and preserve citation offsets', async () => {
  const { detectCards } = await import('../src/lib/cardDetection.js');
  const { scanCards } = await import('../src/lib/evidenceCheckup.js');
  const { getSectionAt } = await import('../src/lib/card.js');
  const text = [
    '---',
    'name: Test',
    '---',
    '#### Before',
    '**Old 2020**',
    '<!-- card:start -->',
    '## Explicit title',
    '**Smith 2024** — Journal',
    '#### Nested heading',
    'Evidence',
    '<!-- card:end -->',
    '#### After',
    '**Jones 2023**',
  ].join('\r\n');
  const cards = detectCards(text);
  assert.deepEqual(
    cards.map((card) => card.title),
    ['Before', 'Explicit title', 'After']
  );
  assert.equal(cards[1].explicit, true);
  assert.equal(
    text.slice(cards[1].startOffset, cards[1].endOffset),
    '<!-- card:start -->\r\n## Explicit title\r\n**Smith 2024** — Journal\r\n#### Nested heading\r\nEvidence\r\n<!-- card:end -->\r\n'
  );
  assert.equal(
    text.slice(cards[0].startOffset, cards[0].endOffset),
    '#### Before\r\n**Old 2020**\r\n'
  );
  const [explicit] = scanCards({ 'x.md': text }).filter((card) => card.title === 'Explicit title');
  assert.equal(explicit.citation.author, 'Smith');
  assert.equal(
    text.slice(explicit.citationFieldSpans.author.start, explicit.citationFieldSpans.author.end),
    'Smith'
  );
  assert.equal(getSectionAt(text, text.indexOf('Evidence')).title, 'Explicit title');
});

test('marker-like text in code and unpaired or nested comments does not create explicit cards', async () => {
  const { detectCards } = await import('../src/lib/cardDetection.js');
  const text =
    '```\n<!-- card:start -->\n<!-- card:end -->\n```\n<!-- card:start -->\n#### Visible\n';
  assert.deepEqual(
    detectCards(text).map((card) => card.title),
    ['Visible']
  );
  const nested =
    '<!-- card:start -->\n<!-- card:start -->\n#### Visible\n<!-- card:end -->\n<!-- card:end -->\n';
  assert.deepEqual(
    detectCards(nested).map((card) => card.title),
    ['Visible']
  );
});

test('explicit markers survive visual Markdown round trips', async () => {
  const { Editor } = await import('@tiptap/core');
  const { visualExtensions } = await import('../src/lib/visualExtensions.js');
  const { visualBlocker } = await import('../src/lib/visualHelpers.js');
  const editor = new Editor({
    element: null,
    extensions: visualExtensions(),
    contentType: 'markdown',
    content: '<!-- card:start -->\n## Title\n**Smith 2024**\n<!-- card:end -->',
  });
  try {
    const result = editor.getMarkdown();
    assert.match(result, /<!-- card:start -->/);
    assert.match(result, /<!-- card:end -->/);
    const { detectCards } = await import('../src/lib/cardDetection.js');
    assert.equal(detectCards(result)[0].title, 'Title');
    assert.equal(visualBlocker(result), null);
  } finally {
    editor.destroy();
  }
});
