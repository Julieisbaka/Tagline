const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const fsAsync = require('node:fs/promises');
const os = require('node:os');
const { promisify } = require('node:util');

test('sidebar shortcut order is normalized and drag reordering is stable', async () => {
  const { DEFAULT_RIBBON_ITEMS, moveRibbonItem, normalizeRibbonItems } =
    await import('../src/lib/ribbonItems.js');
  assert.deepEqual(normalizeRibbonItems(['search', 'search', 'unknown']), ['search']);
  assert.deepEqual(normalizeRibbonItems(null), DEFAULT_RIBBON_ITEMS);
  assert.deepEqual(moveRibbonItem(['a', 'b', 'c'], 'a', 'c'), ['b', 'a', 'c']);
  assert.deepEqual(moveRibbonItem(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b']);
  assert.deepEqual(moveRibbonItem(['a', 'b'], 'missing', 'b'), ['a', 'b']);
});

test('argument-map card links persist in Markdown without creating note-graph links', async () => {
  const { buildArgumentGraph, createArgumentRelation, getArgumentCards, removeArgumentRelation } =
    await import('../src/lib/argumentMap.js');
  const { extractLinks, rewriteLinks } = await import('../src/lib/vault.js');
  const contents = {
    'Case.md': '# Case\n\n#### Climate impact\n\n**Smith 2024**\n\nEvidence.\n\n#### Funding\n\nSecond card.\n',
    'Answers.md': '#### Alternative explanation\n\nResponse.\n',
  };
  const cards = getArgumentCards(contents);
  assert.equal(cards.length, 3);
  const source = cards[0];
  const target = cards[2];
  const changed = createArgumentRelation(contents[source.path], source, target, 'answers');
  assert.notEqual(changed, contents[source.path]);
  assert.deepEqual(extractLinks(changed), []);

  const updated = getArgumentCards({ ...contents, [source.path]: changed });
  assert.deepEqual(updated[0].relations, [{ type: 'answers', targetId: target.id }]);
  assert.deepEqual(buildArgumentGraph(updated).edges, [[source.id, target.id]]);
  const renamed = rewriteLinks(changed, 'Answers.md', 'Renamed Answers.md', ['Case.md', 'Answers.md']);
  assert.match(renamed, /\[\[Renamed Answers#alternative-explanation\]\]/, 'relationship links follow note renames');

  const removed = removeArgumentRelation(changed, updated[0], {
    ...updated[0].relations[0],
    target,
  });
  assert.equal(getArgumentCards({ ...contents, [source.path]: removed })[0].relations.length, 0);
});

test('JSON Canvas validates spec fields and round-trips unknown properties', async () => {
  const { EMPTY_CANVAS, parseCanvas, serializeCanvas, createCanvasNode } = await import('../src/lib/canvas.js');
  const canvas = parseCanvas(JSON.stringify({
    nodes: [
      { id: 'a', type: 'text', x: -20, y: 5, width: 280, height: 180, text: '**Claim**', pluginData: { keep: true } },
      { id: 'b', type: 'link', x: 320, y: 5, width: 280, height: 180, url: 'https://example.com', color: '6' },
    ],
    edges: [{ id: 'edge', fromNode: 'a', toNode: 'b', fromSide: 'right', toSide: 'left', toEnd: 'arrow', label: 'supports' }],
  }));
  const serialized = serializeCanvas(canvas);
  assert.equal(parseCanvas(serialized).nodes[0].pluginData.keep, true);
  assert.equal(parseCanvas(serialized).edges[0].label, 'supports');
  assert.deepEqual(parseCanvas(EMPTY_CANVAS), { nodes: [], edges: [] });
  assert.equal(createCanvasNode('group', 0, 'group').type, 'group');
  for (const invalid of [
    '{"nodes":[{"id":"x","type":"text","x":0,"y":0,"width":0,"height":10,"text":""}]}',
    '{"nodes":[{"id":"x","type":"file","x":0,"y":0,"width":10,"height":10,"file":""}],"edges":[{"id":"e","fromNode":"x","toNode":"missing"}]}',
    '{"nodes":[{"id":"x","type":"other","x":0,"y":0,"width":10,"height":10}]}',
  ]) assert.throws(() => parseCanvas(invalid));
});

test('extension capabilities validate selection, command, helper, event and UI contracts', async () => {
  const { ExtensionHost } = await import('../src/lib/extensions.js');
  const { applicationEvents, createEventBus, extensionHelper, pathHelper, markdownToText, requirePayload } =
    await import('../src/lib/extensionCapabilities.js');
  const cardMarkdown = '#### Climate impact\n\n**Smith 2024**\n\n==The impact is significant.==';
  assert.equal(extensionHelper('helpers.markdown.slugify', ['Climate Impact']), 'climate-impact');
  assert.deepEqual(extensionHelper('helpers.markdown.outline', [`# Case\n${cardMarkdown}`]), [
    { level: 1, text: 'Case', line: 0 },
    { level: 4, text: 'Climate impact', line: 1 },
  ]);
  assert.deepEqual(extensionHelper('helpers.markdown.extractLinks', ['[[Evidence]]']), ['Evidence']);
  assert.deepEqual(extensionHelper('helpers.markdown.extractTags', ['#aff #impact']), ['aff', 'impact']);
  assert.equal(extensionHelper('helpers.markdown.resolveLink', ['Evidence', ['Evidence.md']]), 'Evidence.md');
  assert.equal(extensionHelper('helpers.cards.getAt', [cardMarkdown, 24]).title, 'Climate impact');
  assert.equal(extensionHelper('helpers.cards.spokenEvidence', [cardMarkdown]), 'The impact is significant.\nSmith 2024');
  assert.equal(extensionHelper('helpers.cards.stats', [cardMarkdown]).cards, 1);
  assert.ok(extensionHelper('helpers.speech.analyze', ['A short speech.']).spokenWords > 0);
  assert.ok(extensionHelper('helpers.speech.estimate', ['A short speech.', 250]).seconds > 0);
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
  await assert.rejects(host.handle('settings.get', ['enabled']), SyntaxError);
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

test('settings and event permission changes require a fresh manifest review', async () => {
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
    manifest.contributes.settings[0].default = 'changed';
    await fsAsync.writeFile(file, JSON.stringify(manifest));
    assert.equal((await handlers['extensions:list']())[0].reviewRequired, true);
    await assert.rejects(handlers['extensions:setEnabled'](null, 'review', true, item.reviewToken), /Reload and review/);
    const [changed] = await handlers['extensions:list']();
    await handlers['extensions:setEnabled'](null, 'review', true, changed.reviewToken);
    assert.equal((await handlers['extensions:load'](null, 'review')).source, 'void 0;');
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

test('translations have matching keys and preserve every interpolation', () => {
  const es = require('../src/locales/es.json');
  const fr = require('../src/locales/fr.json');
  assert.deepEqual(Object.keys(es).sort(), Object.keys(fr).sort());
  for (const catalog of [es, fr]) {
    for (const [key, translation] of Object.entries(catalog)) {
      assert.ok(translation.length);
      assert.deepEqual((key.match(/\{\w+\}/g) || []).sort(), (translation.match(/\{\w+\}/g) || []).sort(), key);
    }
  }
});

const luminance = (hex) => {
  const rgb = hex.slice(1).match(/../g).map((n) => {
    const v = parseInt(n, 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};
const contrast = (a, b) => {
  const l = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (l[0] + 0.05) / (l[1] + 0.05);
};

test('all themes share tokens; high contrast text meets 7:1 on major surfaces', () => {
  const themes = fs.readdirSync(path.join(__dirname, '../src/themes')).map((file) =>
    JSON.parse(fs.readFileSync(path.join(__dirname, '../src/themes', file), 'utf8')));
  for (const theme of themes) {
    assert.equal(theme.version, 1);
    assert.deepEqual(Object.keys(theme.colors).sort(), Object.keys(themes[0].colors).sort());
    assert.ok(contrast(theme.colors['text-strong'], theme.colors['bg-hover']) >= 4.5,
      `${theme.id}: selected widget text/background`);
    if (!theme.id.startsWith('high-contrast')) continue;
    for (const color of ['text', 'text-muted', 'text-faint', 'accent', 'aff', 'neg', 'warning', 'h1', 'h2', 'h3', 'h4']) {
      for (const bg of ['bg', 'bg-secondary', 'bg-elevated', 'bg-hover']) {
        assert.ok(contrast(theme.colors[color], theme.colors[bg]) >= 7, `${theme.id}: ${color}/${bg}`);
      }
    }
    assert.ok(contrast(theme.colors['accent-text'], theme.colors.accent) >= 7);
    assert.ok(contrast(theme.colors['highlight-text'], theme.colors['highlight-bg']) >= 7);
  }
});

test('theme variables expose CSS values and reject malformed or network-loading overrides', async () => {
  const { validateTheme } = await import('../src/lib/themes.js');
  const value = {
    version: 1, name: 'Custom', mode: 'dark', colors: {}, variables: {
      'font-ui': '"Example", sans-serif', 'editor-font-size': '20px',
      'future-token': 'calc(100% - 20px)', accent: 'var(--text)',
    }
  };
  assert.deepEqual(validateTheme(value).variables, value.variables);
  assert.deepEqual(validateTheme({ ...value, variables: undefined }).variables, {});
  for (const variables of [[], null, { '--font-ui': 'serif' }, { a: 1 }, { a: 'url(https://example.com)' },
  { a: 'red; color: blue' }, { a: '' }, Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`var-${i}`, '1']))]) {
    assert.throws(() => validateTheme({ ...value, variables }), /variable/i);
  }
});

test('embedded browser accepts web URLs without enabling local or privileged schemes', () => {
  const { webUrl } = require('../electron/browser.cjs');
  assert.equal(webUrl('https://example.com/a?q=1'), 'https://example.com/a?q=1');
  for (const url of ['file:///C:/secret', 'javascript:alert(1)', 'data:text/html,test',
    'https://user:pass@example.com', '', null, 'https://example.com/' + 'a'.repeat(8192)]) {
    assert.throws(() => webUrl(url));
  }
});

test('embedded browser presents a standard Chrome user agent and builds archive links', () => {
  const { browserUserAgent, archiveUrl } = require('../electron/browser.cjs');
  const agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) tagline/0.1.0 '
    + 'Chrome/140.0.0.0 Electron/45.0.0 Safari/537.36';
  assert.equal(browserUserAgent(agent),
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
  assert.equal(archiveUrl('https://example.com/a?b=1'), 'https://web.archive.org/web/https://example.com/a?b=1');
  assert.throws(() => archiveUrl('file:///C:/secret'));
});

test('Pandoc import chooses an explicit reader, accepts DOCX changes, and surfaces errors', async (t) => {
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

test('revision history snapshots changed documents, enforces retention, and follows renames', async (t) => {
  const { createRevisionHistory } = require('../electron/revisionHistory.cjs');
  const root = await fsAsync.mkdtemp(path.join(os.tmpdir(), 'tagline-history-'));
  t.after(() => fsAsync.rm(root, { recursive: true, force: true }));
  const resolveInVault = (rel) => {
    const full = path.resolve(root, rel);
    const relative = path.relative(root, full);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Path escapes vault');
    return full;
  };
  const history = createRevisionHistory({ getVaultRoot: () => root, resolveInVault });
  const note = path.join(root, 'Evidence.md');
  await fsAsync.writeFile(note, 'Version one');

  const save = async (content) => {
    await history.snapshot('Evidence.md', content, 2);
    await fsAsync.writeFile(note, content);
  };
  await save('Version one');
  assert.deepEqual(await history.list('Evidence.md'), []);
  await save('Version two');
  await save('Version three');
  await save('Version four');
  let revisions = await history.list('Evidence.md');
  assert.equal(revisions.length, 2);
  assert.deepEqual(await Promise.all(revisions.map(({ id }) => history.read('Evidence.md', id))),
    ['Version three', 'Version two']);

  await fsAsync.rename(note, path.join(root, 'Renamed.md'));
  await history.rename('Evidence.md', 'Renamed.md');
  revisions = await history.list('Renamed.md');
  assert.equal(revisions.length, 2);
  assert.equal(await history.read('Renamed.md', revisions[0].id), 'Version three');
  await assert.rejects(history.list('../outside.md'), /Path escapes vault/);
  await assert.rejects(history.snapshot('Evidence.md', 'next version', 0), /retention must be between/);
});
