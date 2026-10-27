const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const fsAsync = require('node:fs/promises');
const os = require('node:os');
const { promisify } = require('node:util');

test('extension capabilities validate selection, command, helper, event and UI contracts', async () => {
  const { ExtensionHost } = await import('../src/lib/extensions.js');
  const { applicationEvents, createEventBus, extensionHelper, pathHelper, markdownToText, requirePayload } =
    await import('../src/lib/extensionCapabilities.js');
  const cardMarkdown = '#### Climate impact\n\n**Smith 2024**\n\n==The impact is significant.==';
  assert.equal(extensionHelper('helpers.markdown.slugify', ['Climate Impact']), 'climate-impact');
  assert.equal(extensionHelper('helpers.countdown.remainingAt', [20_000, 10_000]), 10);
  assert.equal(extensionHelper('helpers.language.system', [['fr-CA', 'en']]), 'fr');
  assert.equal(extensionHelper('helpers.language.initial', ['invalid', ['es-MX']]), 'es');
  assert.equal(extensionHelper('helpers.keybindings.valid', ['Mod+Shift+K']), true);
  assert.equal(extensionHelper('helpers.keybindings.valid', ['not-a-shortcut']), false);
  assert.equal(extensionHelper('helpers.keybindings.display', ['Mod+K', 'darwin']), 'Cmd+K');
  assert.deepEqual(extensionHelper('helpers.layout.normalizeRibbon', [['search'], [], []]), ['search']);
  assert.deepEqual(extensionHelper('helpers.layout.moveRibbon', [['search', 'graph'], 'graph', 'search']), ['graph', 'search']);
  assert.deepEqual(extensionHelper('helpers.layout.normalizeWorkspace', [['cards'], [{ id: 'cards' }, { id: 'words' }]]), ['cards']);
  assert.deepEqual(extensionHelper('helpers.layout.moveWorkspace', [['cards', 'words'], 'words', 'cards']), ['words', 'cards']);
  assert.deepEqual(extensionHelper('helpers.vault.extractLinks', ['[[Evidence]]']), ['Evidence']);
  assert.deepEqual(extensionHelper('helpers.vault.extractTags', ['#aff #impact']), ['aff', 'impact']);
  assert.equal(extensionHelper('helpers.vault.resolveLink', ['Evidence', ['Evidence.md']]), 'Evidence.md');
  assert.deepEqual(extensionHelper('helpers.vault.outline', ['# Evidence']), [{ level: 1, text: 'Evidence', line: 0 }]);
  assert.throws(() => extensionHelper('helpers.flowCells.copy', [[['cell']], { top: 0, bottom: 100_000, left: 0, right: 0 }]), /bounds/);
  assert.throws(() => extensionHelper('helpers.layout.normalizeRibbon', [[], new Array(1001).fill({ id: 'ext:a.b' }), []]), /1,000/);
  assert.equal(await new ExtensionHost({ permissions: [] }, '', {}).handle('helpers.language.system', [['es-MX']]), 'es');
  await assert.rejects(new ExtensionHost({ permissions: [] }, '', {}).handle('helpers.markdownToText', ['text']),
    /Unknown/);
  assert.deepEqual(extensionHelper('helpers.markdown.outline', [`# Case\n${cardMarkdown}`]), [
    { level: 1, text: 'Case', line: 0 },
    { level: 4, text: 'Climate impact', line: 1 },
  ]);
  assert.deepEqual(extensionHelper('helpers.markdown.extractLinks', ['[[Evidence]]']), ['Evidence']);
  assert.deepEqual(extensionHelper('helpers.markdown.extractTags', ['#aff #impact']), ['aff', 'impact']);
  const metadata = '---\nspeech: true\n---\n# Speech';
  assert.deepEqual(await new ExtensionHost({ permissions: [] }, '', {}).handle('helpers.markdown.frontmatter', [metadata]),
    { data: { speech: true }, body: '# Speech', prefix: '---\nspeech: true\n---\n' });
  assert.equal(markdownToText(metadata), 'Speech');
  assert.throws(() => extensionHelper('helpers.markdown.frontmatter', ['---\nbroken: [\n---']), /Invalid YAML/);
  assert.equal(extensionHelper('helpers.markdown.resolveLink', ['Evidence', ['Evidence.md']]), 'Evidence.md');
  assert.equal(extensionHelper('helpers.cards.getAt', [cardMarkdown, 24]).title, 'Climate impact');
  assert.equal(extensionHelper('helpers.cards.spokenEvidence', [cardMarkdown]), 'The impact is significant.\nSmith 2024');
  assert.equal(extensionHelper('helpers.cards.stats', [cardMarkdown]).cards, 1);
  assert.equal(extensionHelper('helpers.cards.formatDuration', [90]), '1:30');
  assert.equal(extensionHelper('helpers.citations.create', [{ author: 'Smith', year: '2024', title: 'A claim' }]),
    '**Smith 2024** — "A claim"');
  assert.equal(extensionHelper('helpers.search.fuzzyScore', ['deb', 'debate']), 999.4);
  assert.equal(extensionHelper('helpers.templates.fill', ['{{title}}', 'Case']), 'Case');
  assert.equal(extensionHelper('helpers.templates.fill', ['{{path}}\n{{properties}}\n{{content}}', 'Case',
    { path: 'Cards/Case.md', content: '---\nspeech: true\n---\n# Case' }]),
    'Cards/Case.md\nspeech: true\n\n# Case');
  for (const context of [null, [], 'bad', { path: 42 }, { content: false }]) {
    assert.throws(() => extensionHelper('helpers.templates.fill', ['', 'Case', context]), /Template context|Path|Content/);
  }
  assert.ok(extensionHelper('helpers.speech.analyze', ['A short speech.']).spokenWords > 0);
  assert.ok(extensionHelper('helpers.speech.estimate', ['A short speech.', 250]).seconds > 0);
  assert.throws(() => extensionHelper('helpers.speech.readingSeconds',
    [{ weightedSyllables: 10 }, 250, { articulation: NaN, pauses: 1 }]), /profile/);
  assert.throws(() => extensionHelper('helpers.speech.assess',
    [{ syllables: 1, weightedSyllables: 1, spokenWords: 1, sentences: 1 }, 0]), /Speaking rate/);
  assert.throws(() => extensionHelper('helpers.cards.getAt', [cardMarkdown, -1]), /Offset/);
  assert.throws(() => extensionHelper('helpers.speech.estimate', ['words', 0]), /Speaking rate/);
  const calls = [];
  const sent = [];
  const manifest = {
    id: 'capabilities', name: 'Capabilities',
    permissions: ['editor', 'events', 'ui', 'vault:read', 'editor:active-note'],
    contributes: { commands: [], panels: [{ id: 'status', title: 'Status' }], webviews: [] }
  };
  const host = new ExtensionHost(manifest, '', {
    setSelection: (range) => { calls.push(range); return true; },
    getTiptapSnapshot: () => ({ doc: { type: 'doc' }, selection: { from: 1, to: 1 } }),
    runTiptapCommand: (...args) => { calls.push(args); return true; },
    updateSurface: (...args) => calls.push(args.slice(1)),
  });
  host.frame = { contentWindow: { postMessage: (message) => sent.push(message) } };
  assert.equal(await host.handle('editor.setSelection', [{ from: 0, to: 3 }]), true);
  for (const range of [{ from: -1, to: 2 }, { from: 3, to: 2 }, { from: 1.5, to: 2 }, null]) {
    await assert.rejects(host.handle('editor.setSelection', [range]), /Selection/);
  }
  assert.equal((await host.handle('editor.getTiptapSnapshot', [])).doc.type, 'doc');
  await host.handle('editor.runTiptapCommand', ['toggleHeading', { level: 4 }]);
  await assert.rejects(host.handle('editor.runTiptapCommand', ['setContent']), /Unsupported/);
  await assert.rejects(host.handle('editor.runTiptapCommand', ['toggleHeading', { level: 9 }]), /Heading/);
  await assert.rejects(host.handle('editor.runTiptapCommand', ['toggleBold', { arbitrary: true }]), /options/);
  const watch = await host.handle('events.subscribe', ['ext.capabilities.ready']);
  await host.handle('events.emit', ['ext.capabilities.ready', { count: 1 }]);
  assert.deepEqual(sent.at(-1).event, { count: 1 });
  await host.handle('events.unsubscribe', [watch]);
  const count = sent.length;
  applicationEvents.emit('ext.capabilities.ready', {});
  assert.equal(sent.length, count);
  await assert.rejects(host.handle('events.emit', ['editor.ready', {}]), /namespaced/);
  await assert.rejects(host.handle('events.emit', ['ext.other.ready', {}]), /namespaced/);
  await assert.rejects(host.handle('events.subscribe', ['unknown.event']), /Unknown/);
  await host.handle('ui.setHtml', ['panels', 'status', '<p>Hello</p>']);
  await host.handle('ui.show', ['panels', 'status']);
  await assert.rejects(host.handle('ui.show', ['webviews', 'undeclared']), /Undeclared/);
  manifest.permissions = [];
  for (const [method, args] of [['editor.setSelection', [{ from: 0, to: 0 }]],
  ['editor.getTiptapSnapshot', []], ['events.subscribe', ['editor.ready']], ['ui.show', ['panels', 'status']]]) {
    await assert.rejects(host.handle(method, args), /Permission/);
  }
  manifest.permissions = ['events'];
  await assert.rejects(host.handle('events.subscribe', ['editor.ready']), /Permission "editor"/);
  assert.equal(pathHelper('join', ['Folder', '..', 'Note.md']), 'Note.md');
  assert.equal(pathHelper('basename', ['Folder\\Note.md']), 'Note.md');
  assert.equal(pathHelper('extname', ['.hidden']), '');
  assert.throws(() => pathHelper('normalize', ['../../secret']), /escapes/);
  assert.throws(() => pathHelper('normalize', ['C:\\secret']), /relative/);
  assert.equal(markdownToText('# Heading\n\n**Evidence** [source](https://example.com)'), 'Heading\nEvidence source');
  assert.throws(() => requirePayload('x'.repeat(65537)), /65,536/);
  const bus = createEventBus();
  const payload = { nested: { value: 1 } };
  const stop = bus.on('test', (value) => { value.nested.value = 2; });
  bus.emit('test', payload);
  assert.equal(payload.nested.value, 1);
  stop();
  await host.handle('events.subscribe', ['ext.capabilities.disposal']);
  const originalWindow = global.window;
  global.window = { removeEventListener() { } };
  host.frame.remove = () => { };
  try { host.dispose(); }
  finally { global.window = originalWindow; }
  assert.equal(host.eventWatches.size, 0);
  assert.equal(host.surfaces.size, 0);
  applicationEvents.emit('ext.capabilities.disposal', {});
  assert.equal(sent.length, count);
});

