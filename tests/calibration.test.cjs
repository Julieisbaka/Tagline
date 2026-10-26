const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

test('speech timing includes punctuation without mistaking decimal separators for pauses', async () => {
  const { speechStats, readingSeconds, spokenText } = await import('../src/lib/readTime.js');
  const plain = speechStats('cat dog fish cat dog fish');
  const paused = speechStats('cat, dog; fish.\n\ncat dog fish!');
  assert.equal(plain.syllables, paused.syllables);
  assert.ok(readingSeconds(paused) > readingSeconds(plain) + 0.5);
  assert.equal(speechStats('1.5').pauseUnits, 0);
  assert.equal(speechStats('1,234').pauseUnits, 0);
  assert.deepEqual(speechStats('cat<!-- hidden --><script>never read</script><style>nor this</style> dog'),
    speechStats('cat dog'));
  const sanitized = spokenText('before <scr<em>ipt>hidden</script> after');
  assert.equal(sanitized, 'before ipthidden after');
  assert.doesNotMatch(sanitized, /[<>]/);
});

test('a single timed sample calibrates exactly and no samples retain the default rate', async () => {
  const { speechStats, readingSeconds, calibrateReading } = await import('../src/lib/readTime.js');
  const stats = speechStats('Internationalization and constitutional complexity. Take a breath.');
  const sample = { id: 'one', name: 'One', scope: 'full', version: 1, stats, seconds: 73 };
  const profile = calibrateReading([sample]);
  assert.ok(Math.abs(readingSeconds(stats, 250, profile) - 73) < 1e-8);
  assert.equal(readingSeconds(stats, 100, profile), readingSeconds(stats, 800, profile));
  assert.equal(calibrateReading([]), null);
  assert.ok(readingSeconds(stats, 100) > readingSeconds(stats, 800));
});

test('multi-document robust calibration predicts held-out timing and limits an extreme outlier', async () => {
  const { speechStats, readingSeconds, calibrateReading } = await import('../src/lib/readTime.js');
  const texts = [
    'The cat is on the mat. '.repeat(10), 'International constitutional issues require consideration. '.repeat(8),
    'The GDP increased 1.5%, while AI systems changed. '.repeat(9),
    'Stop. Wait; pause, then continue.\n\n'.repeat(12),
  ];
  const samples = texts.map((text, i) => {
    const stats = speechStats(text);
    return { id: String(i), name: String(i), scope: 'full', version: 1, stats, seconds: readingSeconds(stats) * 1.8 };
  });
  const heldOut = speechStats('Economic growth and international security; the relationship matters. '.repeat(10));
  const expected = readingSeconds(heldOut) * 1.8;
  const fitted = calibrateReading(samples);
  assert.ok(Math.abs(readingSeconds(heldOut, 250, fitted) / expected - 1) < 0.01);
  const outlier = { ...samples[0], id: 'outlier', seconds: samples[0].seconds * 100 };
  const robust = calibrateReading([...samples, outlier]);
  assert.ok(Math.abs(readingSeconds(heldOut, 250, robust) / expected - 1) < 0.1,
    'One grossly mistimed sample should not dominate the profile');
});

test('readability remains standard while personal effort adapts to sample complexity', async () => {
  const { speechStats, readingSeconds, readingAssessment, calibrateReading } = await import('../src/lib/readTime.js');
  const simple = speechStats('Cat dog fish.');
  const complex = speechStats('Internationalization constitutional complexity.');
  const profileFor = (stats) => calibrateReading([
    { id: 'sample', name: 'Sample', scope: 'full', version: 1, stats, seconds: readingSeconds(stats) * 2 },
  ]);
  const easyBaseline = profileFor(simple);
  const hardBaseline = profileFor(complex);
  const assessment = readingAssessment(simple, 250, easyBaseline);
  assert.ok(Math.abs(assessment.readingEase - 119.19) < 0.001);
  assert.ok(Math.abs(assessment.effort - 100) < 0.001);
  assert.equal(assessment.readingEase, readingAssessment(simple, 250, hardBaseline).readingEase);
  assert.ok(readingAssessment(complex, 250, easyBaseline).effort > readingAssessment(complex, 250, hardBaseline).effort);
  assert.equal(readingAssessment(speechStats('')).readingEase, null);
});

