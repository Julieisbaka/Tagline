const { test } = require('node:test');
const assert = require('node:assert/strict');

test('detects real card headings and preserves original line positions and boundaries', async () => {
  const { detectCards } = await import('../src/lib/cardDetection.js');
  const text = [
    '---', 'description: |', '  #### Not a card', '---',
    '  #### First tag ###', '<!-- note', '#### Hidden', '-->',
    '__Smith 2024__ — "Study"', 'Evidence',
    '```md', '#### In code', '**False 2022**', '```',
    '    #### Indented code', '> #### Quote', '##### Subheading',
    '~~~', '#### Also code', '~~~', '#### Second', '**Jones**', '# End',
  ].join('\r\n');
  const cards = detectCards(text);
  assert.deepEqual(cards, [
    { title: 'First tag', lineIndex: 4, endLineIndex: 20 },
    { title: 'Second', lineIndex: 20, endLineIndex: 22 },
  ]);
});

test('fences, embedded comments, and ordinary bold evidence do not supply citations', async () => {
  const { scanCards } = await import('../src/lib/evidenceCheckup.js');
  const text = [
    '#### First', '<!-- **False 2024** -->', 'Evidence paragraph.',
    '**Emphasized words** are important.', '```', '**Fake 2020**', '```',
    '**Smith 2023** — Journal', '#### Second', 'Text', '**Bold evidence**', '#### Third',
    'No citation', '    **Indented 2024**',
  ].join('\n');
  const cards = scanCards({ 'notes.md': text });
  assert.deepEqual(cards.map((card) => card.citation?.author || null), ['Smith', null, null]);
});

test('checkup and card statistics share detection while comments target exact headings', async () => {
  const { scanCards, auditCards, annotateEvidence } = await import('../src/lib/evidenceCheckup.js');
  const { cardStats } = await import('../src/lib/card.js');
  const text = '---\nname: "#### fake"\n---\n```md\n#### fake\n```\n  #### Real ###\n__Smith 2024__\n';
  const files = { 'notes.md': text };
  const cards = scanCards(files);
  assert.equal(cardStats(text).cards, 1);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, 'Real');
  assert.equal(cards[0].citation.author, 'Smith');
  assert.equal(cards[0].citation.year, '2024');
  const issues = auditCards(cards, { checks: { stale: false } });
  const updated = annotateEvidence(files, cards, issues, ['citation'], () => 'Missing fields.');
  assert.match(updated['notes.md'], /  #### Real ###\n<!-- Evidence checkup \(citation\): Missing fields\. -->/);
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
    '#### First', '**Smith 2024**', '<pre>', '#### Fake', '**Fake 2020**', '</pre>',
    'New section', '---', '**Jones 2023**', '#### Second', '**Lee 2024**',
    '<script type="text/plain">', '#### Fake script', '</script>', '#### Third',
  ].join('\n');
  const cards = detectCards(text);
  assert.deepEqual(cards.map(({ title, lineIndex, endLineIndex }) =>
    [title, lineIndex, endLineIndex]), [
    ['First', 0, 6],
    ['Second', 9, 14],
    ['Third', 14, 15],
  ]);
});

test('bold evidence with ordinary numbers is not mistaken for a citation', async () => {
  const { scanCards } = await import('../src/lib/evidenceCheckup.js');
  const text = [
    '#### First', '**Important evidence** continues here.',
    '**Inflation rose 50 percent**', '**Smith 24** — Journal',
    '#### Second', '**Jones**', '#### Third', 'Text', '**More evidence** — not a citation',
  ].join('\n');
  assert.deepEqual(scanCards({ 'notes.md': text }).map((card) => card.citation?.author || null), [
    'Smith', 'Jones', null,
  ]);
});

test('parser ignores headings in lists, tables, blockquotes and HTML and retains CRLF locations', async () => {
  const { detectCards } = await import('../src/lib/cardDetection.js');
  const text = [
    '---', 'name: test', '---', '- item', '  #### nested', '', '| a | b |',
    '| - | - |', '| #### table | x |', '', '<div>', '#### html', '</div>', '',
    '> #### quote', '', '#### Real', '', 'Text', 'Setext section', '---', '#### Last',
  ].join('\r\n');
  assert.deepEqual(detectCards(text), [
    { title: 'Real', lineIndex: 16, endLineIndex: 18 },
    { title: 'Last', lineIndex: 21, endLineIndex: 22 },
  ]);
});