test('UI contributions require permission, declarations, a script and bounded unique identifiers', () => {
  const { validateManifest } = require('../electron/extensions.cjs');
  const manifest = {
    manifestVersion: 1, id: 'ui-test', name: 'UI Test', version: '1',
    main: 'main.js', permissions: ['ui'], contributes: {
      panels: [{ id: 'panel', title: 'Panel' }],
      webviews: [{ id: 'details', title: 'Details' }]
    }
  };
  const root = path.join(__dirname, 'fixture');
  assert.equal(validateManifest(manifest, root).contributes.panels[0].id, 'panel');
  assert.throws(() => validateManifest({ ...manifest, permissions: [] }, root), /ui permission/);
  assert.throws(() => validateManifest({ ...manifest, main: undefined }, root), /main script/);
  assert.throws(() => validateManifest({ ...manifest, contributes: { panels: [{ title: 'Missing ID' }] } }, root), /unique id/);
  assert.throws(() => validateManifest({ ...manifest, contributes: { panels: Array(11).fill({ id: 'panel', title: 'Panel' }) } }, root), /at most 10/);
});

test('extension settings have validated types, bounds, defaults and scoped storage', async (t) => {
  const { validateSettingDefinitions, validateSettingValue } = await import('../electron/extensionSettings.mjs');
  const { ExtensionHost } = await import('../src/lib/extensions.js');
  const { resetExtensionSettings } = await import('../src/lib/extensionSettings.js');
  const settings = [
    { id: 'enabled', title: 'Enabled', type: 'boolean', default: true },
    { id: 'limit', title: 'Limit', type: 'number', min: 1, max: 5, default: 3 },
    { id: 'label', title: 'Label', type: 'string', maxLength: 10, default: 'note' },
    { id: 'mode', title: 'Mode', type: 'string', enum: ['brief', 'full'], default: 'brief' },
  ];
  assert.deepEqual(validateSettingDefinitions(settings), settings);
  for (const invalid of [null, [settings[0], settings[0]], [{ ...settings[0], id: undefined }],
    [{ ...settings[0], default: 'true' }], [{ ...settings[1], min: 6 }],
    [{ ...settings[2], maxLength: 0 }], [{ ...settings[3], enum: ['brief', 'brief'] }],
    [{ ...settings[0], max: 5 }], Array(33).fill(settings[0])]) {
    assert.throws(() => validateSettingDefinitions(invalid));
  }
  for (const [index, value] of [[0, 1], [1, NaN], [1, 6], [2, 'x'.repeat(11)], [3, 'other']]) {
    assert.throws(() => validateSettingValue(settings[index], value), /Invalid value/);
  }
  const original = { localStorage: global.localStorage, window: global.window };
  const storage = new Map();
  global.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key)
  };
  global.window = { dispatchEvent() { } };
  t.after(() => { global.localStorage = original.localStorage; global.window = original.window; });
  const manifest = { id: 'typed', permissions: [], contributes: { settings } };
  const host = new ExtensionHost(manifest, '', {});
  await assert.rejects(host.handle('settings.get', ['enabled']), /Permission/);
  await assert.rejects(host.handle('settings.set', ['enabled', false]), /Permission/);
  manifest.permissions.push('settings');
  assert.equal(await host.handle('settings.get', ['enabled']), true);
  await host.handle('settings.set', ['enabled', false]);
  assert.equal(await host.handle('settings.get', ['enabled']), false);
  await assert.rejects(host.handle('settings.set', ['limit', '4']), /Invalid value/);
  await assert.rejects(host.handle('settings.get', ['theme']), /not declared/);
  const other = new ExtensionHost({ ...manifest, id: 'other' }, '', {});
  assert.equal(await other.handle('settings.get', ['enabled']), true);
  storage.set('tagline-extension-settings:typed', '{invalid');
  assert.equal(await host.handle('settings.get', ['enabled']), true, 'malformed settings reset to defaults');
  assert.equal(storage.has('tagline-extension-settings:typed'), false, 'only the corrupt entry is removed');
  resetExtensionSettings(manifest);
  assert.equal(await host.handle('settings.get', ['enabled']), true);
});

