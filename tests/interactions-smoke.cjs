if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs'), path = require('node:path');
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tagline-interactions-'));
  try {
    const result = spawnSync(require('electron'), [__filename], {
      env: { ...process.env, TAGLINE_INTERACTIONS_ROOT: root }, stdio: 'inherit', timeout: 120000,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
  return;
}

const { app } = require('electron');
const fs = require('node:fs/promises'), path = require('node:path');
const assert = require('node:assert/strict');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const root = process.env.TAGLINE_INTERACTIONS_ROOT;
  const vault = path.join(root, 'vault'), profile = path.join(root, 'profile');
  await fs.mkdir(vault); await fs.mkdir(profile);
  await fs.writeFile(path.join(vault, 'Round.flow'), JSON.stringify({
    version: 1, sheets: [{ name: 'Case', columns: ['1AC', '1NC'], rows: [['', '']] }],
  }));
  await fs.writeFile(path.join(vault, 'Map.canvas'), '{"nodes":[],"edges":[]}');
  await fs.writeFile(path.join(vault, 'Alpha.md'), '# Alpha\n\n#### Claim\n\n==Evidence text.== [[Beta]]');
  await fs.writeFile(path.join(vault, 'Beta.md'), '# Beta\n\n[[Alpha]]');
  await fs.writeFile(path.join(profile, 'config.json'), JSON.stringify({ lastVault: vault, modelAutoload: false }));
  app.setPath('userData', profile);
  app.on('browser-window-created', (_event, win) => {
    win.setIgnoreMouseEvents(true);
    win.webContents.setBackgroundThrottling(false);
    win.webContents.once('did-finish-load', async () => {
      const wc = win.webContents;
      const js = (code) => wc.executeJavaScript(code);
      const wait = async (code) => {
        for (let i = 0; i < 160; i++) { if (await js(code)) return; await delay(50); }
        throw new Error(`Timed out: ${code}`);
      };
      const click = (selector) => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
      const button = (selector, text) => js(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(el => el.textContent.trim() === ${JSON.stringify(text)});
        if (!el) throw new Error('Missing button ' + ${JSON.stringify(text)}); el.click();
      })()`);
      const open = async (file) => {
        await click(`.tree-item[title="${file}"]`);
        await delay(150);
      };
      const point = (selector, fx = 0.5, fy = 0.5) => js(`(() => {
        const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return { x: Math.round(r.left + r.width * ${fx}), y: Math.round(r.top + r.height * ${fy}) };
      })()`);
      const press = async (p) => {
        wc.sendInputEvent({ type: 'mouseMove', ...p });
        wc.sendInputEvent({ type: 'mouseDown', ...p, button: 'left', clickCount: 1 });
        await delay(180);
        wc.sendInputEvent({ type: 'mouseUp', ...p, button: 'left', clickCount: 1 });
        await delay(100);
      };
      const drag = async (p, dx, dy) => {
        wc.sendInputEvent({ type: 'mouseMove', ...p });
        wc.sendInputEvent({ type: 'mouseDown', ...p, button: 'left', clickCount: 1 });
        await delay(50);
        wc.sendInputEvent({ type: 'mouseMove', x: p.x + dx, y: p.y + dy, button: 'left', modifiers: ['leftButtonDown'] });
        await delay(100);
        wc.sendInputEvent({ type: 'mouseUp', x: p.x + dx, y: p.y + dy, button: 'left', clickCount: 1 });
        await delay(100);
      };
      const context = async (selector) => {
        await js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const r = el.getBoundingClientRect();
          el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 4, clientY: r.top + 4 })); })()`);
        await wait("!!document.querySelector('.context-menu')");
      };
      const saved = (key) => js(`JSON.parse(localStorage.getItem('tagline-settings'))[${JSON.stringify(key)}]`);
      try {
        win.show(); win.focus();
        await wait("document.querySelectorAll('.tree-item').length === 4");
        await open('Round.flow');
        await wait("!!document.querySelector('.flow-add-row')");
        await js("document.querySelector('.flow-grid textarea').focus()");
        assert.equal(await js("getComputedStyle(document.querySelector('.flow-grid textarea')).borderRadius"), '0px');
        for (const [fx, fy] of [[0.5, 0.001], [0.001, 0.5], [0.999, 0.5]]) {
          const count = await js("document.querySelectorAll('.flow-grid tbody tr').length");
          await press(await point('.flow-add-row', fx, fy));
          assert.equal(await js("document.querySelectorAll('.flow-grid tbody tr').length"), count + 1, 'full add-row button must activate');
        }

        await open('Map.canvas');
        await wait("!!document.querySelector('.canvas-board-wrap')");
        const camera = () => js("document.querySelector('.canvas-board').style.transform");
        await js(`document.querySelector('.canvas-board-wrap').dispatchEvent(new WheelEvent('wheel', {
          bubbles: true, cancelable: true, deltaX: 1400, deltaY: 900
        }))`);
        await delay(100);
        const beforeAdd = await camera();
        await button('.canvas-toolbar button', 'Add text');
        await wait("!!document.querySelector('.canvas-node')");
        const visible = await js(`(() => { const n = document.querySelector('.canvas-node').getBoundingClientRect();
          const v = document.querySelector('.canvas-board-wrap').getBoundingClientRect();
          return n.left >= v.left && n.top >= v.top && n.right <= v.right && n.bottom <= v.bottom; })()`);
        assert.equal(visible, true, 'new nodes appear in the panned viewport');
        assert.equal(await camera(), beforeAdd, 'adding a node must not pan');
        const beforeDrag = await camera();
        const before = await js("({ x: parseFloat(document.querySelector('.canvas-node').style.left), y: parseFloat(document.querySelector('.canvas-node').style.top) })");
        await drag(await point('.canvas-node-header', 0.2), -100, -70);
        assert.equal(await camera(), beforeDrag, 'moving a node must not reposition the view');
        const after = await js("({ x: parseFloat(document.querySelector('.canvas-node').style.left), y: parseFloat(document.querySelector('.canvas-node').style.top) })");
        assert.equal(after.x, before.x - 100); assert.equal(after.y, before.y - 70);
        const firstId = await js("document.querySelector('.canvas-node').dataset.nodeId");
        await click('.canvas-toolbar [aria-label="Zoom in"]');
        await wait("document.querySelector('.canvas-toolbar [aria-label=\"Reset zoom\"]').textContent === '120%'");
        await drag(await point('.canvas-node-header', 0.2), 60, 24);
        const zoomed = await js("({ x: parseFloat(document.querySelector('.canvas-node').style.left), y: parseFloat(document.querySelector('.canvas-node').style.top) })");
        assert.equal(zoomed.x, after.x + 50); assert.equal(zoomed.y, after.y + 20);
        await click('.canvas-toolbar [aria-label="Reset zoom"]');
        await wait("document.querySelector('.canvas-toolbar [aria-label=\"Reset zoom\"]').textContent === '100%'");
        await click('.canvas-toolbar [aria-label="Zoom out"]');
        await wait("document.querySelector('.canvas-toolbar [aria-label=\"Reset zoom\"]').textContent === '83%'");
        await click('.canvas-toolbar [aria-label="Reset zoom"]');
        await wait("document.querySelector('.canvas-toolbar [aria-label=\"Reset zoom\"]').textContent === '100%'");
        assert.equal(await js("getComputedStyle(document.querySelector('.canvas-board-wrap')).overflow"), 'clip');
        await button('.canvas-toolbar button', 'Add text');
        await wait("document.querySelectorAll('.canvas-node').length === 2");
        await js(`(() => { const el = document.querySelector('[aria-label="Relation"]'); el.value = 'supports';
          el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await button('.canvas-toolbar button', 'Connect nodes');
        await click(`[data-node-id="${firstId}"]`);
        await js("document.querySelectorAll('.canvas-node')[1].click()");
        await wait("document.querySelector('.canvas-edge-label')?.textContent === 'Supports'");

        await open('Alpha.md');
        await wait("!!document.querySelector('.status-bar [data-bar-item=words]')");
        await context('.status-bar [data-bar-item=words]');
        await button('.context-menu button', 'Move left');
        assert.ok((await saved('statusBarItems')).indexOf('words') < (await saved('statusBarItems')).indexOf('cards'));
        await context('.status-bar [data-bar-item=words]');
        await button('.context-menu button', 'Hide item');
        assert.equal((await saved('statusBarItems')).includes('words'), false);
        await context('.status-bar');
        await button('.context-menu button', 'Show Word count');
        assert.equal((await saved('statusBarItems')).at(-1), 'words');
        await context('.sidebar-header [data-bar-item=newCanvas]');
        await button('.context-menu button', 'Move left');
        assert.deepEqual((await saved('fileManagerItems')).slice(0, 3), ['newNote', 'newCanvas', 'newFlow']);
        await context('.sidebar-header [data-bar-item=newCanvas]');
        await button('.context-menu button', 'Hide item');
        assert.equal(await js("!!document.querySelector('.sidebar-header [aria-label=\"New canvas\"]')"), false);
        await delay(1200);
        await new Promise((resolve) => { wc.once('did-finish-load', resolve); wc.reload(); });
        await wait("!!document.querySelector('.sidebar-header')");
        assert.equal(await js("!!document.querySelector('.sidebar-header [aria-label=\"New canvas\"]')"), false);
        assert.equal((await saved('statusBarItems')).at(-1), 'words');
        await js(`(() => { const value = JSON.parse(localStorage.getItem('tagline-settings'));
          value.fileManagerItems = []; value.statusBarItems = [];
          localStorage.setItem('tagline-settings', JSON.stringify(value)); })()`);
        await new Promise((resolve) => { wc.once('did-finish-load', resolve); wc.reload(); });
        await wait("!!document.querySelector('.sidebar-header')");
        assert.equal(await js("document.querySelectorAll('.configurable-bar-item').length"), 0);
        assert.equal(await js("document.querySelector('.status-bar').getBoundingClientRect().height >= 28"), true);
        assert.equal(await js("document.querySelector('.sidebar-header').getBoundingClientRect().height >= 40"), true);
        await context('.sidebar-header');
        await button('.context-menu button', 'Restore default items');
        assert.equal(await js("!!document.querySelector('.sidebar-header [aria-label=\"New canvas\"]')"), true);
        await context('.status-bar');
        await button('.context-menu button', 'Restore default items');
        await open('Alpha.md');
        await wait("!!document.querySelector('[data-editor-action=link]')");
        await click('[data-editor-action=link]');
        await wait("!!document.querySelector('.wiki-link-options')");
        assert.equal(await js("document.querySelector('.visual-link-form input').hasAttribute('list')"), false);
        await button('.wiki-link-options button', 'Beta');
        assert.equal(await js("document.querySelector('.visual-link-form input').value"), 'Beta');
        await js(`(() => { const el = document.querySelector('.visual-link-form input');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'Al#Claim|Evidence');
          el.dispatchEvent(new Event('input', { bubbles: true })); el.focus(); })()`);
        await wait("document.querySelectorAll('.wiki-link-options button').length === 1");
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'Down' });
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
        await wait("document.querySelector('.visual-link-form input').value === 'Alpha#Claim|Evidence'");
        assert.equal(await js("!!document.querySelector('.visual-link-form')"), true, 'choosing a suggestion does not submit prematurely');
        await button('.visual-link-form button', 'Insert link');
        await wait("!document.querySelector('.visual-link-form')");

        await js(`(() => {
          const original = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (...args) {
            const ctx = original.apply(this, args);
            if (args[0] !== '2d' || ctx.taglineRecorded) return ctx;
            ctx.taglineRecorded = true;
            for (const name of ['clearRect', 'translate', 'scale', 'arc']) {
              const method = ctx[name].bind(ctx);
              ctx[name] = (...values) => {
                if (name === 'clearRect') window.graphPaint = { nodes: [] };
                if (name === 'translate') window.graphPaint.offset = values;
                if (name === 'scale') window.graphPaint.scale = values[0];
                if (name === 'arc') window.graphPaint.nodes.push({ x: values[0], y: values[1], r: values[2] });
                return method(...values);
              };
            }
            return ctx;
          };
        })()`);
        await click('.ribbon [data-ribbon-item=graph]');
        await wait("window.graphPaint?.nodes.length === 2");
        await delay(1000);
        const originalNode = await js("window.graphPaint.nodes[0]");
        const gp = await js(`(() => { const r = document.querySelector('.graph canvas').getBoundingClientRect();
          const p = window.graphPaint, n = p.nodes[0];
          return { x: Math.round(r.left + p.offset[0] + n.x * p.scale),
            y: Math.round(r.top + p.offset[1] + n.y * p.scale) }; })()`);
        await drag(gp, 80, 50);
        const pinned = await js("window.graphPaint.nodes[0]");
        assert.ok(Math.abs(pinned.x - originalNode.x - 80) < 2 && Math.abs(pinned.y - originalNode.y - 50) < 2,
          'graph drag moves the node, rather than just panning');
        await delay(1200);
        const settled = await js("window.graphPaint.nodes[0]");
        assert.ok(Math.abs(pinned.x - settled.x) < 0.01 && Math.abs(pinned.y - settled.y) < 0.01,
          'graph node remains at its dropped position');
        await click('.sidebar-header [aria-label="Refresh"]');
        await wait("document.querySelector('.sidebar-header [aria-label=\"Refresh\"]').getAttribute('aria-busy') === 'false'");
        const refreshed = await js("window.graphPaint.nodes[0]");
        assert.ok(Math.abs(pinned.x - refreshed.x) < 0.01 && Math.abs(pinned.y - refreshed.y) < 0.01,
          'refreshing the vault does not reset a dropped graph node');
        console.log('PASS: flow edge hit targets, square focus, canvas viewport placement/stable drag/zoom/relations, persistent configurable bars, themed link picker and pinned graph drag.');
        app.exit(0);
      } catch (error) { console.error(error); app.exit(1); }
    });
  });
  require('../electron/main.cjs');
})().catch((error) => { console.error(error); app.exit(1); });
