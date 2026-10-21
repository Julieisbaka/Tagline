const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMetadata, publicAddress, validateUrl, extractCitation } = require('../electron/citationMetadata.cjs');

test('citation autofill reads JSON-LD graphs, repeated authors, entities and meta fallbacks', () => {
  const fields = parseMetadata(`
    <script type="application/ld+json">invalid JSON</script>
    <script type="application/ld+json">{"@graph":[{"@type":["NewsArticle"],
      "headline":"Climate &amp; Energy","author":[{"name":"Jane Smith"},{"name":"John Doe"}],
      "datePublished":"2025-01-20","publisher":{"name":"Reuters"}}]}</script>
    <meta content='Ignored title' property='og:title'>
  `, 'https://www.reuters.com/world/story-2024-01-01/');
  assert.deepEqual(fields, { author: 'Jane Smith, John Doe', title: 'Climate & Energy',
    year: '2025', publication: 'Reuters', url: 'https://www.reuters.com/world/story-2024-01-01/' });
  const fallback = parseMetadata(`<meta name="byl" content="By Jane Smith">
    <meta property="og:title" content="Research &#x2014; explained">`, 'https://www.nytimes.com/2024/05/03/science/research.html');
  assert.equal(fallback.author, 'Jane Smith');
  assert.equal(fallback.year, '2024');
  assert.equal(fallback.publication, 'The New York Times');
  assert.equal(fallback.title, 'Research \u2014 explained');
  const reuters = parseMetadata('<title>Article</title>', 'https://reuters.com/world/article-2023-06-10/');
  assert.equal(reuters.year, '2023');
  assert.equal(parseMetadata('<title>Unknown</title>', 'https://example.com/2020/archive').year, '');
});

test('citation URLs reject local networks, credentials and non-web schemes', async () => {
  for (const address of ['127.0.0.1', '10.2.3.4', '172.20.1.2', '192.168.1.1', '169.254.169.254',
    '100.64.1.2', '::1', '::ffff:127.0.0.1', 'fc00::1', '2001:db8::1']) assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress('8.8.8.8'), true);
  assert.equal(publicAddress('2606:4700:4700::1111'), true);
  for (const url of ['file:///secret', 'https://localhost/a', 'http://127.0.0.1', 'http://[::1]',
    'https://user:password@example.com', 'https://example.com:8080']) assert.throws(() => validateUrl(url));
  await assert.rejects(extractCitation('http://127.0.0.1'), /private network/);
});

test('configurable shortcuts support platform modifiers, conflicts, clearing and editor syntax', async () => {
  global.window = { api: { platform: 'win32' } };
  const { binding, displayBinding, matchesBinding, bindingConflict, editorBinding, eventBinding } =
    await import('../src/lib/keybindings.js');
  assert.equal(binding('new-note'), 'Mod+N');
  assert.equal(binding('new-note', { 'new-note': '' }), '');
  assert.equal(displayBinding('Mod+Shift+N', 'darwin'), 'Cmd+Shift+N');
  const event = { key: 'n', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false };
  assert.equal(matchesBinding(event, 'Mod+Shift+N', 'win32'), true);
  assert.equal(matchesBinding(event, 'Mod+Shift+N', 'darwin'), false);
  assert.equal(matchesBinding({ ...event, ctrlKey: false, metaKey: true }, 'Mod+Shift+N', 'darwin'), true);
  assert.equal(matchesBinding({ ...event, shiftKey: false }, 'Mod+Shift+N', 'win32'), false);
  assert.equal(bindingConflict('new-note', 'Mod+O', {}).id, 'switcher');
  assert.equal(bindingConflict('new-note', '', {}), null);
  assert.equal(editorBinding('Mod+Shift+N'), 'Mod-Shift-n');
  assert.equal(eventBinding({ key: 'Control' }, 'win32'), '');
});

test('intermediate empty highlight delimiters do not crash read-time statistics', async () => {
  const { cardStats } = await import('../src/lib/card.js');
  assert.equal(cardStats('====').highlighted, 0);
});

test('OS flow opens handle cold starts, second instances, macOS events and vault selection', async () => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const os = require('node:os');
  const { EventEmitter } = require('node:events');
  const { registerFlowFiles, flowArguments } = require('../electron/flowFiles.cjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-flow-test-'));
  try {
    const file = path.join(root, 'Round with spaces.flow');
    await fs.writeFile(file, '{"version":1,"sheets":[]}');
    const app = new EventEmitter();
    app.requestSingleInstanceLock = () => true;
    app.isReady = () => true;
    const handlers = {};
    let current = null;
    let focused = 0;
    const win = { isDestroyed: () => false, isMinimized: () => false, show() {},
      focus: () => focused++, webContents: { send() {} } };
    registerFlowFiles({ app, ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
      getWindow: () => win, createWindow() {}, getVaultRoot: () => current,
      openVault: async (dir) => { current = dir; return { root: dir, name: path.basename(dir) }; },
      argv: ['tagline.exe', file, 'relative.flow', path.join(root, 'not-md.md')] });
    assert.deepEqual(flowArguments([file, '--other', 'relative.flow']), [file]);
    assert.equal(handlers['flow:pending'](), file);
    let result = await handlers['flow:open'](null, file);
    assert.equal(result.path, 'Round with spaces.flow');
    assert.equal(result.vault.root, root);
    assert.equal(handlers['flow:pending'](), null);
    await assert.rejects(handlers['flow:open'](null, file), /not requested/);
    app.emit('second-instance', {}, ['tagline', file]);
    assert.equal(handlers['flow:pending'](), file);
    result = await handlers['flow:open'](null, file);
    assert.equal(result.vault.root, root);
    let prevented = false;
    app.emit('open-file', { preventDefault: () => { prevented = true; } }, file);
    assert.equal(prevented, true);
    assert.equal(handlers['flow:pending'](), file);
    assert.ok(focused >= 3);
    let quit = false;
    const secondary = { requestSingleInstanceLock: () => false, quit: () => { quit = true; } };
    assert.equal(registerFlowFiles({ app: secondary }), false);
    assert.equal(quit, true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
