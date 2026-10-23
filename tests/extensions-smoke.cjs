if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tagline-extensions-'));
  try {
    const result = spawnSync(require('electron'), [__filename], {
      env: { ...process.env, TAGLINE_EXTENSIONS_ROOT: root }, stdio: 'inherit', timeout: 120000,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
  return;
}

const { app, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DEMO = `
tagline.commands.register('capabilities', async () => {
  const disposables = tagline.helpers.createDisposables();
  disposables.add(await tagline.events.on('ext.demo.check', payload => tagline.storage.set('eventCheck', payload)));
  disposables.add(await tagline.events.on('editor.selectionChanged', payload => tagline.storage.set('selectionEvent', payload)));
  await tagline.events.emit('ext.demo.check', { passed: true });
  const snapshot = await tagline.editor.tiptap.getSnapshot();
  if (snapshot.doc.type !== 'doc') throw new Error('Missing Tiptap document');
  await tagline.editor.setSelection({ from: 1, to: 3 });
  await tagline.editor.tiptap.runCommand('toggleBold');
  await tagline.storage.set('selectionCheck', (await tagline.editor.tiptap.getSnapshot()).selection);
  await tagline.storage.set('helperCheck', await tagline.helpers.path.join('Folder', '..', 'Card.md'));
  await tagline.storage.set('textCheck', await tagline.helpers.markdownToText('**Evidence**'));
  await tagline.storage.set('helperLibraryCheck', {
    slug: await tagline.helpers.markdown.slugify('Climate Impact'),
    outline: await tagline.helpers.markdown.outline('# Case\\n\\n#### Card'),
    links: await tagline.helpers.markdown.extractLinks('[[Card]]'),
    tags: await tagline.helpers.markdown.extractTags('#aff'),
    card: await tagline.helpers.cards.getAt('#### Card\\n\\n==Evidence==', 10),
    speech: await tagline.helpers.speech.estimate('Evidence matters.').spokenWords,
  });
  tagline.panels.onMessage('status', async payload => {
    if (payload.ready) await tagline.panels.postMessage('status', { reply: true });
    else await tagline.storage.set('panelCheck', payload);
  });
  tagline.webviews.onMessage('details', payload => tagline.storage.set('webviewCheck', payload));
  await tagline.panels.setHtml('status', '<p>Panel</p><script>taglineWebview.onMessage(payload => taglineWebview.postMessage(payload)); taglineWebview.postMessage({ready:true});</script>');
  await tagline.panels.show('status');
  await tagline.webviews.setHtml('details', '<p>Details</p><script>(async () => { let blocked = false; try { await fetch("https://example.com"); } catch { blocked = true; } taglineWebview.postMessage({ready:true, networkBlocked:blocked, api:typeof window.api}); })();</script>');
  await tagline.webviews.show('details');
  await disposables.dispose();
});
tagline.commands.register('source-selection', async () => {
  const note = await tagline.editor.getActiveNote();
  if (note.editorKind !== 'source') throw new Error('Expected source editor');
  await tagline.editor.setSelection({ from: 0, to: 4 });
  await tagline.storage.set('sourceSelection', (await tagline.editor.getActiveNote()).selectionRange);
});
tagline.commands.register('stamp', async () => {
  const note = await tagline.editor.getActiveNote();
  await tagline.editor.insertText('Stamped ' + note.path);
});
tagline.commands.register('index', async () => {
  const files = await tagline.vault.list();
  const card = await tagline.vault.read('Card.md');
  await tagline.vault.write('Index.md', '# Index\\n\\n' + files.join('\\n') + '\\n\\n' + card.length);
  await tagline.storage.set('runs', ((await tagline.storage.get('runs')) || 0) + 1);
  tagline.notify('Indexed ' + files.length + ' files, run ' + await tagline.storage.get('runs'));
});
tagline.commands.register('escape', async () => {
  const report = [typeof globalThis.api, typeof require];
  try { localStorage.getItem('x'); report.push('storage'); } catch { report.push('no-storage'); }
  try { parent.document.title; report.push('dom'); } catch { report.push('no-dom'); }
  try { await fetch('https://example.com'); report.push('network'); } catch { report.push('no-network'); }
  report.push(typeof Worker, typeof SharedWorker);
  tagline.notify(report.join(','));
});
tagline.commands.register('spin', () => { while (true) {} });
tagline.commands.register('flood', () => {
  for (let i = 0; i < 300; i++) postMessage({ type: 'error', message: 'flood' });
});
tagline.commands.register('pending', async () => {
  const results = await Promise.allSettled(Array.from({ length: 33 }, () => tagline.storage.get('runs')));
  tagline.notify('Rejected ' + results.filter((item) => item.status === 'rejected').length + ' excess calls');
});
tagline.commands.register('vault-apis', async () => {
  const events = [];
  const stop = await tagline.vault.watch(event => events.push(event));
  const file = await tagline.vault.write('Operations.md', 'start');
  await Promise.all([tagline.vault.append(file, '-a'), tagline.vault.append(file, '-b')]);
  const before = await tagline.vault.read(file);
  if (before !== 'start-a-b') throw new Error('Concurrent appends lost content: ' + before);
  const swapped = await Promise.all([
    tagline.vault.compareAndSwap(file, before, 'winner'),
    tagline.vault.compareAndSwap(file, before, 'loser'),
  ]);
  if (String(swapped) !== 'true,false') throw new Error('CAS did not reject stale content');
  if (await tagline.vault.read(file) !== 'winner') throw new Error('CAS lost the winning content');
  await tagline.vault.flush();
  await tagline.vault.write('Operation Links.md', '[[Operations]]');
  const renamed = await tagline.vault.rename(file, 'Renamed Operations.md');
  if (renamed !== 'Renamed Operations.md') throw new Error('Rename returned wrong path');
  await tagline.vault.append(renamed, '-saved');
  await tagline.vault.flush();
  await new Promise(resolve => setTimeout(resolve, 100));
  await tagline.storage.set('watchEvents', events);
  await stop();
  const count = events.length;
  await tagline.vault.write('Delete Me.md', 'temporary');
  await tagline.vault.delete('Delete Me.md');
  await new Promise(resolve => setTimeout(resolve, 100));
  if (events.length !== count) throw new Error('Watch continued after unsubscribe');
  await tagline.storage.set('watchStopped', true);
  tagline.notify('Vault APIs passed');
});
tagline.commands.register('save-checks', async () => {
  const file = 'Renamed Operations.md';
  await tagline.vault.write(file, 'retry');
  let rejected = false;
  try { await tagline.vault.flush(); }
  catch (error) {
    if (!error.message.includes('Could not save')) throw error;
    rejected = true;
  }
  if (!rejected) throw new Error('Flush hid a disk write failure');
  await tagline.vault.flush();
  await tagline.vault.write(file, 'inflight-saved');
  await new Promise(resolve => setTimeout(resolve, 500));
  await tagline.vault.flush();
  await tagline.storage.set('saveChecks', true);
});
`;

(async () => {
  const root = process.env.TAGLINE_EXTENSIONS_ROOT;
  if (!root) throw new Error('Run through npm run test:extensions.');
  const profile = path.join(root, 'profile');
  const vault = path.join(root, 'vault');
  app.setPath('userData', profile);
  const ext = (id) => path.join(profile, 'extensions', id);
  await fs.mkdir(path.join(ext('demo'), 'themes'), { recursive: true });
  await fs.mkdir(ext('nosy'), { recursive: true });
  await fs.mkdir(vault, { recursive: true });
  shell.trashItem = async (file) => fs.rm(file);
  let failSave = false;
  let slowSave = false;
  const originalWrite = fs.writeFile;
  fs.writeFile = async (file, ...args) => {
    if (file === path.join(vault, 'Renamed Operations.md')) {
      if (failSave) { failSave = false; throw new Error('Simulated disk write failure'); }
      if (slowSave) await delay(700);
    }
    return originalWrite(file, ...args);
  };
  await fs.writeFile(path.join(ext('demo'), 'manifest.json'), JSON.stringify({
    manifestVersion: 1, id: 'demo', name: 'Demo', version: '1.0.0', description: 'Smoke test extension',
    main: 'main.js', permissions: ['editor', 'vault:read', 'vault:write', 'events', 'ui'],
    contributes: {
      commands: [{ id: 'stamp', title: 'Stamp note', key: 'Mod+Alt+K' }, { id: 'index', title: 'Build index' },
      { id: 'escape', title: 'Try escaping', key: 'Mod+N' }, { id: 'spin', title: 'Spin forever' },
      { id: 'flood', title: 'Flood messages' }, { id: 'pending', title: 'Pending limit' },
      { id: 'vault-apis', title: 'Exercise vault APIs' },
      { id: 'save-checks', title: 'Exercise save failures and in-flight flush' },
      { id: 'capabilities', title: 'Exercise editor events and UI' },
      { id: 'source-selection', title: 'Set source selection' }],
      panels: [{ id: 'status', title: 'Status' }],
      webviews: [{ id: 'details', title: 'Details' }],
      themes: ['themes/ocean.json'],
    },
  }));
  await fs.writeFile(path.join(ext('demo'), 'main.js'), DEMO);
  await fs.writeFile(path.join(ext('demo'), 'themes', 'ocean.json'), JSON.stringify({
    version: 1, name: 'Ocean', mode: 'dark', colors: { accent: '#12a4d9' },
    variables: { 'font-ui': 'monospace', 'editor-font-size': '21px', 'extension-token': '12px' },
  }));
  await fs.writeFile(path.join(ext('nosy'), 'manifest.json'), JSON.stringify({
    manifestVersion: 1, id: 'nosy', name: 'Nosy', version: '0.1.0', main: 'main.js',
    contributes: { commands: [{ id: 'peek', title: 'Peek' }] },
  }));
  await fs.writeFile(path.join(ext('nosy'), 'main.js'),
    "tagline.commands.register('peek', async () => { await tagline.vault.list(); });");
  await fs.writeFile(path.join(vault, 'Card.md'), '# Card\n\nEvidence.\n');
  await fs.writeFile(path.join(vault, 'Round.flow'), JSON.stringify({ version: 1, sheets: [{ name: 'Case', columns: ['1AC'], rows: [['A']] }] }));
  const demoManifest = require('../electron/extensions.cjs').validateManifest(
    JSON.parse(await fs.readFile(path.join(ext('demo'), 'manifest.json'), 'utf8')), ext('demo'));
  const demoReview = JSON.stringify({
    permissions: [...demoManifest.permissions].sort(),
    settings: demoManifest.contributes.settings, panels: demoManifest.contributes.panels, webviews: demoManifest.contributes.webviews
  });
  await fs.writeFile(path.join(profile, 'config.json'), JSON.stringify({
    modelAutoload: false, lastVault: vault, enabledExtensions: ['demo', 'nosy'],
    extensionReviews: { demo: demoReview },
  }));

  app.on('browser-window-created', (_event, win) => {
    win.webContents.once('did-finish-load', async () => {
      const wc = win.webContents;
      const js = (code) => wc.executeJavaScript(code);
      wc.on('console-message', (event) => { if (event.level === 'error' || event.level === 'warning') console.error('Renderer:', event.message); });
      const wait = async (code, label = code) => {
        for (let i = 0; i < 100; i++) { if (await js(code)) return; await delay(100); }
        throw new Error('Timed out: ' + label);
      };
      const toast = async (pattern) => wait(`/${pattern}/.test(document.querySelector('.toast')?.textContent || '')`, `toast ${pattern}`);
      const palette = async (label) => {
        for (let attempt = 0; attempt < 50; attempt++) {
          await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: ${process.platform !== 'darwin'}, metaKey: ${process.platform === 'darwin'}, bubbles: true }))`);
          await wait(`!!document.querySelector('.palette input')`, 'palette');
          await js(`(() => { const input = document.querySelector('.palette input');
            const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            set.call(input, ${JSON.stringify(label)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
          await delay(100);
          const found = await js(`[...document.querySelectorAll('.palette-list > *')].some((el) => el.textContent.includes(${JSON.stringify(label)}))`);
          await js(`document.querySelector('.palette input')?.dispatchEvent(new KeyboardEvent('keydown', { key: '${found ? 'Enter' : 'Escape'}', bubbles: true }))`);
          await delay(200);
          if (found) return;
        }
        throw new Error('Command never appeared: ' + label);
      };
      try {
        await wait(`document.querySelectorAll('iframe[data-extension]').length === 2`, 'extension frames');
        assert.equal(await js(`document.querySelector('iframe[data-extension="demo"]').getAttribute('sandbox')`), 'allow-scripts');

        assert.deepEqual(await js(`[...document.querySelectorAll('.tree-item')].map((el) => el.textContent.trim()).sort()`), ['Card', 'Round']);

        await palette('Demo: Try escaping');
        await toast('Demo: undefined,undefined,no-storage,no-dom,no-network,undefined,undefined');

        await palette('Nosy: Peek');
        await toast('Nosy: Permission "vault:read" is not declared');

        await palette('Demo: Pending limit');
        await toast('Rejected 1 excess calls');

        await palette('Demo: Build index');
        await toast('Demo: Indexed 2 files, run 1');
        await wait(`[...document.querySelectorAll('.tree-item')].some((el) => el.textContent.trim() === 'Index')`, 'index file');
        let index = '';
        for (let i = 0; i < 50 && !index.includes('Round.flow'); i++) {
          index = await fs.readFile(path.join(vault, 'Index.md'), 'utf8').catch(() => '');
          await delay(100);
        }
        assert.match(index, /Card\.md[\s\S]*Round\.flow[\s\S]*\n\n\d+$/);

        await palette('Demo: Exercise vault APIs');
        await toast('Demo: Vault APIs passed');
        assert.equal(await fs.readFile(path.join(vault, 'Renamed Operations.md'), 'utf8'), 'winner-saved');
        assert.equal(await fs.readFile(path.join(vault, 'Operation Links.md'), 'utf8'), '[[Renamed Operations]]');
        await assert.rejects(fs.access(path.join(vault, 'Operations.md')));
        await assert.rejects(fs.access(path.join(vault, 'Delete Me.md')));
        const data = await js("JSON.parse(localStorage.getItem('tagline-extension:demo'))");
        assert.equal(data.watchStopped, true);
        assert.ok(data.watchEvents.some(event => event.type === 'create' && event.path === 'Operations.md'));
        assert.ok(data.watchEvents.some(event => event.type === 'change' && event.path === 'Operations.md'));
        assert.ok(data.watchEvents.some(event => event.type === 'delete' && event.path === 'Operations.md'));
        assert.ok(data.watchEvents.some(event => event.type === 'create' && event.path === 'Renamed Operations.md'));
        failSave = slowSave = true;
        await palette('Demo: Exercise save failures and in-flight flush');
        await wait("JSON.parse(localStorage.getItem('tagline-extension:demo')).saveChecks === true");
        assert.equal(await fs.readFile(path.join(vault, 'Renamed Operations.md'), 'utf8'), 'inflight-saved');
        slowSave = false;

        await js(`[...document.querySelectorAll('.tree-item')].find((el) => el.textContent.trim() === 'Card').click()`);
        await wait(`!!document.querySelector('.ProseMirror')`, 'visual editor');
        await js(`document.querySelector('.ProseMirror').focus()`);
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: [process.platform === 'darwin' ? 'meta' : 'control', 'alt'] });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'K', modifiers: [process.platform === 'darwin' ? 'meta' : 'control', 'alt'] });
        await wait(`document.querySelector('.ProseMirror').textContent.includes('Stamped Card.md')`, 'stamped text');
        await palette('Demo: Exercise editor events and UI');
        await wait("JSON.parse(localStorage.getItem('tagline-extension:demo')).panelCheck?.reply === true", 'panel round-trip');
        await wait("JSON.parse(localStorage.getItem('tagline-extension:demo')).webviewCheck?.ready === true", 'webview messaging');
        const capabilities = await js("JSON.parse(localStorage.getItem('tagline-extension:demo'))");
        assert.deepEqual(capabilities.eventCheck, { passed: true });
        assert.deepEqual(capabilities.selectionCheck, { from: 1, to: 3 });
        assert.deepEqual(capabilities.selectionEvent.selection, { from: 1, to: 3 });
        assert.equal(capabilities.helperCheck, 'Card.md');
        assert.equal(capabilities.textCheck, 'Evidence');
        assert.deepEqual(capabilities.helperLibraryCheck, {
          slug: 'climate-impact',
          outline: [{ level: 1, text: 'Case', line: 0 }, { level: 4, text: 'Card', line: 2 }],
          links: ['Card'], tags: ['aff'],
          card: { text: '#### Card\n\n==Evidence==', level: 4, title: 'Card' },
          speech: 2,
        });
        assert.equal(capabilities.webviewCheck.networkBlocked, true);
        assert.equal(capabilities.webviewCheck.api, 'undefined');
        assert.equal(await js("document.querySelector('.extension-panel iframe').getAttribute('sandbox')"), 'allow-scripts');
        await js("document.querySelector('.extension-webview-dialog header button').click()");
        await js(`(() => { const select = document.querySelector('.note-actions select');
          select.value = 'edit'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await wait("!!document.querySelector('.cm-content')", 'source editor');
        await palette('Demo: Set source selection');
        await wait("JSON.parse(localStorage.getItem('tagline-extension:demo')).sourceSelection?.to === 4", 'source selection');
        assert.deepEqual((await js("JSON.parse(localStorage.getItem('tagline-extension:demo'))")).sourceSelection, { from: 0, to: 4 });
        await js(`(() => { const select = document.querySelector('.note-actions select');
          select.value = 'visual'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await wait("!!document.querySelector('.ProseMirror')", 'restored visual editor');

        // Mod+N stays with the built-in "New note"; the extension's default key was dropped.
        assert.equal(await js(`document.querySelectorAll('.palette').length`), 0);

        await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: ${process.platform !== 'darwin'}, metaKey: ${process.platform === 'darwin'}, bubbles: true }))`);
        await wait(`!!document.querySelector('.dialog.settings')`, 'settings');
        assert.equal(await js(`document.activeElement === document.querySelector('.dialog.settings')`), true);
        assert.equal(await js(`[...document.querySelectorAll('select option')].some((o) => o.textContent === 'Ocean (Demo)')`), true);
        await js(`(() => { const el = document.querySelector('[data-setting="theme"]');
          el.value = 'ext:demo:0'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await wait(`getComputedStyle(document.documentElement).getPropertyValue('--editor-font-size') === '21px'`, 'theme variables applied');
        assert.equal(await js(`getComputedStyle(document.documentElement).getPropertyValue('--font-ui')`), 'monospace');
        await js(`(() => { const el = document.querySelector('[data-setting="theme"]');
          el.value = 'dark'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await wait(`getComputedStyle(document.documentElement).getPropertyValue('--editor-font-size') === '16px'`, 'font preference restored');
        assert.equal(await js(`getComputedStyle(document.documentElement).getPropertyValue('--extension-token')`), '');
        await js(`document.querySelector('[data-section="extensions"]').click()`);
        await wait(`document.querySelectorAll('.extension-card').length === 2`, 'extension cards');
        assert.match(await js(`document.querySelector('[data-extension="demo"]').textContent`), /Create and change notes/);

        await js(`document.querySelector('[data-section="files"]').click()`);
        await js(`document.querySelector('[data-setting="hideFlowExtension"]').click()`);
        await wait(`[...document.querySelectorAll('.tree-item')].some((el) => el.textContent.trim() === 'Round.flow')`, 'flow extension shown');

        await js(`document.querySelector('[data-section="extensions"]').click()`);
        await js(`document.querySelector('[data-extension="nosy"] input[type="checkbox"]').click()`);
        await wait(`document.querySelectorAll('iframe[data-extension]').length === 1`, 'disabled extension unloaded');
        const config = JSON.parse(await fs.readFile(path.join(profile, 'config.json'), 'utf8'));
        assert.deepEqual(config.enabledExtensions, ['demo']);
        await js(`[...document.querySelectorAll('.settings button')].find(el => el.textContent.trim() === 'Done').click()`);
        await palette('Demo: Spin forever');
        assert.equal(await js('6 * 7'), 42, 'App stays responsive during an extension loop');
        await toast('Demo: Extension stopped responding');
        await wait(`!document.querySelector('iframe[data-extension="demo"]')`, 'runaway worker removed');
        await wait("document.querySelectorAll('.extension-surface').length === 0", 'stopped extension surfaces removed');
        await palette('Demo: Spin forever');
        await toast('Demo was stopped');
        await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: ${process.platform !== 'darwin'}, metaKey: ${process.platform === 'darwin'}, bubbles: true }))`);
        await wait(`!!document.querySelector('.settings')`, 'settings after runaway loop');
        await js(`document.querySelector('[data-section="extensions"]').click()`);
        await js(`[...document.querySelectorAll('.settings button')].find(el => el.textContent.trim() === 'Reload extensions').click()`);
        await wait(`!!document.querySelector('iframe[data-extension="demo"]')`, 'worker reloaded');
        await js(`[...document.querySelectorAll('.settings button')].find(el => el.textContent.trim() === 'Done').click()`);
        await palette('Demo: Flood messages');
        await toast('exceeded 200 messages');
        await wait(`!document.querySelector('iframe[data-extension="demo"]')`, 'flooding worker removed');
        console.log('Extension smoke test passed');
        app.exit(0);
      } catch (error) {
        console.error(error, await js(`JSON.stringify({ toast: document.querySelector('.toast')?.textContent, palette: !!document.querySelector('.palette'), items: [...document.querySelectorAll('.palette-list > *')].map((el) => el.textContent).slice(0, 5) })`));
        app.exit(1);
      }
    });
  });
  require('../electron/main.cjs');
})().catch((error) => { console.error(error); app.exit(1); });
