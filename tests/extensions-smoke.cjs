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

const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DEMO = `
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
  await fs.writeFile(path.join(ext('demo'), 'manifest.json'), JSON.stringify({
    manifestVersion: 1, id: 'demo', name: 'Demo', version: '1.0.0', description: 'Smoke test extension',
    main: 'main.js', permissions: ['editor', 'vault:read', 'vault:write'],
    contributes: {
      commands: [{ id: 'stamp', title: 'Stamp note', key: 'Mod+Alt+K' }, { id: 'index', title: 'Build index' },
        { id: 'escape', title: 'Try escaping', key: 'Mod+N' }, { id: 'spin', title: 'Spin forever' },
        { id: 'flood', title: 'Flood messages' }, { id: 'pending', title: 'Pending limit' }],
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
  await fs.writeFile(path.join(profile, 'config.json'), JSON.stringify({
    modelAutoload: false, lastVault: vault, enabledExtensions: ['demo', 'nosy'],
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
          await js(`document.querySelector('.palette input').dispatchEvent(new KeyboardEvent('keydown', { key: '${found ? 'Enter' : 'Escape'}', bubbles: true }))`);
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
        await toast('Demo: undefined,undefined,no-storage,no-dom,no-network');

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

        await js(`[...document.querySelectorAll('.tree-item')].find((el) => el.textContent.trim() === 'Card').click()`);
        await wait(`!!document.querySelector('.ProseMirror')`, 'visual editor');
        await js(`document.querySelector('.ProseMirror').focus()`);
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: [process.platform === 'darwin' ? 'meta' : 'control', 'alt'] });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'K', modifiers: [process.platform === 'darwin' ? 'meta' : 'control', 'alt'] });
        await wait(`document.querySelector('.ProseMirror').textContent.includes('Stamped Card.md')`, 'stamped text');

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
