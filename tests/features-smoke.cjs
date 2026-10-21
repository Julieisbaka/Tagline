const { app, dialog, Menu } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { promisify } = require('node:util');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'debate-features-'));
  const vault = path.join(temp, 'vault');
  const userData = path.join(temp, 'userData');
  await fs.mkdir(vault);
  await fs.mkdir(userData);
  const source = '# Cards\n\n#### Evidence\n**Author**\n++Warrant++ and ==read this==.\n\n[[Other]]\n';
  const flow = { version: 1, sheets: [{ name: 'Case', columns: ['1AC', '1NC'], rows: [['Argument', 'Reply']] }] };
  await fs.writeFile(path.join(vault, 'Cards.md'), source);
  await fs.writeFile(path.join(vault, 'Other.md'), '# Other');
  await fs.writeFile(path.join(vault, 'Round.flow'), JSON.stringify(flow));
  await fs.writeFile(path.join(userData, 'config.json'), JSON.stringify({ lastVault: vault }));
  app.setPath('userData', userData);
  let pandocAvailable = false;
  let importFails = false;
  const realExec = childProcess.execFile;
  childProcess.execFile = (exe, args, options, callback) => {
    if (args[0] === '--version' || args.some((a) => a === '--from=docx')) {
      setImmediate(() => {
        if (!pandocAvailable) return callback(Object.assign(new Error('Not found'), { code: 'ENOENT' }));
        if (importFails && args[0] !== '--version') return callback(new Error('Document conversion failed'));
        callback(null, args[0] === '--version' ? 'pandoc 3.6\nMock executable'
          : '# Imported document\n\n**A citation**\n\nEvidence from DOCX.', '');
      });
      return {};
    }
    return realExec(exe, args, options, callback);
  };
  childProcess.execFile[promisify.custom] = (exe, args, options) => new Promise((resolve, reject) => {
    childProcess.execFile(exe, args, options, (error, stdout, stderr) =>
      error ? reject(error) : resolve({ stdout, stderr }));
  });
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(temp, 'note.html') });
  const original = path.join(temp, 'Source.docx');
  await fs.writeFile(original, 'untouched source');
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [original] });
  const nativeMenus = [];
  const buildMenu = Menu.buildFromTemplate.bind(Menu);
  Menu.buildFromTemplate = (template) => {
    const menu = buildMenu(template);
    menu.popup = () => nativeMenus.push(template.map((item) => item.role));
    return menu;
  };

  app.on('browser-window-created', (_event, win) => {
    win.webContents.once('did-finish-load', async () => {
      const wc = win.webContents;
      const errors = [];
      wc.on('console-message', (e) => { if (e.level === 'error') errors.push(e.message); });
      const js = (s) => wc.executeJavaScript(s);
      const wait = async (s) => {
        for (let i = 0; i < 100; i++) { if (await js(s)) return; await delay(100); }
        throw new Error('Timed out: ' + s);
      };
      const click = (selector, text) => js(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.trim() === ${JSON.stringify(text)});
        if (!el) throw new Error('Missing ' + ${JSON.stringify(text)}); el.click();
      })()`);
      const select = async (selector, value) => {
        await js(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
          el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await delay(150);
      };
      const settings = async () => {
        await js("document.querySelector('.ribbon button:last-child').click()");
        await wait("!!document.querySelector('.settings')");
      };
      try {
        await wait("document.querySelectorAll('.tree-item').length === 3");
        assert.equal(await js("document.querySelectorAll('[title=\"Settings (Ctrl+,)\"], [title=\"Settings\"]').length"), 1);
        await click('.tree-item', 'Round');
        await wait("!!document.querySelector('.flow-grid textarea')");
        const addKey = async (row, col) => {
          await js(`document.querySelector('[data-row="${row}"][data-column="${col}"]').focus()`);
          wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter', modifiers: ['control'] });
          wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter', modifiers: ['control'] });
          await delay(200);
        };
        await addKey(0, 1);
        assert.deepEqual(await js("({ row: document.activeElement.dataset.row, column: document.activeElement.dataset.column })"),
          { row: '1', column: '1' });
        assert.equal(await js("document.querySelectorAll('.flow-grid tbody tr').length"), 2);
        await settings();
        await js("document.querySelector('[data-setting=\"focusNewFlowRow\"]').click()");
        await click('.settings button', 'Done');
        await addKey(1, 0);
        assert.equal(await js("document.activeElement.dataset.row"), '1');
        assert.equal(await js("document.querySelectorAll('.flow-grid tbody tr').length"), 3);
        // Context menus on cells and sheets, including keyboard dismissal.
        await js(`document.querySelector('.flow-grid textarea').dispatchEvent(new MouseEvent('contextmenu',
          { bubbles: true, clientX: innerWidth - 2, clientY: innerHeight - 2 }))`);
        await wait("!!document.querySelector('[role=menu]')");
        assert.equal(await js("document.querySelectorAll('[role=menuitem]').length"), 3);
        assert.ok(await js("document.querySelector('[role=menu]').getBoundingClientRect().right <= innerWidth"));
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        await wait("!document.querySelector('[role=menu]')");
        await js(`document.querySelector('.flow-sheet-tab').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))`);
        await click('[role=menuitem]', 'Rename sheet');
        await wait("!!document.querySelector('.flow-sheet-input')");
        await js("document.querySelector('.flow-sheet-input').blur()");
        await click('.tree-item', 'Cards');
        await wait("!!document.querySelector('.visual-document')");
        const editorPoint = await js(`(() => { const r = document.querySelector('.visual-document').getBoundingClientRect();
          return { x: Math.round(r.x + 40), y: Math.round(r.y + 30) }; })()`);
        wc.sendInputEvent({ type: 'mouseDown', ...editorPoint, button: 'right', clickCount: 1 });
        wc.sendInputEvent({ type: 'mouseUp', ...editorPoint, button: 'right', clickCount: 1 });
        await delay(250);
        assert.ok(nativeMenus.some((roles) => roles.includes('paste') && roles.includes('undo')),
          'Editable text must expose native clipboard and undo commands');
        // Cache hits must avoid Markdown parsing even across editor remounts.
        await js(`(() => { const proto = Object.getPrototypeOf(document.querySelector('.visual-document').editor.markdown);
          const original = proto.parse; window.parseCount = 0;
          proto.parse = function(...args) { window.parseCount++; return original.apply(this, args); };
        })()`);
        await select('[aria-label="Editor mode"]', 'read');
        await select('[aria-label="Editor mode"]', 'visual');
        await wait("!!document.querySelector('.visual-document')");
        assert.equal(await js("window.parseCount"), 0, 'Unchanged Markdown should use the parsed-document cache');
        await select('[aria-label="Editor mode"]', 'edit');
        await js("document.querySelector('.cm-content').focus()");
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'End', modifiers: ['control'] });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'End', modifiers: ['control'] });
        await wc.insertText('\n\nChanged in source.');
        await select('[aria-label="Editor mode"]', 'visual');
        await wait("!!document.querySelector('.visual-document')");
        assert.equal(await js("window.parseCount"), 1, 'Changed source must invalidate the cached document');
        assert.match(await js("document.querySelector('.visual-document').textContent"), /Changed in source/);
        // No Pandoc: HTML export remains enabled and produces a standalone, formatted file.
        assert.equal((await js('window.api.pandocStatus()')).available, false);
        await click('.note-actions button', 'Export');
        await click('.export-dialog button', 'Save export');
        await wait("document.querySelector('.export-dialog [role=status]')?.textContent.includes('Exported')");
        const html = await fs.readFile(path.join(temp, 'note.html'), 'utf8');
        assert.match(html, /<!doctype html>/i);
        assert.match(html, /<title>Cards<\/title>/);
        assert.match(html, /<mark>read this<\/mark>/);
        assert.match(html, /<u>Warrant<\/u>/);
        assert.doesNotMatch(html, /<script|<img|data-href/);
        await click('.export-dialog button', 'Close');
        // Real themes all apply through the same token API, and locale changes update live.
        await settings();
        await js("document.querySelector('[data-section=appearance]').click()");
        for (const id of ['light', 'high-contrast-dark', 'high-contrast-light', 'dark']) {
          await select('[data-setting="theme"]', id);
          assert.equal(await js("document.documentElement.dataset.theme"), id);
        }
        await select('[data-setting="language"]', 'es');
        assert.equal(await js("document.documentElement.lang"), 'es');
        assert.equal(await js("document.querySelector('.settings-header h2').textContent"), 'Apariencia');
        await select('[data-setting="language"]', 'fr');
        assert.equal(await js("document.querySelector('.settings-header h2').textContent"), 'Apparence');
        if (process.env.TAGLINE_FEATURE_SCREENSHOT) {
          await select('[data-setting="theme"]', 'high-contrast-light');
          win.show();
          win.focus();
          await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
          await fs.writeFile(process.env.TAGLINE_FEATURE_SCREENSHOT, (await wc.capturePage()).toPNG());
        }
        await select('[data-setting="language"]', 'en');
        const injectTheme = async (colors) => {
          await js(`(() => { const data = new DataTransfer(); data.items.add(new File([
            JSON.stringify({ version: 1, name: 'Test custom', mode: 'dark', colors: ${JSON.stringify(colors)} })
          ], 'theme.json', { type: 'application/json' }));
          const input = document.querySelector('input[type=file]'); input.files = data.files;
          input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
          await delay(200);
        };
        await injectTheme({ accent: 'url(https://not-allowed)' });
        assert.match(await js("document.querySelector('.settings [role=alert]').textContent"), /Invalid color/);
        await injectTheme({ accent: '#abcdef' });
        assert.equal(await js("document.documentElement.style.getPropertyValue('--accent')"), '#abcdef');
        assert.deepEqual(await js(`(() => { const settings = JSON.parse(localStorage.getItem('tagline-settings'));
          return { focus: settings.focusNewFlowRow, language: settings.language, theme: settings.theme }; })()`),
          { focus: false, language: 'en', theme: 'custom' });
        await click('.settings button', 'Done');
        // Tab context menus close other tabs without closing the selected one.
        await js("document.querySelector('.tab').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))");
        await click('[role=menuitem]', 'Close other tabs');
        assert.equal(await js("document.querySelectorAll('.tab').length"), 1);
        // Import uses the real IPC and dialog pipeline with a stubbed Pandoc process.
        await js("document.querySelector('[title=\"Import document with Pandoc\"]').click()");
        await click('.import-dialog button', 'Choose document');
        await wait("!!document.querySelector('.import-dialog [role=alert]')");
        pandocAvailable = true;
        importFails = true;
        await click('.import-dialog button', 'Choose document');
        await wait("document.querySelector('.import-dialog [role=alert]')?.textContent.includes('Document conversion failed')");
        importFails = false;
        await click('.import-dialog button', 'Choose document');
        await wait("!!document.querySelector('.import-preview')");
        assert.match(await js("document.querySelector('.import-preview').value"), /Imported document/);
        await click('.import-dialog button', 'Add to vault');
        await wait("!document.querySelector('.import-dialog')");
        assert.match(await fs.readFile(path.join(vault, 'Source.md'), 'utf8'), /Imported document/);
        assert.equal(await fs.readFile(original, 'utf8'), 'untouched source');
        await new Promise((resolve) => { wc.once('did-finish-load', resolve); wc.reload(); });
        await wait("!!document.querySelector('.app')");
        assert.equal(await js("document.documentElement.dataset.theme"), 'custom');
        assert.equal(await js("document.documentElement.style.getPropertyValue('--accent')"), '#abcdef');
        assert.deepEqual(errors, []);
        console.log('PASS: flow focus on/off, cell/sheet/tab menus, editor parse cache/invalidation, native HTML export without Pandoc, four themes, custom theme validation, Spanish/French UI, Pandoc import IPC and failure handling.');
      } catch (error) {
        console.error(error);
        console.error('UI:', await js("document.body.innerText.slice(-1600)"));
        console.error('Renderer:', errors);
        process.exitCode = 1;
      } finally {
        await fs.rm(vault, { recursive: true, force: true });
        // Chromium may still own userData; leave only its disposable OS-temp session files.
        app.exit(process.exitCode || 0);
      }
    });
  });
  require('../electron/main.cjs');
})().catch((error) => { console.error(error); app.exit(1); });