test('calibration rejects invalid samples, empty spoken evidence and duplicate identities', async () => {
  const { speechStats, calibrateReading } = await import('../src/lib/readTime.js');
  const { spokenEvidence, cardStats } = await import('../src/lib/card.js');
  const content = '#### Tag\n**Smith 2024** — not spoken publication\n==Read this.==\nNever read this.';
  assert.deepEqual(speechStats(spokenEvidence(content)).weightedSyllables, cardStats(content).weightedSyllables);
  assert.ok(!spokenEvidence(content).includes('Never read'));
  const sample = { id: 'one', name: 'One', scope: 'evidence', version: 1, seconds: 5, stats: speechStats('Words here.') };
  for (const patch of [{ seconds: 0 }, { seconds: NaN }, { seconds: 86401 }, { scope: 'unknown' },
  { stats: speechStats('') }, { version: 2 }, { stats: { ...sample.stats, pauseUnits: Infinity } }]) {
    assert.throws(() => calibrateReading([{ ...sample, ...patch }]));
  }
  assert.throws(() => calibrateReading([sample, sample]), /unique/);
  assert.throws(() => calibrateReading(Array(101).fill(sample)), /100/);
});

test('theme and extension limits validate ceilings and apply to manifest and theme validation', async () => {
  const { DEFAULT_LIMITS, validateLimits, setRuntimeLimits } = await import('../electron/customization.mjs');
  const { validateTheme } = await import('../src/lib/themes.js');
  const { validateManifest } = require('../electron/extensions.cjs');
  assert.deepEqual(validateLimits(), DEFAULT_LIMITS);
  assert.equal(DEFAULT_LIMITS.themeVariables, 512);
  const variables = Object.fromEntries(Array.from({ length: 512 }, (_, index) => [`override-${index}`, '1px']));
  const expandedTheme = { version: 1, name: 'Expanded', mode: 'dark', colors: {}, variables };
  assert.equal(Object.keys(validateTheme(expandedTheme).variables).length, 512);
  assert.throws(() => validateTheme({ ...expandedTheme, variables: { ...variables, overflow: '1px' } }), /at most 512/);
  for (const value of [null, [], { unknown: 1 }, { extensionWatches: 0 }, { extensionWatches: 257 },
    { themeFileBytes: 1.2 }, { extensionStartupMs: Infinity }]) assert.throws(() => validateLimits(value));
  const limits = validateLimits({ themeVariables: 1, extensionCommands: 1, extensionSettings: 1 });
  const theme = { version: 1, name: 'Theme', mode: 'dark', colors: {}, variables: { one: '1px', two: '2px' } };
  assert.throws(() => validateTheme(theme, limits), /at most 1/);
  assert.throws(() => validateTheme({ ...theme, variables: { one: 'url(https://example.com)' } }, limits), /Invalid theme variable/);
  const manifest = {
    manifestVersion: 1, id: 'limited', name: 'Limited', version: '1', main: 'main.js',
    contributes: { commands: [{ id: 'one', title: 'One' }, { id: 'two', title: 'Two' }] }
  };
  assert.throws(() => validateManifest(manifest, os.tmpdir(), limits), /at most 1/);
  assert.equal(validateManifest(manifest, os.tmpdir()).contributes.commands.length, 2);
  setRuntimeLimits(DEFAULT_LIMITS);
});

