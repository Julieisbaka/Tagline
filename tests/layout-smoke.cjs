// Layout check: status-bar statistics wrap instead of clipping, note actions stay inside the note
// column, and both side panels resize by mouse drag and keyboard with persisted, clamped widths.
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tagline-layout-'));
  try { const r = spawnSync(require('electron'), [__filename], { env: { ...process.env, SHOT_ROOT: root }, stdio: 'inherit', timeout: 120000 }); process.exitCode = r.status ?? 1; } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
  return;
}
const { app } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const root = process.env.SHOT_ROOT, profile = path.join(root, 'p'), vault = path.join(root, 'v');
  await fs.mkdir(profile, { recursive: true }); await fs.mkdir(vault);
  let body = '# Long doc\n\n';
  for (let i = 0; i < 60; i++) body += `#### Card ${i}\n\n**Smith ${i}**\n\n==Evidence paragraph ${i} with some highlighted text.== More.\n\n`;
  await fs.writeFile(path.join(vault, 'Doc.md'), body);
  await fs.writeFile(path.join(vault, 'Map.canvas'), JSON.stringify({
    nodes: [
      { id: 'claim', type: 'text', x: 80, y: 80, width: 280, height: 180, text: 'Claim' },
      { id: 'evidence', type: 'text', x: 400, y: 80, width: 280, height: 180, text: 'Evidence' },
    ], edges: [],
  }, null, 2));
  await fs.writeFile(path.join(profile, 'config.json'), JSON.stringify({ lastVault: vault, modelAutoload: false }));
  app.setPath('userData', profile);
  app.on('browser-window-created', (_e, win) => {
    win.setIgnoreMouseEvents(true);
    win.webContents.once('did-finish-load', async () => {
      const js = (c) => win.webContents.executeJavaScript(c);
      const rect = (s) => js(`(() => { const b = document.querySelector(${JSON.stringify(s)}).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; })()`);
      try {
        for (let i = 0; i < 100 && !(await js("!!document.querySelector('.onboarding-skip')")); i++) await delay(50);
        await js("document.querySelector('.onboarding-skip').click()");
        for (let i = 0; i < 100 && !(await js("!!document.querySelector('.ribbon-settings-button')")); i++) await delay(100);
        await js("document.querySelector('.ribbon-settings-button').click()");
        for (let i = 0; i < 100 && !(await js("!!document.querySelector('.settings')")); i++) await delay(50);
        await js("document.querySelector('[data-section=\"appearance\"]').click()");
        await delay(100);
        const defaultItems = await js("JSON.parse(localStorage.getItem('tagline-settings')).ribbonItems");
        assert.deepEqual(defaultItems, ['fileExplorer', 'switcher', 'search', 'graph', 'commands', 'import', 'rightPanel']);
        await js("document.querySelector('.ribbon-settings input[data-ribbon-item=\"search\"]').click()");
        await delay(100);
        assert.equal(await js("document.querySelector('.ribbon [data-ribbon-item=\"search\"]') === null"), true,
          'hidden shortcut is removed from the sidebar');
        assert.equal(await js("!!document.querySelector('.ribbon-settings-button')"), true,
          'settings remains available when shortcuts are hidden');
        await js("document.querySelector('[data-ribbon-reset]').click()");
        await delay(100);
        await js("document.querySelector('.ribbon-settings button[data-direction=\"down\"]').click()");
        await delay(100);
        const reorderedItems = await js("JSON.parse(localStorage.getItem('tagline-settings')).ribbonItems");
        assert.deepEqual(reorderedItems.slice(0, 2), ['switcher', 'fileExplorer'], 'shortcut order persists');
        await js("document.querySelector('.settings-footer .primary').click()");
        await delay(100);
        for (let i = 0; i < 100 && !(await js("document.querySelectorAll('.tree-item').length")); i++) await delay(100);
        await js(`(() => { const item = document.querySelector('.tree-item[title="Doc.md"]'); item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 140, clientY: 160 })); })()`);
        await delay(100);
        await js(`(() => [...document.querySelectorAll('.context-menu button')].find((button) => button.textContent.includes('Copy note path')).click())()`);
        await delay(100);
        assert.equal(await js("JSON.stringify(document.querySelector('.toast')?.textContent)"), JSON.stringify('Copied note path'),
          'copy path action reports success');
        await js(`document.querySelector('.tree-item[title="Map.canvas"]').click()`);
        await delay(300);
        assert.equal(await js("!!document.querySelector('.canvas-toolbar [aria-label=\"Canvas mode\"]')"), false,
          'argument relations are available on the canvas without a separate mode');
        await js(`(() => {
          const relation = [...document.querySelectorAll('.canvas-mode-control select')].find((select) =>
            select.getAttribute('aria-label') === 'Relation');
          relation.value = 'supports';
          relation.dispatchEvent(new Event('change', { bubbles: true }));
          [...document.querySelectorAll('.canvas-toolbar button')].find((button) => button.textContent.includes('Connect nodes')).click();
        })()`);
        await delay(100);
        await js(`document.querySelector('[data-node-id="claim"]').click()`);
        await delay(100);
        await js(`document.querySelector('[data-node-id="evidence"]').click()`);
        let argumentCanvas = JSON.parse(await fs.readFile(path.join(vault, 'Map.canvas'), 'utf8'));
        for (let i = 0; i < 30 && !argumentCanvas.edges.length; i++) {
          await delay(100);
          argumentCanvas = JSON.parse(await fs.readFile(path.join(vault, 'Map.canvas'), 'utf8'));
        }
        assert.deepEqual(argumentCanvas.edges[0], {
          id: argumentCanvas.edges[0].id, fromNode: 'claim', toNode: 'evidence',
          fromSide: 'right', toSide: 'left', toEnd: 'arrow', label: 'Supports', color: '4',
        }, 'argument relation is saved as a standard Canvas edge');
        assert.equal(await js("!!document.querySelector('.canvas-board')"), true,
          'argument map is rendered inside the canvas editor');
        await js(`document.querySelector('.tree-item[title="Doc.md"]').dispatchEvent(
          new MouseEvent('click', { bubbles: true, ctrlKey: true }))`);
        await delay(250);
        assert.deepEqual(await js("[...document.querySelectorAll('.tab')].map(tab => tab.title)"),
          ['Map.canvas', 'Doc.md'], 'Ctrl-click opens a second file tab');
        await js(`(() => {
          const [source, target] = document.querySelectorAll('.tab');
          const transfer = new DataTransfer();
          source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
          const rect = target.getBoundingClientRect();
          const options = { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.right - 1 };
          target.dispatchEvent(new DragEvent('dragover', options));
          target.dispatchEvent(new DragEvent('drop', options));
          source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
        })()`);
        await delay(150);
        assert.deepEqual(await js("[...document.querySelectorAll('.tab')].map(tab => tab.title)"),
          ['Doc.md', 'Map.canvas'], 'dropping a tab on the right half moves it after the target');
        assert.deepEqual(await js(`JSON.parse(localStorage.getItem(
          Object.keys(localStorage).find(key => key.startsWith('tabs:')))).tabs.map(tab => tab.path)`),
          ['Doc.md', 'Map.canvas'], 'tab order persists for the current vault');
        for (const [w, h] of [[1280, 800], [900, 700]]) {
          win.setContentSize(w, h); await delay(800);
          const clipped = await js(`(() => { const bar = document.querySelector('.status-bar').getBoundingClientRect(); return [...document.querySelectorAll('.status-bar > span:not(.spacer)')].filter(s => { const r = s.getBoundingClientRect(); return r.right > bar.right + 1 || r.bottom > bar.bottom + 1; }).map(s => s.textContent); })()`);
          assert.deepEqual(clipped, [], `status items clipped at ${w}: ${clipped}`);
          const actions = await rect('.note-actions'), main = await rect('.main');
          assert.ok(actions.x + actions.w <= main.x + main.w + 1, `note actions overflow at ${w}`);
        }
        win.setContentSize(1280, 800); win.show(); win.focus(); await delay(800);
        // Real mouse drag of the left splitter by +120px.
        const before = (await rect('.sidebar')).w;
        const s = await rect('.panel-splitter-left');
        const x = Math.round(s.x + s.w / 2), y = Math.round(s.y + 300);
        win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
        await delay(50);
        win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        await delay(50);
        for (let dx = 20; dx <= 120; dx += 20) { win.webContents.sendInputEvent({ type: 'mouseMove', x: x + dx, y, button: 'left', modifiers: ['leftButtonDown'] }); await delay(30); }
        win.webContents.sendInputEvent({ type: 'mouseUp', x: x + 120, y, button: 'left', clickCount: 1 });
        await delay(400);
        const after = (await rect('.sidebar')).w;
        assert.ok(Math.abs(after - before - 120) <= 2, `sidebar drag ${before} -> ${after}`);
        const saved = await js("JSON.parse(localStorage.getItem('tagline-settings')).sidebarWidth");
        assert.equal(saved, Math.round(after), 'sidebar width persisted');
        // Right splitter: drag left by 100 grows the right panel.
        const rb = (await rect('.right-panel')).w, r = await rect('.panel-splitter-right');
        const rx = Math.round(r.x + r.w / 2);
        win.webContents.sendInputEvent({ type: 'mouseMove', x: rx, y });
        await delay(50);
        win.webContents.sendInputEvent({ type: 'mouseDown', x: rx, y, button: 'left', clickCount: 1 });
        await delay(50);
        for (let dx = 20; dx <= 100; dx += 20) { win.webContents.sendInputEvent({ type: 'mouseMove', x: rx - dx, y, button: 'left', modifiers: ['leftButtonDown'] }); await delay(30); }
        win.webContents.sendInputEvent({ type: 'mouseUp', x: rx - 100, y, button: 'left', clickCount: 1 });
        await delay(400);
        const ra = (await rect('.right-panel')).w;
        assert.ok(Math.abs(ra - rb - 100) <= 2, `right drag ${rb} -> ${ra}`);
        // Clamping keeps the note column usable.
        await js("document.querySelector('.panel-splitter-right').focus()");
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'End' }); await delay(300);
        assert.ok((await rect('.main')).w >= 318, 'main keeps minimum width');
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); await delay(300);
        assert.equal(Math.round((await rect('.right-panel')).w), 300, 'Enter resets right panel');
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left' }); await delay(300);
        assert.equal(Math.round((await rect('.right-panel')).w), 316, 'ArrowLeft grows right panel');
        assert.equal(await js("document.body.classList.contains('resizing-panels')"), false);
        console.log('PASS layout');
        app.exit(0);
      } catch (e) { console.error('FAIL', e.message); app.exit(1); }
    });
  });
  require('../electron/main.cjs');
})();
