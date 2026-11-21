const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

if (!process.versions.electron) {
  process.exitCode = require('./helpers/smoke.cjs').runSmoke({
    script: __filename,
    prefix: 'tagline-canvas-performance-',
    rootEnv: 'TAGLINE_CANVAS_PERFORMANCE_ROOT',
    timeout: 90000,
  });
  return;
}

const { app } = require('electron');
const root = process.env.TAGLINE_CANVAS_PERFORMANCE_ROOT;
assert.ok(root, 'Run this test through Node.');
const vault = path.join(root, 'vault'),
  profile = path.join(root, 'profile');
fs.mkdirSync(vault);
fs.mkdirSync(path.join(vault, '.tagline'), { recursive: true });
fs.writeFileSync(
  path.join(vault, '.tagline', 'vault.json'),
  JSON.stringify({ version: require('../electron/vaultMigrations.cjs').migrations.length })
);
fs.mkdirSync(profile);
const nodes = Array.from({ length: 300 }, (_, index) => ({
  id: `node-${index}`,
  type: 'text',
  x: (index % 20) * 320,
  y: Math.floor(index / 20) * 220,
  width: 280,
  height: 180,
  text: `#### Claim ${index}\n\n**Author 2026**\n\n==Evidence== [[Evidence]]`,
}));
nodes.push({
  id: 'file',
  type: 'file',
  file: 'Evidence.md',
  x: 320,
  y: 0,
  width: 280,
  height: 180,
});
const edges = nodes.slice(1).map((node, index) => ({
  id: `edge-${index}`,
  fromNode: nodes[index].id,
  toNode: node.id,
}));
fs.writeFileSync(path.join(vault, 'Large.canvas'), JSON.stringify({ nodes, edges }));
fs.writeFileSync(path.join(vault, 'Evidence.md'), '# Evidence\n\nOriginal evidence');
fs.writeFileSync(
  path.join(profile, 'config.json'),
  JSON.stringify({ lastVault: vault, modelAutoload: false })
);
app.setPath('userData', profile);
app.on('browser-window-created', (_event, win) => {
  win.webContents.setBackgroundThrottling(false);
  win.webContents.once('did-finish-load', async () => {
    const js = (code) => win.webContents.executeJavaScript(code);
    const wait = require('./helpers/wait.cjs').rendererWait(js);
    try {
      await wait("!!document.querySelector('.onboarding-skip')");
      await js("document.querySelector('.onboarding-skip').click()");
      await wait('!!document.querySelector(\'.tree-item[title="Large.canvas"]\')');
      await js('document.querySelector(\'.tree-item[title="Large.canvas"]\').click()');
      await wait('!!document.querySelector(\'[data-node-id="node-0"]\')');
      assert.deepEqual(
        await js(
          "window.api.read('Large.canvas').then(text => { const canvas = JSON.parse(text); return [canvas.nodes.length, canvas.edges.length]; })"
        ),
        [301, 300],
        'the complete canvas model is loaded while off-screen nodes remain virtualized'
      );
      const result = await js(`(async () => {
        const board = document.querySelector('.canvas-board-wrap');
        const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
        const original = DOMParser.prototype.parseFromString;
        let parses = 0;
        DOMParser.prototype.parseFromString = function (...args) { parses++; return original.apply(this, args); };
        const samples = [];
        const mountedIds = () => new Set([...document.querySelectorAll('[data-node-id]')].map(node => node.dataset.nodeId));
        const before = mountedIds();
        try {
          for (let index = 0; index < 24; index++) {
            const start = performance.now();
            board.dispatchEvent(new WheelEvent('wheel', {deltaX: 4, deltaY: 3, bubbles: true, cancelable: true}));
            await frame();
            samples.push(performance.now() - start);
          }
          const panParses = parses;
          const panMounted = [...mountedIds()].filter(id => !before.has(id)).length;
          parses = 0;
          const header = document.querySelector('[data-node-id="node-0"] header');
          header.setPointerCapture = () => {};
          header.dispatchEvent(new PointerEvent('pointerdown', {pointerId: 1, button: 0, clientX: 10, clientY: 10, bubbles: true}));
          for (let index = 1; index <= 24; index++) {
            board.dispatchEvent(new PointerEvent('pointermove', {pointerId: 1, clientX: 10 + index * 2, clientY: 10 + index, bubbles: true}));
            await frame();
          }
          const dragParses = parses;
          board.dispatchEvent(new PointerEvent('pointerup', {pointerId: 1, bubbles: true}));
          await frame();
          return {panParses, panMounted, dragParses, meanFrameMs: samples.reduce((sum, value) => sum + value, 0) / samples.length};
        } finally { DOMParser.prototype.parseFromString = original; }
      })()`);
      console.log('Canvas performance (301 nodes/300 edges):', JSON.stringify(result));
      // Nodes that scroll into the virtualized viewport must render once; anything beyond that is a re-parse.
      assert.ok(
        result.panParses <= result.panMounted,
        `panning must not re-parse Markdown previews (${result.panParses} parses for ${result.panMounted} newly mounted nodes)`
      );
      assert.equal(result.dragParses, 0, 'dragging must not parse unchanged Markdown previews');
      await wait(
        "window.api.read('Large.canvas').then(text => JSON.parse(text).nodes[0].x === 48)"
      );
      await js(`(() => {
        const board = document.querySelector('.canvas-board-wrap');
        const header = document.querySelector('[data-node-id="node-0"] header');
        header.dispatchEvent(new PointerEvent('pointerdown', {pointerId: 1, button: 0, clientX: 10, clientY: 10, bubbles: true}));
        for (let index = 1; index <= 30; index++) {
          board.dispatchEvent(new PointerEvent('pointermove', {pointerId: 1, clientX: 10 + index, clientY: 10, bubbles: true}));
        }
        board.dispatchEvent(new PointerEvent('pointerup', {pointerId: 1, bubbles: true}));
      })()`);
      await wait(
        "window.api.read('Large.canvas').then(text => JSON.parse(text).nodes[0].x === 78)"
      );
      await js(`(async () => {
        const board = document.querySelector('.canvas-board-wrap');
        const header = document.querySelector('[data-node-id="node-0"] header');
        header.dispatchEvent(new PointerEvent('pointerdown', {pointerId: 1, button: 0, clientX: 10, clientY: 10, bubbles: true}));
        board.dispatchEvent(new PointerEvent('pointermove', {pointerId: 1, clientX: 100, clientY: 100, bubbles: true}));
        board.dispatchEvent(new PointerEvent('pointercancel', {pointerId: 1, bubbles: true}));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      })()`);
      assert.equal(
        await js('Number.parseInt(document.querySelector(\'[data-node-id="node-0"]\').style.left)'),
        78,
        'cancellation discards pending frame updates'
      );
      assert.equal(
        await js("window.api.read('Large.canvas').then(text => JSON.parse(text).nodes[0].x)"),
        78,
        'cancellation never saves an unfinished gesture'
      );
      await js("window.api.write('Evidence.md', '# Evidence\\n\\nUpdated evidence')");
      await js("document.querySelector('.sidebar-header [aria-label=Refresh]').click()");
      await wait(
        "document.querySelector('[data-node-id=file] .canvas-node-preview')?.textContent.includes('Updated evidence')"
      );
      assert.equal(
        await js("window.api.read('Large.canvas').then(text => JSON.parse(text).edges.length)"),
        300
      );
      await js("document.querySelector('.ribbon-settings-button').click()");
      await wait("!!document.querySelector('.settings')");
      await js("document.querySelector('[data-section=appearance]').click()");
      await js(`(() => {
        const language = document.querySelector('[data-setting=language]');
        language.value = 'es'; language.dispatchEvent(new Event('change', {bubbles: true}));
      })()`);
      await wait(
        "document.querySelector('[data-node-id=\"node-0\"] header span').textContent === 'texto'"
      );
      assert.equal(
        await js("document.querySelector('[data-edge-id=\"edge-0\"]').getAttribute('aria-label')"),
        'Conexión del lienzo',
        'memoized nodes and edges still follow language changes'
      );
      console.log(
        'PASS: large-canvas pan/drag reuse previews, saves persist, and linked-file changes remain live.'
      );
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
});
require('../electron/main.cjs');
