const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const fsAsync = require('node:fs/promises');
const os = require('node:os');
const { promisify } = require('node:util');

test('platform: Pandoc import chooses an explicit reader, accepts DOCX changes, and surfaces errors', async (t) => {
  let captured;
  let fail = false;
  const original = childProcess.execFile;
  const mock = () => { throw new Error('Expected promisified execFile'); };
  mock[promisify.custom] = async (exe, args, options) => {
    captured = { exe, args, options };
    if (fail) throw new Error('Bad document');
    return { stdout: '# Imported\n\n**Card**', stderr: 'Conversion warning' };
  };
  childProcess.execFile = mock;
  t.after(() => { childProcess.execFile = original; });
  const { importDocument } = require('../electron/documents.cjs');
  const file = 'C:\\notes\\document & more.docx';
  assert.deepEqual(await importDocument('pandoc', file), {
    markdown: '# Imported\n\n**Card**',
    warnings: 'Conversion warning\nTracked changes were imported in their accepted (final-document) state.',
  });
  assert.ok(captured.args.includes('--from=docx'));
  assert.ok(captured.args.includes('--track-changes=accept'));
  assert.ok(captured.args.includes('--to=markdown+mark+raw_html-bracketed_spans'));
  assert.ok(captured.args.some((arg) => arg.endsWith('highlightRoundTrip.lua')));
  assert.ok(captured.args.includes('--sandbox'));
  assert.equal(captured.args.at(-1), file);
  assert.equal(captured.options.timeout, 120000);
  assert.equal((await importDocument('pandoc', file, { cleanup: true })).markdown, '# Imported\n\n**Card**\n');
  fail = true;
  await assert.rejects(importDocument('pandoc', file), /Bad document/);
  await assert.rejects(importDocument('pandoc', 'C:\\notes\\script.exe'), /Unsupported import format/);
});

test('imported Markdown removes common Word whitespace artifacts without rewriting structure', () => {
  const { cleanImportedMarkdown } = require('../electron/documents.cjs');
  assert.equal(cleanImportedMarkdown('\uFEFF# Title\r\n\r\nA\u00a0word\u00ad\r\n\r\n\r\nNext\u200b\r\n'),
    '# Title\n\nA word\n\nNext\n');
  assert.equal(cleanImportedMarkdown(''), '\n');
});

