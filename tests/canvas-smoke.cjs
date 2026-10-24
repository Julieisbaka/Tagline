const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-canvas-ui-'));
  const vault = path.join(root, 'vault');
  const profile = path.join(root, 'profile');
  await fs.mkdir(vault);
  await fs.mkdir(profile);
  const original = {
    nodes: [
      { id: 'group', type: 'group', x: 0, y: 0, width: 600, height: 400, label: 'Case' },
      { id: 'claim', type: 'text', x: 40, y: 80, width: 200, height: 160, text: 'Original claim', color: '1' },
      { id: 'file', type: 'file', x: 300, y: 80, width: 200, height: 160, file: '' },
      { id: 'outside', type: 'text', x: 700, y: 80, width: 200, height: 160, text: 'Outside' },
    ],
    edges: [{ id: 'edge', fromNode: 'claim', toNode: 'file' }],
  };
  await fs.writeFile(path.join(vault, 'Map.canvas'), JSON.stringify(original));
  await fs.writeFile(path.join(vault, 'Climate.md'), '# Climate');
  await fs.writeFile(path.join(profile, 'config.json'), JSON.stringify({ lastVault: vault, modelAutoload: false }));
  app.setPath('userData', profile);
  app.on('before-quit', (event) => event.preventDefault());
  app.on('browser-window-created', (_event, win) => {
    win.webContents.once('did-finish-load', async () => {
      const wc = win.webContents;
      const js = (code) => wc.executeJavaScript(code);
      const wait = async (code) => {
        for (let i = 0; i < 100; i++) { if (await js(code)) return; await delay(50); }
        throw new Error('Timed out: ' + code);
      };
      const click = (selector, text) => js(`[...document.querySelectorAll(${JSON.stringify(selector)})]
        .find(el => el.textContent.trim() === ${JSON.stringify(text)}).click()`);
      const select = async (selector, value) => {
        await js(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
          el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await delay(100);
      };
      const input = (selector, text) => js(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, ${JSON.stringify(text)});
        el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      const settings = async () => {
        await js("document.querySelector('.ribbon-settings-button').click()");
        await wait("!!document.querySelector('.settings')");
      };
      const drag = async (id, dx, dy) => {
        win.show();
        win.focus();
        const point = await js(`(() => { const rect = document.querySelector('[data-node-id="${id}"] header').getBoundingClientRect();
          return { x: Math.round(rect.left + 30), y: Math.round(rect.top + 10) }; })()`);
        wc.sendInputEvent({ type: 'mouseMove', ...point });
        wc.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
        await delay(100);
        wc.sendInputEvent({ type: 'mouseMove', x: point.x + dx, y: point.y + dy, button: 'left' });
        await delay(100);
        wc.sendInputEvent({ type: 'mouseUp', x: point.x + dx, y: point.y + dy, button: 'left', clickCount: 1 });
        await delay(100);
      };
      try {
        await wait("document.querySelectorAll('.tree-item').length === 2");
        await settings();
        await select('[data-setting="canvasHistoryMode"]', 'data');
        await click('.settings button', 'Done');
        await click('.tree-item', 'Map');
        await wait("document.querySelectorAll('.canvas-node').length === 4");
        assert.equal(await js("getComputedStyle(document.querySelector('.canvas-groups')).zIndex"), '0');
        assert.equal(await js("getComputedStyle(document.querySelector('.canvas-nodes')).zIndex"), '2');
        await drag('group', 50, 30);
        await delay(450);
        let saved = JSON.parse(await fs.readFile(path.join(vault, 'Map.canvas'), 'utf8'));
        assert.deepEqual(saved.nodes.map(({ x, y }) => [x, y]), [[50, 30], [90, 110], [350, 110], [700, 80]]);
        assert.deepEqual(await js("window.api.listHistory('Map.canvas')"), [], 'moving groups creates no Data revision');
        await js("document.querySelector('[data-node-id=\"claim\"]').click()");
        assert.deepEqual(await js("[...document.querySelectorAll('.canvas-inspector select[aria-label=\"Node color\"] option')].map(el => el.textContent)"),
          ['Default', 'Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Purple']);
        await input('[aria-label="File path"]', 'clim');
        await wait("document.querySelector('datalist option')?.value === 'Climate.md'");
        await js("document.querySelector('[data-node-id=\"claim\"]').click()");
        await click('[data-node-id="claim"] button', 'Edit text');
        await input('[aria-label="Canvas text"]', 'New claim');
        await click('.note-actions button', 'History');
        await wait("document.querySelector('.history-preview')?.value.includes('Original claim')");
        const snapshot = JSON.parse(await js("document.querySelector('.history-preview').value"));
        assert.equal(snapshot.nodes.find(node => node.id === 'claim').x, 90);
        await click('.history-dialog button', 'Close');
        await drag('group', 25, 20);
        await click('.note-actions button', 'History');
        await wait("document.querySelector('.history-preview')?.value.includes('Original claim')");
        assert.equal(JSON.parse(await js("document.querySelector('.history-preview').value")).nodes.find(node => node.id === 'claim').x, 115);
        await js("void (window.confirm = () => true)");
        await click('.history-dialog button', 'Restore this version');
        await wait("!document.querySelector('.history-dialog')");
        await wait("document.querySelector('[data-node-id=\"claim\"]').textContent.includes('Original claim')");
        await select('.note-actions select', 'source');
        await wait("!!document.querySelector('.canvas-json-editor .cm-content')");
        for (const theme of ['dark', 'light', 'high-contrast-dark', 'high-contrast-light']) {
          await settings();
          await select('[data-setting="theme"]', theme);
          await click('.settings button', 'Done');
          await delay(250);
          const colors = await js(`(() => { const root = document.querySelector('.canvas-json-editor');
            return { bg: getComputedStyle(root.querySelector('.cm-editor')).backgroundColor,
              colors: [...new Set([...root.querySelectorAll('.cm-content, .cm-line span')].map(el => getComputedStyle(el).color))] }; })()`);
          const luminance = (color) => {
            const [r, g, b] = color.match(/[0-9.]+/g).slice(0, 3).map(Number).map(value => {
              const v = value / 255;
              return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          const bg = luminance(colors.bg);
          for (const color of colors.colors) {
            const fg = luminance(color);
            const ratio = (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05);
            assert.ok(ratio >= 4.5, `${theme} JSON text ${color} contrast ${ratio.toFixed(2)} on ${colors.bg}`);
          }
        }
        await select('.note-actions select', 'visual');
        await wait("!!document.querySelector('[data-node-id=\"claim\"]')");
        await js("document.querySelector('[data-node-id=\"claim\"]').click()");
        await click('[data-node-id="claim"] button', 'Edit text');
        await input('[aria-label="Canvas text"]', 'Saved during immediate close');
        const closed = new Promise((resolve) => win.once('closed', resolve));
        win.close();
        await Promise.race([closed, delay(5000).then(() => { throw new Error('Close/save handshake did not complete'); })]);
        saved = JSON.parse(await fs.readFile(path.join(vault, 'Map.canvas'), 'utf8'));
        assert.equal(saved.nodes.find(node => node.id === 'claim').text, 'Saved during immediate close');
        console.log('Canvas UI, Data history, filename suggestions, theme contrast and immediate-close saves passed');
        await fs.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
        app.exit(0);
      } catch (error) { console.error(error); app.exit(1); }
    });
  });
  require('../electron/main.cjs');
})().catch((error) => { console.error(error); app.exit(1); });
