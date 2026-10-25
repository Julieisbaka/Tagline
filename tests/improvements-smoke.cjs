if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tagline-improvements-'));
  try {
    const result = spawnSync(require('electron'), [__filename], {
      env: { ...process.env, TAGLINE_IMPROVEMENTS_ROOT: root }, stdio: 'inherit', timeout: 120000,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
  return;
}

const { app, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const root = process.env.TAGLINE_IMPROVEMENTS_ROOT;
  if (!root) throw new Error('Run this test through Node or npm run test:improvements.');
  const vault = path.join(root, 'vault');
  const profile = path.join(root, 'profile');
  await fs.mkdir(path.join(vault, 'Old Folder', 'Sub Folder'), { recursive: true });
  await fs.mkdir(profile);
  await fs.writeFile(path.join(profile, 'config.json'), JSON.stringify({ lastVault: vault, modelAutoload: false }));
  if (process.env.TAGLINE_MODEL_CACHE) {
    await fs.cp(path.join(process.env.TAGLINE_MODEL_CACHE, 'models'), path.join(profile, 'semantic-search', 'models'), { recursive: true });
  }
  const html = '# HTML\n\n<details open><summary>Extra detail</summary><p>CO<sub>2</sub> and x<sup>2</sup></p></details>\n'
    + '<script>window.injected = true</script>\n<img src="x" onerror="window.injected = true">\n';
  await fs.writeFile(path.join(vault, 'HTML.md'), html);
  await fs.writeFile(path.join(vault, 'Card.md'), '# Cards\n\n#### Tag\n\n==Evidence words==\n');
  await fs.writeFile(path.join(vault, 'Old Folder', 'Sub Folder', 'Nested.md'), '# Nested\n[[Card]]');
  await fs.writeFile(path.join(vault, 'Links.md'), '[[Old Folder/Sub Folder/Nested#Nested|alias]]');
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  const output = path.join(root, 'export.html');
  dialog.showSaveDialog = async (_window, options) => ({
    canceled: false, filePath: options.defaultPath.endsWith('.docx') ? path.join(root, 'converted.docx') : output,
  });
  dialog.showMessageBox = async () => ({ response: 0 });
  const font = process.platform === 'win32' ? path.join(process.env.WINDIR, 'Fonts', 'arial.ttf')
    : process.platform === 'darwin' ? '/System/Library/Fonts/Supplemental/Arial.ttf'
      : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [font] });
  app.on('browser-window-created', (_event, win) => {
    win.webContents.once('did-finish-load', async () => {
      const wc = win.webContents;
      const js = (code) => wc.executeJavaScript(code).catch((e) => { throw new Error(`${e.message}\nScript: ${code}`); });
      wc.on('console-message', (event) => { if (event.level === 'error') console.error('Renderer:', event.message); });
      const wait = async (code) => {
        for (let i = 0; i < 120; i++) { if (await js(code)) return; await delay(100); }
        throw new Error('Timed out: ' + code + '\nFonts: ' + JSON.stringify(await js(
          "[...document.fonts].map(f => ({ family: f.family, status: f.status }))")));
      };
      const click = (selector, text) => js(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.trim() === ${JSON.stringify(text)});
        if (!el) throw new Error('Missing button ' + ${JSON.stringify(text)}); el.click();
      })()`);
      const input = (selector, value) => js(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      const mode = (value) => js(`(() => { const el = document.querySelector('.note-actions select');
        el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      const settings = async () => {
        await js("document.querySelector('.ribbon button:last-child').click()");
        await wait("!!document.querySelector('.advanced-settings')");
      };
      try {
        await wait("!!document.querySelector('.onboarding-skip')");
        await js("document.querySelector('.onboarding-skip').click()");
        await wait("document.querySelectorAll('.tree-item').length >= 4");
        await click('.tree-item', 'HTML');
        await wait("!!document.querySelector('.source-fallback')");
        assert.equal(await js("!!document.querySelector('.visual-document')"), false);
        await mode('read');
        await wait("!!document.querySelector('.preview details summary')");
        assert.equal(await js("document.querySelector('.preview sub').textContent"), '2');
        assert.equal(await js("!!document.querySelector('.preview script, .preview [onerror]')"), false);
        assert.equal(await js("!!window.injected"), false);
        await click('.note-actions button', 'Export');
        await wait("!!document.querySelector('.export-dialog')");
        await click('.export-dialog button', 'Save export');
        await delay(300);
        const exported = await fs.readFile(output, 'utf8');
        assert.match(exported, /<details open/);
        assert.match(exported, /<sub>2<\/sub>/);
        assert.doesNotMatch(exported, /<script|onerror/);
        const pandoc = await js('window.api.pandocStatus()');
        if (pandoc.available) {
          await js(`window.api.exportDocument({ title: 'HTML', format: 'docx', html: ${JSON.stringify(exported)} })`);
          const { importDocument } = require('../electron/documents.cjs');
          const imported = await importDocument(pandoc.executable, path.join(root, 'converted.docx'));
          assert.match(imported.markdown, /CO/);
          assert.match(imported.markdown, /Extra detail/);
          console.log('PASS: real Pandoc HTML -> DOCX -> Markdown conversion.');
        } else console.log('NOT TESTED: real Pandoc conversion (Pandoc is not installed).');
        await js("document.querySelector('.modal-backdrop').click()");

        await click('.tree-item', 'Card');
        await wait("!!document.querySelector('.visual-document')");
        await js("document.querySelector('.visual-document').editor.commands.setTextSelection(12)");
        await click('.note-actions button', 'Create citation');
        await wait("!!document.querySelector('.citation-dialog')");
        await input('[name=author]', 'Smith');
        await input('[name=year]', '2024');
        await input('[name=title]', 'A study');
        assert.equal(await js("document.querySelector('[name=accessed]').type"), 'text', 'no native date control remains');
        await input('[name=accessed]', '2024-01-31');
        await click('.date-picker button', 'Calendar');
        await wait("document.activeElement.dataset.date === '2024-01-31'");
        await js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true }))");
        await wait("document.activeElement.dataset.date === '2024-02-29'");
        await js("document.activeElement.click()");
        await wait("!document.querySelector('.date-picker-calendar')");
        assert.equal(await js("document.querySelector('[name=accessed]').value"), '2024-02-29');
        assert.equal(await js("document.activeElement.getAttribute('aria-label')"), 'Choose date');
        await click('.date-picker button', 'Calendar');
        await wait("!!document.querySelector('.date-picker-calendar')");
        await js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))");
        await wait("document.activeElement.dataset.date === '2024-03-01'");
        await js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))");
        await wait("!document.querySelector('.date-picker-calendar')");
        assert.ok(await js("!!document.querySelector('.citation-dialog')"), 'Escape closes the calendar, not the citation dialog');
        assert.equal(await js("document.querySelector('[name=accessed]').value"), '2024-02-29', 'navigation without selection does not change the value');
        await click('.date-picker button', 'Calendar');
        await click('.date-picker-actions button', 'Clear');
        assert.equal(await js("document.querySelector('[name=accessed]').value"), '');
        await click('.date-picker button', 'Calendar');
        await click('.date-picker-actions button', 'Today');
        assert.equal(await js("document.querySelector('[name=accessed]').value"), await js(`(() => {
          const now = new Date();
          return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
        })()`));
        await input('[name=accessed]', '2023-02-29');
        await click('.citation-dialog button', 'Copy citation');
        await wait("document.querySelector('.citation-dialog [role=alert]')?.textContent.includes('valid date')");
        await input('[name=accessed]', '2024-02-29');
        await click('.date-picker button', 'Calendar');
        assert.equal(await js(`(() => {
          const calendar = document.querySelector('.date-picker-calendar');
          const probe = document.createElement('span');
          probe.style.backgroundColor = 'var(--bg-elevated)';
          calendar.append(probe);
          const matches = getComputedStyle(calendar).backgroundColor === getComputedStyle(probe).backgroundColor;
          probe.remove();
          return matches;
        })()`), true, 'calendar uses theme tokens');
        await js("document.querySelector('[name=author]').focus()");
        await wait("!document.querySelector('.date-picker-calendar')");
        await click('.citation-dialog button', 'Insert citation');
        await wait("!document.querySelector('.citation-dialog')");
        await wait("document.querySelector('.visual-document').textContent.includes('Smith 2024')");
        assert.ok(await js("document.querySelector('.visual-document').textContent.includes('Accessed 2024-02-29')"));
        // The spoken year adds several syllables; a word-only estimate was 0:01.
        await wait("document.querySelector('.status-bar').textContent.includes('2 highlighted (~0:02 read)')");

        await settings();
        const status = await js('window.api.embeddingStatus()');
        assert.equal(status.autoload, false);
        assert.equal(status.ready, false);
        assert.equal(status.downloaded, !!process.env.TAGLINE_MODEL_CACHE);
        const modelButton = status.downloaded ? 'Load model' : 'Download model';
        await wait(`[...document.querySelectorAll('.integration-settings button')].some(b => b.textContent === '${modelButton}')`);
        await input('[data-setting=visualCacheEntries]', '0');
        await input('[data-setting=visualCacheCharacters]', '1000');
        await input('[data-setting=searchMaxResults]', '1');
        await click('.advanced-settings button', 'Import font file');
        await wait("JSON.parse(localStorage.getItem('tagline-settings')).importedFont > 0");
        await wait("[...document.fonts].some(f => f.family.replaceAll('\"', '') === 'Tagline Custom' && f.status === 'loaded')");
        const fontData = await js('window.api.readFont()');
        assert.ok(fontData.startsWith('data:font/ttf;base64,'));
        assert.equal(await js("getComputedStyle(document.querySelector('.visual-document')).fontFamily"), '"Tagline Custom"');
        await new Promise((resolve) => { wc.once('did-finish-load', resolve); wc.reload(); });
        await wait("[...document.fonts].some(f => f.family.replaceAll('\"', '') === 'Tagline Custom' && f.status === 'loaded')");
        await wait("!!document.querySelector('.visual-document')");
        await settings();
        assert.equal(await js("JSON.parse(localStorage.getItem('tagline-settings')).visualCacheEntries"), 0);
        assert.equal(await js("JSON.parse(localStorage.getItem('tagline-settings')).searchMaxResults"), 1);
        await click('.advanced-settings button', 'Reset font');

        // Existing folders and links remain unchanged; no migration action is offered.
        assert.equal(await js("[...document.querySelectorAll('.advanced-settings button')].some(b => b.textContent === 'Auto migrate folders')"), false);
        const links = await fs.readFile(path.join(vault, 'Links.md'), 'utf8');
        assert.equal(links, '[[Old Folder/Sub Folder/Nested#Nested|alias]]');
        assert.ok(await fs.stat(path.join(vault, 'Old Folder', 'Sub Folder', 'Nested.md')));
        assert.ok(await js("[...document.querySelectorAll('.tree-label')].some(e => e.textContent === 'Old Folder')"));
        assert.equal(await js("[...document.querySelectorAll('.tree-label')].some(e => e.textContent.includes('Old_Folder'))"), false);
        await click('.settings button', 'Done');
        const createFolder = async (name, displayed = name) => {
          await js("document.querySelector('.sidebar-header [title=\"New folder\"]').click()");
          await wait("!!document.querySelector('.dialog input')");
          await input('.dialog input', name);
          await click('.dialog button', 'OK');
          await wait(`!![...document.querySelectorAll('.tree-label')].find(e => e.textContent === ${JSON.stringify(displayed)})`);
        };
        await createFolder('New Folder');
        assert.ok(await fs.stat(path.join(vault, 'New_Folder')));
        await createFolder('New Folder', 'New Folder 1');
        assert.ok(await fs.stat(path.join(vault, 'New_Folder_1')));
        await settings();
        await js("document.querySelector('[data-setting=underscoreFolders]').click()");
        await click('.settings button', 'Done');
        await createFolder('Literal Folder');
        assert.ok(await fs.stat(path.join(vault, 'Literal Folder')));
        await createFolder('Literal Folder', 'Literal Folder 1');
        assert.ok(await fs.stat(path.join(vault, 'Literal Folder 1')));
        // With the setting off, the explorer shows on-disk underscores verbatim.
        await wait("[...document.querySelectorAll('.tree-label')].some(e => e.textContent === 'Old Folder')");
        await wait("[...document.querySelectorAll('.tree-label')].some(e => e.textContent === 'New_Folder')");
        assert.ok(await fs.stat(path.join(vault, 'Old Folder', 'Sub Folder', 'Nested.md')));
        assert.equal(await fs.readFile(path.join(vault, 'Links.md'), 'utf8'), links);
        // Disabling model autoload survives in the main-process config.
        if (process.env.TAGLINE_MODEL_CACHE) {
          await js('window.api.setModelAutoload(true)');
          assert.equal((await js('window.api.embeddingStatus()')).ready, true);
          await js('window.api.setModelAutoload(false)');
        }
        assert.equal(JSON.parse(await fs.readFile(path.join(profile, 'config.json'), 'utf8')).modelAutoload, false);
        // Cmd-compatible menu IPC reaches the same UI on all platforms.
        wc.send('menu:command', 'openSearch');
        await wait("!!document.querySelector('.modal.search')");
        await input('.search .palette-input', 'tag');
        assert.equal(await js("document.querySelectorAll('.search-result').length"), 1);
        console.log('PASS: safe embedded HTML/export, visual citation insertion/read time, settings limits, fonts, unchanged existing folders, menu IPC.');
        app.exit(0);
      } catch (e) {
        console.error('FAIL:', e.stack || e);
        app.exit(1);
      }
    });
  });
  require('../electron/main.cjs');
})();
