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
  app.setPath('sessionData', profile);
  app.on('browser-window-created', (_event, win) => {
    win.setIgnoreMouseEvents(true);
    win.webContents.setBackgroundThrottling(false);
    win.webContents.once('did-finish-load', async () => {
      const wc = win.webContents;
      wc.on('console-message', (details) => { if (details.level === 'error') console.error('Renderer:', details.message); });
      const js = (code) => wc.executeJavaScript(code);
      const wait = async (code) => {
        for (let i = 0; i < 160; i++) { if (await js(code)) return; await delay(50); }
        throw new Error(`Timed out: ${code}\n` + JSON.stringify(await js(`({
          graph: window.graphPaint, tabs: [...document.querySelectorAll('.tab')].map(el => el.title),
          files: [...document.querySelectorAll('.tree-item')].map(el => el.title),
          confirmation: document.querySelector('.confirm-dialog')?.textContent,
          toast: document.querySelector('.toast')?.textContent,
          graphCanvas: !!document.querySelector('.graph canvas'),
          activeTab: document.querySelector('.tab.active')?.title
        })`)));
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
      const drag = async (p, dx, dy, during) => {
        wc.sendInputEvent({ type: 'mouseMove', ...p });
        wc.sendInputEvent({ type: 'mouseDown', ...p, button: 'left', clickCount: 1 });
        await delay(50);
        wc.sendInputEvent({ type: 'mouseMove', x: p.x + dx, y: p.y + dy, button: 'left', modifiers: ['leftButtonDown'] });
        await delay(100);
        if (during) await during();
        wc.sendInputEvent({ type: 'mouseUp', x: p.x + dx, y: p.y + dy, button: 'left', clickCount: 1 });
        await delay(100);
      };
      const context = async (selector) => {
        await js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const r = el.getBoundingClientRect();
          el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 4, clientY: r.top + 4 })); })()`);
        await wait("!!document.querySelector('.context-menu')");
      };
      const saved = (key) => js(`JSON.parse(localStorage.getItem('tagline-settings'))[${JSON.stringify(key)}]`);
      const scenarioContext = { win, wc, vault, fs, path, assert, delay, js, wait, click, button, open, point, press, drag, context, saved };
      try {
        await require('./interactions/onboarding-flow.cjs')(scenarioContext);
        await require('./interactions/canvas-editor.cjs')(scenarioContext);
        await require('./interactions/editor-layout.cjs')(scenarioContext);
        await require('./interactions/graph-recovery.cjs')(scenarioContext);
        await require('./interactions/note-drag.cjs')(scenarioContext);
        console.log('PASS: flow/canvas recovery in visual and source modes, themed confirmations, JSON history, live resize, file previews and links, onboarding flag, viewport/bar/link/graph regressions.');
        app.exit(0);
      } catch (error) { console.error(error); app.exit(1); }
    });
  });
  require('../electron/main.cjs');
})().catch((error) => { console.error(error); app.exit(1); });
