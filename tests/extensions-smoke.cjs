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
let invalidInstallRejected = false, duplicateInstallRejected = false;
try { tagline.onInstall(null); } catch (error) { invalidInstallRejected = error.message.includes('function'); }
tagline.onInstall(async () => {
  await tagline.storage.set('installRuns', ((await tagline.storage.get('installRuns')) || 0) + 1);
  await tagline.webviews.setHtml('details', '<h2>Extension setup complete</h2>');
  await tagline.webviews.show('details');
});
try { tagline.onInstall(() => {}); } catch (error) { duplicateInstallRejected = error.message.includes('Only one'); }
tagline.commands.register('capabilities', async () => {
  let lateInstallRejected = false;
  try { tagline.onInstall(() => {}); } catch (error) { lateInstallRejected = error.message.includes('initialization'); }
  await tagline.storage.set('installRegistration', { invalidInstallRejected, duplicateInstallRejected, lateInstallRejected });
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
    speech: (await tagline.helpers.speech.estimate('Evidence matters.')).spokenWords,
    duration: await tagline.helpers.cards.formatDuration(90),
    citation: await tagline.helpers.citations.create({ author: 'Smith', year: '2024', title: 'A claim' }),
    score: await tagline.helpers.search.fuzzyScore('deb', 'debate'),
    template: await tagline.helpers.templates.fill('{{title}}', 'Case'),
    html: await tagline.helpers.markdown.toHtml('**Safe**'),
    canvasLink: await tagline.helpers.canvas.resolveLink('[[Round.flow|Round]]', ['Round.flow']),
    suggestions: await tagline.helpers.canvas.suggestFiles(['Card.md', 'Round.flow'], 'Card'),
    canvasId: await tagline.helpers.canvas.createId(),
    moved: await tagline.helpers.canvas.moveNodes({nodes:[],edges:[]}, [], 20, 10),
  });
  tagline.panels.onMessage('status', async payload => {
    if (payload.ready) await tagline.panels.postMessage('status', { reply: true });
    else if (payload.uiReport) await tagline.storage.set('uiReport', payload.uiReport);
    else await tagline.storage.set('panelCheck', payload);
  });
  tagline.webviews.onMessage('details', payload => tagline.storage.set('webviewCheck', payload));
  await tagline.panels.setHtml('status', '<p>Panel</p><script>' +
    'const report = () => taglineWebview.postMessage({uiReport:{ theme:taglineWebview.getTheme(), button:getComputedStyle(document.querySelector("button")).backgroundColor, selection:getComputedStyle(document.body,"::selection").backgroundColor, selectionText:getComputedStyle(document.body,"::selection").color, labels:[...document.querySelectorAll("label")].map(label=>({name:label.textContent,associated:label.control?.id===label.htmlFor})), notice:document.querySelector(".tl-notice").getAttribute("role") }});' +
    'document.body.append(taglineUI.card({title:"Theme-aware tools",children:[' +
    'taglineUI.field({label:"Find evidence",description:"Filename match",value:"Climate"}),' +
    'taglineUI.select({label:"Side",value:"aff",options:[{label:"Affirmative",value:"aff"},{label:"Negative",value:"neg"}]}),' +
    'taglineUI.toggle({label:"Enabled",checked:true,onChange:value=>taglineWebview.postMessage({toggle:value})}),' +
    'taglineUI.notice({text:"Ready"}),' +
    'taglineUI.button({label:"Save",variant:"primary",onClick:()=>taglineWebview.postMessage({button:true})})]}));' +
    'taglineWebview.onThemeChange(report); report();' +
    'taglineWebview.onMessage(payload => {if(payload.inspect)report();else taglineWebview.postMessage(payload)}); taglineWebview.postMessage({ready:true});</script>');
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
tagline.commands.register('document-apis', async () => {
  const active = await tagline.editor.getActiveNote();
  await tagline.storage.set('documentKind', { kind: active.kind, editorKind: active.editorKind, selection: active.selectionRange });
  const flow = await tagline.flow.read('Round.flow');
  await tagline.flow.write('Round.flow', await tagline.helpers.flow.setCell(flow, 0, 0, 0, 'Extension evidence'));
  const canvas = await tagline.helpers.canvas.parse('{"nodes":[],"edges":[]}');
  canvas.nodes.push(await tagline.helpers.canvas.createNode('text', 0));
  canvas.nodes[0].text = 'Extension canvas';
  await tagline.canvas.write('Map.canvas', canvas);
  await tagline.vault.flush();
  await tagline.storage.set('documentCheck', (await tagline.canvas.read('Map.canvas')).nodes[0].text);
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
    if (file === path.join(vault, 'Renamed Operations.md') ||
      path.dirname(file) === vault && path.basename(file).startsWith('.tagline-save-')) {
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
      { id: 'source-selection', title: 'Set source selection' },
      { id: 'document-apis', title: 'Exercise document APIs' }],
      ribbonItems: [{ id: 'documents', title: 'Document tools', icon: 'canvas', command: 'document-apis' }],
      panels: [{ id: 'status', title: 'Status' }],
      webviews: [{ id: 'details', title: 'Details' }],
      themes: ['themes/ocean.json'],
    },
  }));
  await fs.writeFile(path.join(ext('demo'), 'main.js'), DEMO);
  await fs.writeFile(path.join(ext('demo'), 'themes', 'ocean.json'), JSON.stringify({
    version: 1, name: 'Ocean', mode: 'dark', colors: { accent: '#12a4d9' },
    variables: { 'font-ui': 'monospace', 'editor-font-size': '21px', 'extension-token': '12px' },
    metadata: { author: 'Theme author', accessibility: { contrast: 'high', reducedMotion: true, notes: 'Test declaration, not certification.' } },
    settings: [
      { id: 'selection-color', title: 'Selection color', type: 'string', default: '#123456', variable: 'selection' },
      { id: 'reading-size', title: 'Reading size', type: 'number', default: 21, min: 12, max: 30, variable: 'editor-font-size', unit: 'px' },
    ],
  }));
  await fs.writeFile(path.join(ext('nosy'), 'manifest.json'), JSON.stringify({
    manifestVersion: 1, id: 'nosy', name: 'Nosy', version: '0.1.0', main: 'main.js',
    contributes: { commands: [{ id: 'peek', title: 'Peek' }] },
  }));
  await fs.writeFile(path.join(ext('nosy'), 'main.js'),
    `tagline.onInstall(async () => {
      const attempts = ((await tagline.storage.get('installAttempts')) || 0) + 1;
      await tagline.storage.set('installAttempts', attempts);
      let denied = false;
      try { await tagline.vault.list(); } catch (error) { denied = error.message.includes('Permission'); }
      if (!denied) throw new Error('Install hook bypassed permissions');
      await tagline.storage.set('installPermissionDenied', denied);
      if (attempts === 1) throw new Error('Retry first install setup');
    });
    tagline.commands.register('peek', async () => { await tagline.vault.list(); });`);
  await fs.writeFile(path.join(vault, 'Card.md'), '# Card\n\nEvidence.\n');
  await fs.writeFile(path.join(vault, 'Round.flow'), JSON.stringify({ version: 1, sheets: [{ name: 'Case', columns: ['1AC'], rows: [['A']] }] }));
  const demoManifest = require('../electron/extensions.cjs').validateManifest(
    JSON.parse(await fs.readFile(path.join(ext('demo'), 'manifest.json'), 'utf8')), ext('demo'));
  const demoReview = JSON.stringify({
    permissions: [...demoManifest.permissions].sort(),
    settings: demoManifest.contributes.settings, ribbonItems: demoManifest.contributes.ribbonItems,
    panels: demoManifest.contributes.panels, webviews: demoManifest.contributes.webviews,
  });
  await fs.writeFile(path.join(profile, 'config.json'), JSON.stringify({
    modelAutoload: false, lastVault: vault, enabledExtensions: ['demo', 'nosy'],
    extensionReviews: { demo: demoReview },
  }));

  app.on('browser-window-created', (_event, win) => {
    win.webContents.setBackgroundThrottling(false);
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
        win.show(); win.focus();
        await wait("!!document.querySelector('.onboarding-skip')");
        await js("document.querySelector('.onboarding-skip').click()");
        await wait("document.querySelector('.extension-webview-dialog')?.textContent.includes('Details')");
        await js("document.querySelector('.extension-webview-dialog button').click()");
        await wait("JSON.parse(localStorage.getItem('tagline-extension:nosy'))?.installAttempts === 1");
        await js("document.querySelector('.ribbon-settings-button').click()");
        await wait("!!document.querySelector('.settings')");
        await js("document.querySelector('[data-section=extensions]').click()");
        await wait("document.querySelector('[data-extension=nosy]')?.textContent.includes('Retry first install setup')");
        let installed = JSON.parse(await fs.readFile(path.join(profile, 'config.json'), 'utf8'));
        assert.equal(installed.initializedExtensions.includes('nosy'), false, 'failed setup does not mark installation complete');
        await js("[...document.querySelectorAll('.settings button')].find(el => el.textContent === 'Reload extensions').click()");
        await wait("JSON.parse(localStorage.getItem('tagline-extension:nosy'))?.installAttempts === 2");
        await wait("document.querySelector('[data-extension=nosy]') && !document.querySelector('[data-extension=nosy]').textContent.includes('Retry first install setup')");
        await js("[...document.querySelectorAll('.settings button')].find(el => el.textContent === 'Done').click()");
        await wait(`document.querySelectorAll('iframe[data-extension]').length === 2`, 'extension frames');
        assert.equal(await js("JSON.parse(localStorage.getItem('tagline-extension:demo')).installRuns"), 1);
        assert.equal(await js("JSON.parse(localStorage.getItem('tagline-extension:nosy')).installPermissionDenied"), true);
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
        await wait("JSON.parse(localStorage.getItem('tagline-extension:demo')).uiReport?.theme.id === 'dark'", 'UI kit initializes before extension scripts');
        const uiReport = await js("JSON.parse(localStorage.getItem('tagline-extension:demo')).uiReport");
        assert.equal(uiReport.labels.length, 3);
        assert.ok(uiReport.labels.every(label => label.associated), 'kit inputs have associated native labels');
        assert.equal(uiReport.notice, 'status');
        assert.equal(uiReport.selectionText, 'rgb(255, 255, 255)');
        const capabilities = await js("JSON.parse(localStorage.getItem('tagline-extension:demo'))");
        assert.deepEqual(capabilities.installRegistration, {
          invalidInstallRejected: true, duplicateInstallRejected: true, lateInstallRejected: true,
        });
        assert.deepEqual(capabilities.helperLibraryCheck.canvasLink, { type: 'file', path: 'Round.flow', heading: '', label: 'Round' });
        assert.deepEqual(capabilities.helperLibraryCheck.suggestions, ['Card.md']);
        assert.ok(capabilities.helperLibraryCheck.canvasId);
        assert.deepEqual(capabilities.helperLibraryCheck.moved, { nodes: [], edges: [] });
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
          duration: '1:30',
          citation: '**Smith 2024** — "A claim"',
          score: 999.4,
          template: 'Case',
          html: '<p><strong>Safe</strong></p>\n',
          canvasLink: { type: 'file', path: 'Round.flow', heading: '', label: 'Round' },
          suggestions: ['Card.md'],
          canvasId: capabilities.helperLibraryCheck.canvasId,
          moved: { nodes: [], edges: [] },
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
        await js(`[...document.querySelectorAll('.tree-item')].find(el => el.textContent.trim() === 'Round').click()`);
        await wait("!!document.querySelector('.flow-grid textarea')");
        await wait("!!document.querySelector('.ribbon [data-ribbon-item=\"ext:demo.documents\"]')");
        await js("document.querySelector('.ribbon [data-ribbon-item=\"ext:demo.documents\"]').click()");
        await wait("JSON.parse(localStorage.getItem('tagline-extension:demo')).documentCheck === 'Extension canvas'");
        assert.deepEqual(await js("JSON.parse(localStorage.getItem('tagline-extension:demo')).documentKind"),
          { kind: 'flow', editorKind: null, selection: null });
        assert.equal(JSON.parse(await fs.readFile(path.join(vault, 'Round.flow'), 'utf8')).sheets[0].rows[0][0], 'Extension evidence');
        assert.equal(JSON.parse(await fs.readFile(path.join(vault, 'Map.canvas'), 'utf8')).nodes[0].text, 'Extension canvas');
        await js(`(() => { const button = document.querySelector('.ribbon [data-ribbon-item="ext:demo.documents"]');
          button.focus(); button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true })); })()`);
        await wait("!!document.querySelector('.context-menu')");
        await js(`[...document.querySelectorAll('.context-menu button')].find(el => el.textContent === 'Remove from sidebar').click()`);
        await wait("!document.querySelector('.ribbon [data-ribbon-item=\"ext:demo.documents\"]')");
        assert.ok(await js("JSON.parse(localStorage.getItem('tagline-settings')).hiddenRibbonItems.includes('ext:demo.documents')"));
        await js(`[...document.querySelectorAll('.tree-item')].find(el => el.textContent.trim() === 'Card').click()`);
        await wait("!!document.querySelector('.cm-content')");
        await js(`(() => { const select = document.querySelector('.note-actions select');
          select.value = 'visual'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await wait("!!document.querySelector('.ProseMirror')", 'restored visual editor');

        // Mod+N stays with the built-in "New note"; the extension's default key was dropped.
        assert.equal(await js(`document.querySelectorAll('.palette').length`), 0);

        await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: ${process.platform !== 'darwin'}, metaKey: ${process.platform === 'darwin'}, bubbles: true }))`);
        await wait(`!!document.querySelector('.dialog.settings')`, 'settings');
        await wait(`document.querySelector('.dialog.settings').contains(document.activeElement)`, 'focus inside settings');
        assert.equal(await js(`[...document.querySelectorAll('select option')].some((o) => o.textContent === 'Ocean (Demo)')`), true);
        await js(`(() => { const el = document.querySelector('[data-setting="theme"]');
          el.value = 'ext:demo:0'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await wait(`getComputedStyle(document.documentElement).getPropertyValue('--editor-font-size') === '21px'`, 'theme variables applied');
        assert.equal(await js(`getComputedStyle(document.documentElement).getPropertyValue('--font-ui')`), 'monospace');
        await wait("JSON.parse(localStorage.getItem('tagline-extension:demo')).uiReport?.theme.id === 'ext:demo:0'", 'panel theme updates live');
        await delay(250);
        await js("void document.querySelector('.extension-panel iframe').contentWindow.postMessage({type:'extension-ui-message',payload:{inspect:true}},'*')");
        await wait("JSON.parse(localStorage.getItem('tagline-extension:demo')).uiReport.button === 'rgb(18, 164, 217)'", 'shared primary button follows theme accent');
        assert.equal(await js("JSON.parse(localStorage.getItem('tagline-extension:demo')).uiReport.theme.metadata.accessibility.contrast"), 'high');
        wc.debugger.attach('1.3');
        await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        assert.equal(await js("matchMedia('(prefers-reduced-motion: reduce)').matches"), true);
        await wait("JSON.parse(localStorage.getItem('tagline-extension:demo')).uiReport?.theme.reducedMotion === true");
        await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
        await wait("JSON.parse(localStorage.getItem('tagline-extension:demo')).uiReport?.theme.reducedMotion === false");
        wc.debugger.detach();
        assert.match(await js("document.querySelector('.theme-metadata').textContent"), /author provided/);
        assert.equal(await js("document.querySelectorAll('[data-theme-setting]').length"), 2);
        await js(`(() => {
          const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          const color = document.querySelector('[data-theme-setting="selection-color"]');
          set.call(color, '#abcdef'); color.dispatchEvent(new Event('input', {bubbles:true}));
        })()`);
        await js(`(() => {
          const input = document.querySelector('[data-theme-setting="reading-size"]');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '24');
          input.dispatchEvent(new Event('input', {bubbles:true}));
        })()`);
        await js(`[...document.querySelectorAll('.theme-options button')].find(el => el.textContent === 'Apply theme settings').click()`);
        await wait("getComputedStyle(document.documentElement).getPropertyValue('--selection') === '#abcdef'");
        await wait("JSON.parse(localStorage.getItem('tagline-extension:demo')).uiReport?.selection === 'rgb(171, 205, 239)'");
        assert.equal(await js("getComputedStyle(document.documentElement).getPropertyValue('--editor-font-size')"), '24px');
        await js(`(() => { const el = document.querySelector('[data-setting="theme"]');
          el.value = 'dark'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await wait(`getComputedStyle(document.documentElement).getPropertyValue('--editor-font-size') === '16px'`, 'font preference restored');
        assert.equal(await js(`getComputedStyle(document.documentElement).getPropertyValue('--extension-token')`), '');
        assert.equal(await js("document.querySelectorAll('[data-theme-setting]').length"), 0, 'options only appear for active theme');
        await js(`(() => { const el = document.querySelector('[data-setting="theme"]');
          el.value = 'ext:demo:0'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await wait("getComputedStyle(document.documentElement).getPropertyValue('--selection') === '#abcdef'");
        await js(`[...document.querySelectorAll('.theme-options button')].find(el => el.textContent === 'Reset theme settings').click()`);
        await wait("getComputedStyle(document.documentElement).getPropertyValue('--selection') === '#123456'");
        await js(`(() => { const el = document.querySelector('[data-setting="theme"]');
          el.value = 'dark'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
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
        assert.equal(await js("JSON.parse(localStorage.getItem('tagline-extension:demo')).installRuns"), 1, 'install setup never repeats on reload');
        assert.equal(await js("JSON.parse(localStorage.getItem('tagline-extension:nosy')).installAttempts"), 2, 'successful install remains complete when disabled');
        assert.equal(await js("!!document.querySelector('.ribbon [data-ribbon-item=\"ext:demo.documents\"]')"), false,
          'removed extension shortcuts stay hidden after extension reload');
        await js(`[...document.querySelectorAll('.settings button')].find(el => el.textContent.trim() === 'Done').click()`);
        await palette('Demo: Flood messages');
        await toast('exceeded 200 messages');
        await wait(`!document.querySelector('iframe[data-extension="demo"]')`, 'flooding worker removed');
        console.log('Extension smoke test passed');
        app.exit(0);
      } catch (error) {
        console.error(error, await js(`JSON.stringify({ toast: document.querySelector('.toast')?.textContent, palette: !!document.querySelector('.palette'), ui: JSON.parse(localStorage.getItem('tagline-extension:demo') || '{}').uiReport, items: [...document.querySelectorAll('.palette-list > *')].map((el) => el.textContent).slice(0, 5) })`));
        app.exit(1);
      }
    });
  });
  require('../electron/main.cjs');
})().catch((error) => { console.error(error); app.exit(1); });
