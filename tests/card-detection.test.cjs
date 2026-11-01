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
    { title: 'First tag', lineIndex: 4, endLineIndex: 20, citationLine: '__Smith 2024__ — "Study"' },
    { title: 'Second', lineIndex: 20, endLineIndex: 22, citationLine: '**Jones**' },
  ]);
});

test('fences, embedded comments, and ordinary bold evidence do not supply citations', async () => {
  const { detectCards } = await import('../src/lib/cardDetection.js');
  const text = [
    '#### First', '<!-- **False 2024** -->', 'Evidence paragraph.',
    '**Emphasized words** are important.', '```', '**Fake 2020**', '```',
    '**Smith 2023** — Journal', '#### Second', 'Text', '**Bold evidence**', '#### Third',
    'No citation', '    **Indented 2024**',
  ].join('\n');
  const cards = detectCards(text);
  assert.deepEqual(cards.map((card) => card.citationLine), ['**Smith 2023** — Journal', null, null]);
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