test('active-note events are path-only, separately permissioned, bounded and disposable', async (t) => {
  const { ExtensionHost } = await import('../src/lib/extensions.js');
  const manifest = { id: 'events', permissions: ['editor'], contributes: { commands: [] } };
  const callbacks = new Set();
  const bridge = {
    watchActiveNote: (listener) => {
      callbacks.add(listener); return () => callbacks.delete(listener);
    }
  };
  const host = new ExtensionHost(manifest, '', bridge);
  const messages = [];
  host.frame = { contentWindow: { postMessage: (message) => messages.push(message) }, remove() { } };
  await assert.rejects(host.handle('editor.watchActiveNote', []), /editor:active-note/);
  manifest.permissions = ['editor:active-note'];
  await assert.rejects(host.handle('editor.getActiveNote', []), /Permission "editor"/);
  const id = await host.handle('editor.watchActiveNote', []);
  callbacks.forEach((callback) => callback({ path: 'Card.md', content: 'not exposed', selection: 'private' }));
  callbacks.forEach((callback) => callback({ path: null }));
  assert.deepEqual(messages, [
    { type: 'active-note-event', id, event: { path: 'Card.md' } },
    { type: 'active-note-event', id, event: { path: null } },
  ]);
  assert.equal(await host.handle('editor.unwatchActiveNote', [id]), true);
  assert.equal(callbacks.size, 0);
  for (let i = 0; i < 32; i++) await host.handle('editor.watchActiveNote', []);
  await assert.rejects(host.handle('editor.watchActiveNote', []), /32 active-note/);
  const original = global.window;
  global.window = { removeEventListener() { } };
  t.after(() => { global.window = original; });
  host.dispose();
  assert.equal(callbacks.size, 0);
});

