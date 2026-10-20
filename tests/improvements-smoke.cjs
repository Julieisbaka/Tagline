const { app, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-improvements-'));
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
  const output = path.join(root, 'export.html');
  dialog.showSaveDialog = async (_window, options) => ({
    canceled: false, filePath: options.defaultPath.endsWith('.docx') ? path.join(root, 'converted.docx') : output,
  });
  dialog.showMessageBox = async () => ({ response: 0 });
  const font = process.platform === 'win32' ? path.join(process.env.WINDIR, 'Fonts', 'arial.ttf')
    : process.platform === 'darwin' ? '/System/Library/Fonts/Supplemental/Arial.ttf'
      : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [font] });
  const cleanup = async () => {
    for (let i = 0; i < 20; i++) {
      try { await fs.rm(root, { recursive: true, force: true }); return; }
      catch (e) { if (i === 19) throw e; await delay(100); }
    }
  };

  app.on('browser-window-created', (_event, win) => {
    win.webContents.once('did-finish-load', async () => {
      const wc = win.webContents;
      const js = (code) => wc.executeJavaScript(code).catch((e) => { throw new Error(`${e.message}\nScript: ${code}`); });
      wc.on('console-message', (event) => { if (event.level === 'error') console.error('Renderer:', event.message); });
      const wait = async (code) => {
        for (let i = 0; i < 120; i++) { if (await js(code)) return; await delay(100); }
        throw new Error('Timed out: ' + code);
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
        await click('.citation-dialog button', 'Insert citation');
        await wait("!document.querySelector('.citation-dialog')");
        await wait("document.querySelector('.visual-document').textContent.includes('Smith 2024')");
        assert.match(await js("document.querySelector('.status-bar').textContent"), /0:01/);

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
        await wait("[...document.fonts].some(f => f.family === 'Tagline Custom' && f.status === 'loaded')");
        const fontData = await js('window.api.readFont()');
        assert.ok(fontData.startsWith('data:font/ttf;base64,'));
        assert.equal(await js("getComputedStyle(document.querySelector('.visual-document')).fontFamily"), '"Tagline Custom"');
        await new Promise((resolve) => { wc.once('did-finish-load', resolve); wc.reload(); });
        await wait("[...document.fonts].some(f => f.family === 'Tagline Custom' && f.status === 'loaded')");
        await wait("!!document.querySelector('.visual-document')");
        await settings();
        assert.equal(await js("JSON.parse(localStorage.getItem('tagline-settings')).visualCacheEntries"), 0);
        assert.equal(await js("JSON.parse(localStorage.getItem('tagline-settings')).searchMaxResults"), 1);
        await click('.advanced-settings button', 'Reset font');

        // An explicit migration, not just enabling the checkbox, renames existing folders.
        assert.ok(await fs.stat(path.join(vault, 'Old Folder')));
        await js("void (window.confirm = () => true)");
        await click('.advanced-settings button', 'Auto migrate folders');
        await wait("![...document.querySelectorAll('.advanced-settings button')].some(b => b.textContent === 'Auto migrate folders')");
        const links = await fs.readFile(path.join(vault, 'Links.md'), 'utf8');
        assert.match(links, /\[\[Old_Folder\/Sub_Folder\/Nested#Nested\|alias\]\]/);
        assert.ok(await fs.stat(path.join(vault, 'Old_Folder', 'Sub_Folder', 'Nested.md')));
        assert.ok(await js("[...document.querySelectorAll('.tree-label')].some(e => e.textContent === 'Old Folder')"));
        assert.equal(await js("[...document.querySelectorAll('.tree-label')].some(e => e.textContent.includes('Old_Folder'))"), false);
        await click('.settings button', 'Done');
        // Cmd-compatible menu IPC reaches the same UI on all platforms.
        wc.send('menu:command', 'openSearch');
        await wait("!!document.querySelector('.modal.search')");
        await input('.search .palette-input', 'tag');
        assert.equal(await js("document.querySelectorAll('.search-result').length"), 1);
        console.log('PASS: safe embedded HTML/export, visual citation insertion/read time, settings limits, fonts, folder migration, menu IPC.');
        win.destroy();
        await cleanup();
        app.exit(0);
      } catch (e) {
        console.error('FAIL:', e.stack || e);
        win.destroy();
        await cleanup();
        app.exit(1);
      }
    });
  });
  require('../electron/main.cjs');
})();
