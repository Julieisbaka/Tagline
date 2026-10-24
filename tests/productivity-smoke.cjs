if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tagline-productivity-'));
  try {
    const result = spawnSync(require('electron'), [__filename], {
      env: { ...process.env, TAGLINE_PRODUCTIVITY_ROOT: root }, stdio: 'inherit', timeout: 120000,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
  return;
}

const { app, dialog, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const root = process.env.TAGLINE_PRODUCTIVITY_ROOT;
  if (!root) throw new Error('Run through npm run test:productivity.');
  const profile = path.join(root, 'profile');
  app.setPath('userData', profile);
  if (process.env.TAGLINE_SECONDARY) { require('../electron/main.cjs'); return; }
  const vault = path.join(root, 'Flow vault with spaces');
  const otherVault = path.join(root, 'Second vault');
  await fs.mkdir(profile, { recursive: true });
  await fs.mkdir(vault);
  await fs.mkdir(otherVault);
  await fs.writeFile(path.join(otherVault, 'Other.md'), '# Second vault note\n');
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [otherVault] });
  const flow = JSON.stringify({ version: 1, sheets: [{ name: 'Case', columns: ['1AC', '1NC'], rows: [['Argument', 'Reply']] }] });
  const cold = path.join(vault, 'Cold.flow');
  const warm = path.join(vault, 'Warm.flow');
  await fs.writeFile(cold, flow);
  await fs.writeFile(warm, flow);
  await fs.writeFile(path.join(vault, 'Card.md'), '#### A card\n\n**Smith 2024**\n\nSome evidence words.\n');
  await fs.writeFile(path.join(profile, 'config.json'), JSON.stringify({ modelAutoload: false }));
  process.argv.push(cold);
  app.on('browser-window-created', (_event, win) => {
    win.webContents.once('did-finish-load', async () => {
      const wc = win.webContents;
      const js = (code) => wc.executeJavaScript(code).catch((error) => {
        throw new Error(`${error.message}\nScript: ${code}`);
      });
      wc.on('console-message', (event) => { if (event.level === 'error') console.error('Renderer:', event.message); });
      const wait = async (code) => {
        for (let i = 0; i < 100; i++) { if (await js(code)) return; await delay(100); }
        throw new Error('Timed out: ' + code);
      };
      const click = async (selector, text) => {
        const found = await js(`(() => { const el=[...document.querySelectorAll(${JSON.stringify(selector)})]
          .find(el => el.textContent.trim()===${JSON.stringify(text)}); if(!el)return false; el.click(); return true; })()`);
        assert.equal(found, true, `Missing ${text}`);
      };
      const key = async (keyCode, modifiers = []) => {
        wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
        wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
        await delay(100);
      };
      const primary = process.platform === 'darwin' ? 'meta' : 'control';
      try {
        await js("window.addEventListener('error', e => console.error(e.error?.stack || e.message))");
        await wait("!!document.querySelector('.flow-grid') || !!document.querySelector('.flow-editor textarea')");
        assert.equal(await js("document.querySelector('.note-title').value"), 'Cold');
        await click('.tree-item', 'Card');
        await wait("!!document.querySelector('.visual-document')");
        ipcMain.removeHandler('citation:extract');
        ipcMain.handle('citation:extract', (_event, url) => {
          assert.equal(url, 'https://www.reuters.com/world/story-2024-01-20/');
          return require('../electron/citationMetadata.cjs').parseMetadata(
            '<meta name="author" content="Extracted Author"><meta property="og:title" content="Example story">', url);
        });
        await click('.note-actions button', 'Create citation');
        await wait("!!document.querySelector('.citation-dialog [name=author]')");
        await js(`(() => {
          for (const [selector,value] of [['[name=author]','Manual Author'],['[aria-label="Article URL"]','https://www.reuters.com/world/story-2024-01-20/']]) {
            const el=document.querySelector(selector);
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);
            el.dispatchEvent(new Event('input',{bubbles:true}));
          }
        })()`);
        await click('.citation-dialog button', 'Autofill from URL');
        await wait("document.querySelector('[name=title]').value === 'Example story'");
        assert.equal(await js("document.querySelector('[name=author]').value"), 'Manual Author');
        assert.equal(await js("document.querySelector('[name=year]').value"), '2024');
        assert.equal(await js("document.querySelector('[name=publication]').value"), 'Reuters');
        await click('.citation-dialog button', 'Cancel');
        await js("document.querySelector('.ribbon button:last-child').click()");
        await click('.settings-sidebar button', 'Appearance');
        const layout = await js(`(() => { const el=document.querySelector('.settings'); const r=el.getBoundingClientRect();
          return {top:r.top,bottom:r.bottom,height:innerHeight,overflow:el.scrollWidth>el.clientWidth,
            fileButton:getComputedStyle(document.querySelector('input[type=file]'),'::file-selector-button').borderStyle}; })()`);
        assert.ok(layout.top >= 0 && layout.bottom <= layout.height);
        assert.equal(layout.overflow, false);
        assert.equal(layout.fileButton, 'solid');
        await click('.settings-sidebar button', 'Keyboard shortcuts');
        await js("document.querySelector('[data-binding=highlight]').focus(); document.querySelector('[data-binding=highlight]').click()");
        await key('L', [primary, 'shift']);
        await wait("JSON.parse(localStorage.getItem('tagline-settings')).keybindings.highlight === 'Mod+Shift+L'");
        // Conflicts are surfaced instead of creating two commands for one key.
        await js("document.querySelector('[data-binding=highlight]').focus(); document.querySelector('[data-binding=highlight]').click()");
        await key('O', [primary]);
        assert.match(await js("document.querySelector('.keybinding-settings [role=alert]').textContent"), /already assigned/);
        await key('Escape');
        assert.equal(await js("!!document.querySelector('.settings')"), true);
        await js("document.querySelector('[data-binding=flow-row]').focus(); document.querySelector('[data-binding=flow-row]').click()");
        await key('Enter', [primary, 'alt']);
        await wait("JSON.parse(localStorage.getItem('tagline-settings')).keybindings['flow-row'] === 'Mod+Alt+Enter'");
        await js("document.querySelector('[data-binding=find]').focus(); document.querySelector('[data-binding=find]').click()");
        await key('K', [primary, 'shift']);
        await wait("JSON.parse(localStorage.getItem('tagline-settings')).keybindings.find === 'Mod+Shift+K'");
        await click('.settings button', 'Done');
        await click('.tree-item', 'Card');
        await wait("!!document.querySelector('.visual-document')");
        await js("document.querySelector('.visual-document').focus()");
        await key('A', [primary]);
        await key('L', [primary, 'shift']);
        await wait("!!document.querySelector('.visual-document mark')");
        await js("document.querySelector('.visual-document').focus()");
        await key('F', [primary]);
        assert.equal(await js("!!document.querySelector('.visual-find')"), false);
        await key('K', [primary, 'shift']);
        await wait("!!document.querySelector('.visual-find')");
        await key('Escape');
        await wait("!document.querySelector('.visual-find')");
        // Source mode uses the same remapped key.
        await js("const select=document.querySelector('.note-actions select'); select.value='edit'; select.dispatchEvent(new Event('change',{bubbles:true}))");
        await wait("!!document.querySelector('.cm-content')");
        await js("document.querySelector('.cm-content').focus()");
        const before = await js("document.querySelector('.cm-content').textContent");
        await key('A', [primary]);
        await key('L', [primary, 'shift']);
        await wait("document.querySelector('.cm-content')?.textContent.startsWith('==')");
        assert.notEqual(await js("document.querySelector('.cm-content').textContent"), before);
        await key('L', [primary, 'shift']);
        assert.equal(await js("document.querySelector('.cm-content').textContent"), before);
        await js("document.querySelector('.cm-content').focus()");
        await key('F', [primary]);
        assert.equal(await js("!!document.querySelector('.visual-find')"), false);
        await key('K', [primary, 'shift']);
        await wait("!!document.querySelector('.visual-find')");
        await key('Escape');
        await wait("!document.querySelector('.visual-find')");
        // Main-process menu labels update and removing a key survives a renderer reload.
        await js("document.querySelector('.ribbon button:last-child').click()");
        await click('.settings-sidebar button', 'Keyboard shortcuts');
        await js("document.querySelector('[data-binding=new-note]').focus(); document.querySelector('[data-binding=new-note]').click()");
        await key('Delete');
        await wait("JSON.parse(localStorage.getItem('tagline-settings')).keybindings['new-note'] === ''");
        await click('.settings button', 'Done');
        await new Promise((resolve) => { wc.once('did-finish-load', resolve); wc.reload(); });
        await wait("!!document.querySelector('.ribbon')");
        assert.equal(await js("JSON.parse(localStorage.getItem('tagline-settings')).keybindings.highlight"), 'Mod+Shift+L');
        // Add a vault once, then reopen the earlier vault directly from the saved list.
        await js("document.querySelector('.vault-switch').click()");
        await wait("!!document.querySelector('.vault-manager-dialog')");
        await click('.vault-manager-dialog button', 'Add existing or create vault…');
        await wait("!!document.querySelector('.tree-item[title=\"Other.md\"]')");
        assert.equal((await js('window.api.listRecentVaults()')).length, 2);
        await js("document.querySelector('.vault-switch').click()");
        await wait("!!document.querySelector('.vault-manager-dialog')");
        await js(`(() => [...document.querySelectorAll('.vault-manager-list li')]
          .find(item => item.querySelector('strong')?.textContent === 'Flow vault with spaces')
          .querySelector('button').click())()`);
        await wait("document.querySelectorAll('.tree-item').length >= 3");
        const recentVaults = await js('window.api.listRecentVaults()');
        assert.ok(recentVaults.some((item) => item.root === vault));
        await js("document.querySelector('.vault-switch').click()");
        await wait("!!document.querySelector('.vault-manager-dialog')");
        await js(`(() => [...document.querySelectorAll('.vault-manager-list li')]
          .find(item => item.querySelector('strong')?.textContent === 'Second vault')
          .querySelectorAll('button')[2].click())()`);
        await wait("window.api.listRecentVaults().then(items => items.length === 1)");
        assert.equal(await fs.stat(otherVault).then((info) => info.isDirectory()), true);
        await js("document.querySelector('.vault-manager-dialog .dialog-buttons button:last-child').click()");
        // An actual second Electron instance forwards .flow to the primary process.
        const secondary = spawn(process.execPath, [__filename, warm], {
          env: { ...process.env, TAGLINE_SECONDARY: '1' }, stdio: 'inherit',
        });
        const exit = new Promise((resolve, reject) => {
          secondary.once('error', reject);
          secondary.once('exit', (code) => code === 0 ? resolve() : reject(new Error('Secondary exited: ' + code)));
        });
        await wait("document.querySelector('.note-title')?.value === 'Warm'");
        await exit;
        await js("document.querySelector('.flow-grid textarea').focus()");
        await key('Enter', [primary]);
        assert.equal(await js("document.querySelectorAll('.flow-grid textarea').length"), 2);
        await key('Enter', [primary, 'alt']);
        await wait("document.querySelectorAll('.flow-grid textarea').length === 4");
        // Finder open-file delivery reuses the existing vault and window.
        app.emit('open-file', { preventDefault() { } }, cold);
        await wait("document.querySelector('.note-title')?.value === 'Cold'");
        console.log('PASS: citation autofill/preservation, settings layout/file styling, shortcut recording/conflicts/persistence, both editors, cold .flow launch, real second-instance handoff and Finder event.');
        app.exit(0);
      } catch (error) { console.error('FAIL:', error.stack); app.exit(1); }
    });
  });
  require('../electron/main.cjs');
})().catch((error) => { console.error(error); app.exit(1); });