test('platform: settings and event permission changes require a fresh manifest review', async () => {
  const fsAsync = require('node:fs/promises');
  const { registerExtensions, validateManifest } = require('../electron/extensions.cjs');
  const root = await fsAsync.mkdtemp(path.join(require('node:os').tmpdir(), 'tagline-review-'));
  try {
    const folder = path.join(root, 'extensions', 'review');
    await fsAsync.mkdir(folder, { recursive: true });
    const manifest = {
      manifestVersion: 1, id: 'review', name: 'Review', version: '1',
      main: 'main.js', permissions: ['settings', 'editor:active-note'],
      contributes: { settings: [{ id: 'label', title: 'Label', type: 'string', default: 'x' }] }
    };
    assert.throws(() => validateManifest({ ...manifest, permissions: [] }, folder), /requires the settings permission/);
    const file = path.join(folder, 'manifest.json');
    await fsAsync.writeFile(file, JSON.stringify(manifest));
    await fsAsync.writeFile(path.join(folder, 'main.js'), 'void 0;');
    let config = { enabledExtensions: ['review'] };
    const handlers = {};
    registerExtensions({
      app: { getPath: () => root }, shell: {},
      ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
      readConfig: () => config, writeConfig: (patch) => { config = { ...config, ...patch }; },
    });
    const [item] = await handlers['extensions:list']();
    assert.equal(item.enabled, false);
    assert.equal(item.reviewRequired, true);
    await assert.rejects(handlers['extensions:load'](null, 'review'), /disabled/);
    await assert.rejects(handlers['extensions:setEnabled'](null, 'review', true), /Reload and review/);
    await handlers['extensions:setEnabled'](null, 'review', true, item.reviewToken);
    assert.equal((await handlers['extensions:list']())[0].enabled, true);
    const firstLoad = await handlers['extensions:load'](null, 'review');
    assert.equal(firstLoad.firstInstall, true);
    const retry = await handlers['extensions:load'](null, 'review');
    assert.notEqual(retry.installToken, firstLoad.installToken);
    await assert.rejects(handlers['extensions:completeInstall'](null, 'review', firstLoad.installToken), /Stale/);
    await handlers['extensions:setEnabled'](null, 'review', false);
    await assert.rejects(handlers['extensions:completeInstall'](null, 'review', retry.installToken), /Stale/);
    await handlers['extensions:setEnabled'](null, 'review', true, item.reviewToken);
    const activeLoad = await handlers['extensions:load'](null, 'review');
    assert.equal(activeLoad.firstInstall, true, 'incomplete setup retries');
    await handlers['extensions:completeInstall'](null, 'review', activeLoad.installToken);
    assert.deepEqual(config.initializedExtensions, ['review']);
    await assert.rejects(handlers['extensions:completeInstall'](null, 'review', activeLoad.installToken), /Stale/);
    assert.equal((await handlers['extensions:load'](null, 'review')).firstInstall, false);
    manifest.contributes.settings[0].default = 'changed';
    await fsAsync.writeFile(file, JSON.stringify(manifest));
    assert.equal((await handlers['extensions:list']())[0].reviewRequired, true);
    await assert.rejects(handlers['extensions:setEnabled'](null, 'review', true, item.reviewToken), /Reload and review/);
    const [changed] = await handlers['extensions:list']();
    await handlers['extensions:setEnabled'](null, 'review', true, changed.reviewToken);
    assert.equal((await handlers['extensions:load'](null, 'review')).source, 'void 0;');
    assert.equal((await handlers['extensions:load'](null, 'review')).installToken, null, 'manifest updates do not repeat successful setup');
    manifest.permissions.push('vault:write');
    await fsAsync.writeFile(file, JSON.stringify(manifest));
    assert.equal((await handlers['extensions:list']())[0].enabled, false);
  } finally { await fsAsync.rm(root, { recursive: true, force: true }); }
});

