const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const childProcess = require('node:child_process');
const { chunksFor, cosine, digest } = require('../electron/embeddingMath.cjs');

test('chunks preserve all words, overlap, and source line locations', () => {
  const text = Array.from({ length: 500 }, (_, i) => `word${i}`).join('\n');
  const chunks = chunksFor(text);
  assert.equal(chunks.length, 4);
  assert.equal(chunks[1].line, 130);
  assert.equal(chunks[0].text.split(' ').length, 160);
  const recovered = new Set(chunks.flatMap((c) => c.text.split(' ')));
  assert.equal(recovered.size, 500);
  assert.deepEqual(chunksFor(''), []);
});

test('cosine scores and cache fingerprints are deterministic', () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([0, 0], [1, 1]), 0);
  assert.throws(() => cosine([1], [1, 2]));
  assert.equal(digest('note'), digest('note'));
  assert.notEqual(digest('note'), digest('changed'));
});

test('platform: Pandoc uses literal arguments and reports failed conversion', async (t) => {
  let call;
  let exitCode = 0;
  t.mock.method(childProcess, 'spawn', (executable, args, options) => {
    call = { executable, args, options };
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => { };
    child.stdin.on('finish', () => {
      if (exitCode) child.stderr.write('PDF engine is missing');
      setImmediate(() => child.emit('close', exitCode));
    });
    return child;
  });
  // Require after installing the spawn mock; no real Pandoc is needed.
  const { convert } = require('../electron/pandoc.cjs');
  const input = {
    executable: 'C:\\Program Files\\Pandoc\\pandoc.exe', html: '<h1>Card</h1>',
    format: 'docx', outputPath: 'C:\\exports\\test & title.docx', title: 'test & title'
  };
  assert.deepEqual(await convert(input), { warnings: '' });
  assert.equal(call.options.shell, false);
  assert.ok(call.args.includes('--sandbox'));
  assert.ok(call.args.includes(`--lua-filter=${require('node:path').join(__dirname, '..', 'electron', 'highlightRoundTrip.lua')}`));
  assert.ok(call.args.includes(input.outputPath));
  assert.ok(call.args.includes('title=test & title'));
  assert.equal(call.args[0], '--from=html');
  exitCode = 43;
  await assert.rejects(convert({ ...input, format: 'pdf' }), /PDF engine is missing/);
  await assert.rejects(convert({ ...input, format: 'exe' }), /Unsupported export format/);
});

test('platform: Pandoc rejects an explicitly configured missing executable', async () => {
  const { detectPandoc } = require('../electron/pandoc.cjs');
  await assert.rejects(detectPandoc('C:\\nonexistent-debate-test\\pandoc.exe'), /Cannot run Pandoc/);
});

test('RTF highlight export adds a yellow color entry and selects its index', () => {
  const { addRtfHighlightColor } = require('../electron/pandoc.cjs');
  const rtf = '{\\rtf1{\\colortbl;\\red255\\green0\\blue0;\\red0\\green0\\blue255;}A {\\highlight99 highlighted}.}';
  assert.equal(addRtfHighlightColor(rtf),
    '{\\rtf1{\\colortbl;\\red255\\green0\\blue0;\\red0\\green0\\blue255;\\red255\\green255\\blue0;}A {\\highlight3 highlighted}.}');
  assert.equal(addRtfHighlightColor('{\\rtf1 plain}'), '{\\rtf1 plain}');
});
