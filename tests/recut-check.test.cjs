const { test } = require('node:test');
const assert = require('node:assert/strict');

test('recut analysis reads joined highlights, not the citation, unhighlighted text, or code', async () => {
  const { highlightedReading, checkRecut } = await import('../src/lib/recutCheck.js');
  const body =
    '**Smith 2024** — Citation\n\n' +
    '==The **plan**== ignores this ==reduces emissions.==\n\n' +
    '```\n==Not real evidence==\n```\n\n' +
    '`==Also not evidence==` <mark>It <strong>protects</strong> communities.</mark>';
  assert.equal(highlightedReading(body), 'The plan reduces emissions. It protects communities.');
  assert.deepEqual(checkRecut(body), []);
});

test('recut analysis accepts readable fragments and flags disruptive wording', async () => {
  const { checkRecut } = await import('../src/lib/recutCheck.js');
  assert.deepEqual(checkRecut('==The impact of climate change.=='), []);
  assert.deepEqual(checkRecut('==Reduces nuclear risk.=='), []);
  assert.deepEqual(checkRecut('==Because emissions are rising.=='), []);
  assert.equal(checkRecut('==The plan will reduce emissions and==')[0].reason, 'ending');
  assert.equal(checkRecut('==They is effective.==')[0].reason, 'agreement');
  assert.equal(checkRecut('==The plan is== ignored ==is effective.==')[0].reason, 'repetition');
  assert.deepEqual(checkRecut('==What it is, is important.=='), []);
  assert.deepEqual(checkRecut('No highlight.'), []);
  assert.deepEqual(checkRecut('==Because emissions are rising, the plan is necessary.=='), []);
  assert.deepEqual(checkRecut('==The United States would undermine deterrence.=='), []);
  assert.deepEqual(checkRecut('==There is a risk of nuclear war.=='), []);
  assert.deepEqual(checkRecut('==Does the policy prevent war?=='), []);
});

test('recut highlights survive bold formatting and separate HTML marks', async () => {
  const { highlightedReading } = await import('../src/lib/recutCheck.js');
  assert.equal(highlightedReading('**==The plan works.==**'), 'The plan works.');
  assert.equal(
    highlightedReading('<mark>The plan</mark> unspoken <mark>works.</mark>'),
    'The plan works.'
  );
  assert.equal(highlightedReading('\\==not a highlight\\=='), '');
  assert.equal(
    highlightedReading('==The plan\nreduces emissions.=='),
    'The plan reduces emissions.'
  );
  assert.equal(
    highlightedReading('> ==The plan reduces emissions.==\n\n- ==It protects communities.=='),
    'The plan reduces emissions. It protects communities.'
  );
});

test('recut analysis reviews each entire card reading rather than isolated sentences or highlights', async () => {
  const { checkRecut } = await import('../src/lib/recutCheck.js');
  const { scanCards, recutIssues } = await import('../src/lib/evidenceCheckup.js');
  const connected = '==The evidence shows that.== Skipped ==the plan reduces emissions.==';
  assert.deepEqual(checkRecut(connected), []);
  const findings = checkRecut('==They is effective.== Skipped ==The plan is is affordable.==');
  assert.deepEqual(
    findings.map(({ reason }) => reason),
    ['agreement', 'repetition']
  );
  assert.ok(findings.every(({ excerpt }) => excerpt.includes('They is effective.')));
  const files = {
    'a.md': `#### One\n${connected}\n#### Two\n==They is effective.==\n`,
  };
  const issues = await recutIssues(files, scanCards(files));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].card, 'Two');
  const explicit = {
    'b.md': `<!-- card:start -->\n${connected}\n<!-- card:end -->\n<!-- card:start -->\n==They is effective.==\n<!-- card:end -->`,
  };
  const explicitIssues = await recutIssues(explicit, scanCards(explicit));
  assert.equal(explicitIssues.length, 1);
  assert.equal(explicitIssues[0].excerpt, 'They is effective.');
});

test('very long readings are reported as unchecked instead of clean', async () => {
  const { scanCards, recutIssues } = await import('../src/lib/evidenceCheckup.js');
  const { checkRecut } = await import('../src/lib/recutCheck.js');
  assert.deepEqual(checkRecut(`==${'word '.repeat(4001).trimEnd()}==`), [
    { reason: 'too_long', excerpt: '' },
  ]);
  const files = { 'a.md': `#### Long\n==${'word '.repeat(21000)}==` };
  const issues = await recutIssues(files, scanCards(files));
  assert.equal(issues[0].kind, 'recut_unchecked');
  assert.equal(issues[0].reason, 'too_long');
});

test('recut findings target the correct cards and refresh separately from citation comments', async () => {
  const { scanCards, recutIssues, annotateEvidence } =
    await import('../src/lib/evidenceCheckup.js');
  const files = {
    'a.md':
      '#### One\r\n**Smith 2024**\r\n==They is effective.==\r\n#### Two\r\n==The impact of climate change.==\r\n',
  };
  const cards = scanCards(files);
  const issues = await recutIssues(files, cards);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].card, 'One');
  assert.equal(issues[0].reason, 'agreement');
  assert.equal(issues[0].excerpt, 'They is effective.');
  const annotated = annotateEvidence(files, cards, issues, ['recut'], () => 'Review wording.');
  assert.match(annotated['a.md'], /Evidence checkup \(recut\): Review wording\./);
  const rescanned = scanCards(annotated);
  assert.deepEqual(
    annotateEvidence(
      annotated,
      rescanned,
      await recutIssues(annotated, rescanned),
      ['recut'],
      () => 'Review wording.'
    ),
    annotated
  );
  assert.doesNotMatch(
    annotateEvidence(annotated, rescanned, [], ['recut'], () => '')['a.md'],
    /Evidence checkup \(recut\)/
  );
});
