if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tagline-settings-'));
  try {
    const result = spawnSync(require('electron'), [__filename], {
      env: { ...process.env, TAGLINE_SETTINGS_ROOT: root }, stdio: 'inherit', timeout: 120000,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
  return;
}

const { app, shell, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const root = process.env.TAGLINE_SETTINGS_ROOT;
  if (!root) throw new Error('Run through npm run test:settings.');
  const profile = path.join(root, 'profile');
  const vault = path.join(root, 'vault');
  const otherVault = path.join(root, 'other-vault');
  await fs.mkdir(profile, { recursive: true });
  await fs.mkdir(vault);
  await fs.mkdir(otherVault);
  await fs.writeFile(path.join(otherVault, 'Other.md'), '# Other\n');
  await fs.writeFile(path.join(vault, 'Alpha.md'), '# Alpha\n\n[[Beta]]\n');
  await fs.writeFile(path.join(vault, 'Beta.md'), '# Beta\n\n==Evidence==\n');
  await fs.writeFile(path.join(vault, 'Links.md'), '[[Beta#Beta|alias]]');
  await fs.writeFile(path.join(profile, 'config.json'), JSON.stringify({ lastVault: vault, modelAutoload: false }));
  app.setPath('userData', profile);
  // Keep deletion local to this temporary test vault rather than using the OS trash.
  shell.trashItem = async (file) => fs.rm(file);
  app.on('browser-window-created', (_event, win) => {
    win.webContents.once('did-finish-load', async () => {
      const wc = win.webContents;
      const js = (code) => wc.executeJavaScript(code).catch((error) => {
        throw new Error(`${error.message}\nScript: ${code}`);
      });
      const wait = async (code) => {
        for (let i = 0; i < 100; i++) { if (await js(code)) return; await delay(100); }
        throw new Error('Timed out: ' + code + '\nCSS: ' + JSON.stringify(await js(`({
          saved: JSON.parse(localStorage.getItem('tagline-settings')),
          style: document.querySelector('#tagline-custom-css')?.textContent,
          outline: getComputedStyle(document.querySelector('.sidebar')).outline,
          draft: document.querySelector('[aria-label="CSS source"]')?.value
        })`)));
      };
      const click = (selector) => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
      const button = (selector, text) => js(`(() => {
        const item = [...document.querySelectorAll(${JSON.stringify(selector)})].find(el => el.textContent.trim() === ${JSON.stringify(text)});
        if (!item) throw new Error('Missing button: ' + ${JSON.stringify(text)});
        item.click();
      })()`);
      const input = (selector, value, type = 'HTMLInputElement') => js(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        Object.getOwnPropertyDescriptor(${type}.prototype, 'value').set.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      const open = async (file) => {
        await js(`document.querySelector('.tree-item[title=${JSON.stringify(file)}]').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))`);
        await wait(`document.querySelector('.tab.active')?.getAttribute('title') === ${JSON.stringify(file)}`);
      };
      const settings = async (section = 'files') => {
        await click('.ribbon button:last-child');
        await wait("!!document.querySelector('.settings')");
        await click(`[data-section="${section}"]`);
      };
      const done = () => button('.settings button', 'Done');
      const toggle = async (key, value) => {
        const checked = await js(`document.querySelector('[data-setting="${key}"]').checked`);
        if (checked !== value) await click(`[data-setting="${key}"]`);
        await wait(`JSON.parse(localStorage.getItem('tagline-settings')).${key} === ${value}`);
      };
      const reload = async () => {
        await new Promise((resolve) => { wc.once('did-finish-load', resolve); wc.reload(); });
        await wait("!!document.querySelector('.file-tree')");
      };
      const rename = async (from, to) => {
        await js(`document.querySelector('.tree-item[title=${JSON.stringify(from)}]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))`);
        await button('.context-menu button', 'Rename…');
        await input('.dialog input', to);
        await button('.dialog button', 'OK');
        await wait(`!!document.querySelector('.tree-item[title=${JSON.stringify(to + '.md')}]')`);
      };
      try {
        await wait("document.querySelectorAll('.tree-item').length === 3");
        await open('Alpha.md');
        await open('Beta.md');
        await settings();
        await toggle('showMarkdownExtension', true);
        await done();
        assert.equal(await js("document.querySelector('.tree-item[title=\"Alpha.md\"] .tree-label').textContent"), 'Alpha.md');
        assert.equal(await js("document.querySelector('.tab[title=\"Beta.md\"] .tab-label').textContent"), 'Beta.md');
        await settings();
        await toggle('showMarkdownExtension', false);
        await toggle('autoRelink', false);
        await done();
        await rename('Beta.md', 'Gamma');
        assert.equal(await fs.readFile(path.join(vault, 'Alpha.md'), 'utf8'), '# Alpha\n\n[[Beta]]\n');
        assert.equal(await fs.readFile(path.join(vault, 'Links.md'), 'utf8'), '[[Beta#Beta|alias]]');
        await settings();
        await toggle('autoRelink', true);
        await done();
        await rename('Gamma.md', 'Beta');
        await rename('Beta.md', 'Gamma');
        assert.match(await fs.readFile(path.join(vault, 'Alpha.md'), 'utf8'), /\[\[Gamma\]\]/);
        assert.match(await fs.readFile(path.join(vault, 'Links.md'), 'utf8'), /\[\[Gamma#Beta\|alias\]\]/);
        await wait("document.querySelector('.tab.active')?.getAttribute('title') === 'Gamma.md'");

        // Opt out of automatic tab cleanup, then remove and restore the active file externally.
        await settings();
        await toggle('closeMissingTabs', false);
        await done();
        const gamma = await fs.readFile(path.join(vault, 'Gamma.md'), 'utf8');
        await fs.unlink(path.join(vault, 'Gamma.md'));
        await click('.sidebar-header button[title="Refresh"]');
        await wait("document.querySelector('.empty-workspace')?.textContent.includes('no longer in the vault')");
        assert.equal(await js("!!document.querySelector('.tab[title=\"Gamma.md\"]')"), true);
        await fs.writeFile(path.join(vault, 'Gamma.md'), gamma);
        await button('.empty-workspace button', 'Reload vault');
        await wait("document.querySelector('.note-title')?.value === 'Gamma'");

        // Disabling persistence leaves its old snapshot untouched across reload and restores it on enable.
        await settings();
        await toggle('persistWorkspaceTabs', false);
        await done();
        const savedWorkspace = await js("Object.entries(localStorage).find(([key]) => key.startsWith('tabs:'))[1]");
        await click('.tab[title="Alpha.md"] .tab-close');
        await delay(150);
        assert.equal(await js("Object.entries(localStorage).find(([key]) => key.startsWith('tabs:'))[1]"), savedWorkspace);

        // Temporary tabs must not leak between vaults or create new persisted snapshots.
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [otherVault] });
        await click('.vault-switch');
        await wait(`document.querySelector('.sidebar-footer')?.title === ${JSON.stringify(otherVault)}`);
        await wait("document.querySelectorAll('.tab').length === 0");
        await wait("!!document.querySelector('.tree-item[title=\"Other.md\"]')");
        await open('Other.md');
        assert.equal(await js(`localStorage.getItem(${JSON.stringify('tabs:' + otherVault)})`), null);
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [vault] });
        await click('.vault-switch');
        await wait(`document.querySelector('.sidebar-footer')?.title === ${JSON.stringify(vault)}`);
        await wait("document.querySelectorAll('.tab').length === 0");

        await settings('appearance');
        const css = '@media (min-width: 1px) { .sidebar { outline: 7px solid rgb(1, 2, 3) !important; } }';
        await input('[aria-label="CSS source"]', css, 'HTMLTextAreaElement');
        await wait(`document.querySelector('[aria-label="CSS source"]').value === ${JSON.stringify(css)}`);
        await button('.custom-css-settings button', 'Apply CSS');
        await wait(`JSON.parse(localStorage.getItem('tagline-settings')).customCss === ${JSON.stringify(css)}`);
        assert.equal(await js("!!document.querySelector('#tagline-custom-css')"), false);
        await js('window.confirm = () => false; true');
        await click('[data-setting="customCssEnabled"]');
        assert.equal(await js("document.querySelector('[data-setting=\"customCssEnabled\"]').checked"), false);
        await js('window.confirm = () => true; true');
        await toggle('customCssEnabled', true);
        // Chromium rounds CSS border/outline widths to device pixels under Windows display scaling.
        await wait("Math.abs(parseFloat(getComputedStyle(document.querySelector('.sidebar')).outlineWidth) - 7) < 1");
        assert.equal(await js("getComputedStyle(document.querySelector('.sidebar')).outlineColor"), 'rgb(1, 2, 3)');
        await input('[aria-label="CSS source"]', '.sidebar { outline-width: 12px !important; }', 'HTMLTextAreaElement');
        assert.ok(await js("Math.abs(parseFloat(getComputedStyle(document.querySelector('.sidebar')).outlineWidth) - 7) < 1"));
        await button('.custom-css-settings button', 'Discard CSS edits');
        assert.equal(await js("document.querySelector('[aria-label=\"CSS source\"]').value"), css);
        await done();
        await reload();
        await wait("document.querySelectorAll('.tab').length === 0");
        assert.ok(await js("Math.abs(parseFloat(getComputedStyle(document.querySelector('.sidebar')).outlineWidth) - 7) < 1"));
        assert.equal(await js("Object.entries(localStorage).find(([key]) => key.startsWith('tabs:'))[1]"), savedWorkspace);
        await settings();
        await toggle('persistWorkspaceTabs', true);
        await done();
        await wait("document.querySelectorAll('.tab').length === 2");
        assert.equal(await js("document.querySelector('.tab.active').getAttribute('title')"), 'Gamma.md');
        await settings('appearance');
        await js(`(() => {
          const data = new DataTransfer();
          data.items.add(new File(['.sidebar { outline: 9px solid blue !important; }'], 'custom.css', {type: 'text/css'}));
          const el = document.querySelector('[aria-label="Import CSS file"]');
          el.files = data.files; el.dispatchEvent(new Event('change', {bubbles: true}));
        })()`);
        await wait("document.querySelector('[aria-label=\"CSS source\"]').value.includes('9px')");
        await button('.custom-css-settings button', 'Apply CSS');
        await wait("Math.abs(parseFloat(getComputedStyle(document.querySelector('.sidebar')).outlineWidth) - 9) < 1");
        assert.equal(await js("getComputedStyle(document.querySelector('.sidebar')).outlineColor"), 'rgb(0, 0, 255)');
        await toggle('customCssEnabled', false);
        assert.equal(await js("!!document.querySelector('#tagline-custom-css')"), false);
        await button('.custom-css-settings button', 'Reset custom CSS');
        await wait("document.querySelector('[aria-label=\"CSS source\"]').value === ''");
        await done();

        // Re-enabling cleanup prunes the active missing tab and activates a remaining tab.
        await settings();
        await toggle('closeMissingTabs', true);
        await done();
        await fs.unlink(path.join(vault, 'Gamma.md'));
        await click('.sidebar-header button[title="Refresh"]');
        await wait("!document.querySelector('.tab[title=\"Gamma.md\"]')");
        await wait("document.querySelector('.note-title')?.value === 'Alpha'");
        // In-app deletion still closes tabs when automatic external cleanup is disabled.
        await settings();
        await toggle('closeMissingTabs', false);
        await done();
        await js('window.confirm = () => true; true');
        await js("document.querySelector('.tree-item[title=\"Alpha.md\"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))");
        await button('.context-menu button', 'Delete');
        await wait("!document.querySelector('.tab[title=\"Alpha.md\"]')");
        console.log('PASS: extension labels, configurable relinking, retained/restored missing tabs, active-tab pruning, dormant workspace persistence, custom CSS editing/import/opt-in/reload/reset.');
        app.exit(0);
      } catch (error) { console.error('FAIL:', error.stack); app.exit(1); }
    });
  });
  require('../electron/main.cjs');
})().catch((error) => { console.error(error); app.exit(1); });