test('platform: main process persists limit changes, enforces script size and exports validated settings', async (t) => {
  const { registerExtensions } = require('../electron/extensions.cjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-limits-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const folder = path.join(root, 'extensions', 'limited');
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, 'manifest.json'), JSON.stringify({
    manifestVersion: 1, id: 'limited', name: 'Limited', version: '1', main: 'main.js', permissions: ['settings'],
    contributes: { settings: [{ id: 'label', title: 'Label', type: 'string', default: 'hello' }] },
  }));
  await fs.writeFile(path.join(folder, 'main.js'), '//'.repeat(600));
  const handlers = {};
  const exported = path.join(root, 'settings.json');
  let config = { enabledExtensions: ['limited'] };
  registerExtensions({
    app: { getPath: () => root }, ipcMain: { handle: (name, handler) => { handlers[name] = handler; } },
    shell: {}, readConfig: () => config, writeConfig: (patch) => { config = { ...config, ...patch }; },
    dialog: { showSaveDialog: async () => ({ canceled: false, filePath: exported }) }, getWindow: () => null,
  });
  const [item] = await handlers['extensions:list']();
  await handlers['extensions:setEnabled'](null, 'limited', true, item.reviewToken);
  assert.equal((await handlers['extensions:load'](null, 'limited')).source.length, 1200);
  handlers['customization:set'](null, { extensionSourceBytes: 1024 });
  await assert.rejects(handlers['extensions:load'](null, 'limited'), /exceeds 1024 bytes/);
  assert.equal(handlers['customization:get']().extensionSourceBytes, 1024);
  assert.equal(config.customizationLimits.extensionSourceBytes, 1024);
  assert.throws(() => handlers['customization:set'](null, { extensionMessagesPerSecond: 100000 }));
  await assert.rejects(handlers['extensions:exportSettings'](null, 'limited', { label: 3 }), /Invalid value/);
  await handlers['extensions:exportSettings'](null, 'limited', { label: 'exported' });
  assert.deepEqual(JSON.parse(await fs.readFile(exported, 'utf8')), {
    version: 1, extensionId: 'limited', values: { label: 'exported' },
  });
});

test('configured watch and storage limits are enforced by the extension host', async (t) => {
  const { ExtensionHost } = await import('../src/lib/extensions.js');
  const original = global.localStorage;
  const storage = new Map();
  global.localStorage = { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  t.after(() => { global.localStorage = original; });
  const host = new ExtensionHost({ id: 'limits', permissions: ['editor:active-note'], contributes: {} }, '',
    { watchActiveNote: () => () => { } }, { extensionWatches: 1, extensionStorageCharacters: 1000 });
  await host.handle('editor.watchActiveNote', []);
  await assert.rejects(host.handle('editor.watchActiveNote', []), /1 active-note/);
  await assert.rejects(host.handle('storage.set', ['value', 'x'.repeat(1001)]), /configured limit/);
  assert.equal(storage.size, 0);
});

test('platform: reading imports support multiple plain documents without requiring Pandoc', async (t) => {
  const { registerDocuments } = require('../electron/documents.cjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-reading-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const files = [path.join(root, 'one.md'), path.join(root, 'two.txt')];
  await Promise.all(files.map((file) => fs.writeFile(file, 'Full document.')));
  const handlers = {};
  registerDocuments({
    ipcMain: { handle: (key, handler) => { handlers[key] = handler; } }, getWindow: () => null,
    readConfig: () => ({}), dialog: {
      showOpenDialog: async (_window, options) => {
        assert.ok(options.properties.includes('multiSelections'));
        return { canceled: false, filePaths: files };
      }
    },
  });
  const result = await handlers['documents:readingSamples']();
  assert.equal(result.documents.length, 2);
  assert.ok(result.documents.every((document) => document.markdown === 'Full document.'));
  await fs.writeFile(files[0], Buffer.alloc(5 * 1024 * 1024 + 1));
  await assert.rejects(handlers['documents:readingSamples'](), /5 MB per document/);
});

test('absolute timer deadlines preserve sub-tick time and account for suspended clocks', async () => {
  const { remainingAt } = await import('../src/lib/countdown.js');
  const start = 1_000_000;
  const deadline = start + 60_000;
  assert.equal(remainingAt(deadline, start + 150), 59.85);
  assert.equal(remainingAt(deadline, start + 55_000), 5);
  assert.equal(remainingAt(deadline, start + 3_600_000), 0);
});