test('extension vault mutation and watch APIs enforce permissions and clean up subscriptions', async () => {
  const { ExtensionHost } = await import('../src/lib/extensions.js');
  const manifest = { id: 'test', name: 'Test', permissions: [], contributes: { commands: [] } };
  let subscriptions = 0;
  const bridge = {
    append: async () => 'Card.md', delete: async () => true, rename: async () => 'Renamed.md',
    flush: async () => true, compareAndSwap: async () => false,
    watch: () => { subscriptions++; return () => { subscriptions--; }; },
  };
  const host = new ExtensionHost(manifest, '', bridge);
  const calls = [
    ['vault.append', ['Card.md', 'text']], ['vault.delete', ['Card.md']],
    ['vault.rename', ['Card.md', 'Renamed.md']], ['vault.flush', []],
    ['vault.compareAndSwap', ['Card.md', 'old', 'new']], ['vault.watch', []],
  ];
  for (const [method, args] of calls) await assert.rejects(host.handle(method, args), /Permission/);
  manifest.permissions = ['vault:write'];
  await assert.rejects(host.handle('vault.append', ['Card.md', 'text']), /vault:read/);
  await assert.rejects(host.handle('vault.compareAndSwap', ['Card.md', 'old', 'new']), /vault:read/);
  manifest.permissions.push('vault:read');
  for (const [method, args] of calls.slice(0, -1)) await host.handle(method, args);
  await assert.rejects(host.handle('vault.compareAndSwap', ['Card.md', null, 'new']), /Expected content/);
  const id = await host.handle('vault.watch', []);
  assert.equal(subscriptions, 1);
  assert.equal(await host.handle('vault.unwatch', [id]), true);
  assert.equal(await host.handle('vault.unwatch', [id]), false);
  for (let i = 0; i < 32; i++) await host.handle('vault.watch', []);
  await assert.rejects(host.handle('vault.watch', []), /32 vault watches/);
  // Disposal's DOM listener removal is tested in the Electron suite; check its subscription cleanup here.
  const original = global.window;
  global.window = { removeEventListener() { } };
  try { host.dispose(); } finally { global.window = original; }
  assert.equal(subscriptions, 0);
});

