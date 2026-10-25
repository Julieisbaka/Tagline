const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tagline-startup-'));
  const samples = Number(process.env.TAGLINE_STARTUP_SAMPLES || 3);
  try {
    assert.ok(Number.isSafeInteger(samples) && samples > 0, 'TAGLINE_STARTUP_SAMPLES must be a positive integer.');
    const results = [];
    for (const scenario of ['welcome', 'vault', 'visual', 'source']) {
      const profile = path.join(root, 'profiles', scenario);
      const vault = path.join(root, 'vault');
      fs.mkdirSync(profile, { recursive: true });
      fs.mkdirSync(vault, { recursive: true });
      for (let i = 0; i < 200; i++) fs.writeFileSync(path.join(vault, `Note ${i}.md`),
        `# Note ${i}\n\n#### Evidence\n\n**Author 2026**\n\n==Useful evidence for this argument.==\n\n[[Note ${(i + 1) % 200}]]\n`);
      fs.writeFileSync(path.join(profile, 'config.json'),
        JSON.stringify({ ...(scenario !== 'welcome' ? { lastVault: vault } : {}), modelAutoload: false }));
      const run = (seed, verify = false) => {
        const start = performance.now();
        const result = spawnSync(require('electron'), [__filename], {
          env: {
            ...process.env, TAGLINE_STARTUP_PROFILE: profile, TAGLINE_STARTUP_VAULT: vault,
            TAGLINE_STARTUP_SCENARIO: scenario, TAGLINE_STARTUP_SEED: seed ? '1' : '',
            TAGLINE_STARTUP_VERIFY: verify ? '1' : ''
          },
          encoding: 'utf8', timeout: 30000,
        });
        if (result.error) throw result.error;
        assert.equal(result.status, 0, result.stderr || result.stdout);
        if (seed) return;
        const line = result.stdout.split(/\r?\n/).find((text) => text.startsWith('STARTUP '));
        assert.ok(line, result.stdout);
        return { ...JSON.parse(line.slice(8)), processExitMs: Math.round(performance.now() - start) };
      };
      run(true);
      const runs = Array.from({ length: samples }, () => run(false));
      const median = (key) => runs.map((run) => run[key]).sort((a, b) => a - b)[Math.floor(runs.length / 2)];
      results.push({
        scenario, mainMs: median('mainMs'), navigationMs: median('navigationMs'),
        processExitMs: median('processExitMs'), initialJsBytes: median('initialJsBytes')
      });
      if (scenario === 'vault' && !process.env.TAGLINE_STARTUP_BASELINE) run(false, true);
    }
    console.log(JSON.stringify(results, null, 2));
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
  return;
}

const { app, ipcMain } = require('electron');
const profile = process.env.TAGLINE_STARTUP_PROFILE;
assert.ok(profile, 'Run this test through Node.');
app.setPath('userData', profile);
const started = performance.now();
const requests = { 'fs:snapshot': 0, 'fs:list': 0, 'fs:readAll': 0 };
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => handle(channel, (...args) => {
  if (Object.hasOwn(requests, channel)) requests[channel]++;
  return handler(...args);
});
app.on('browser-window-created', (_event, win) => {
  const scripts = new Set();
  win.webContents.session.webRequest.onCompleted(({ url }) => {
    if (url.startsWith('file:') && url.endsWith('.js')) scripts.add(url);
  });
  win.webContents.setBackgroundThrottling(false);
  win.webContents.once('did-finish-load', async () => {
    try {
      const scenario = process.env.TAGLINE_STARTUP_SCENARIO;
      if (process.env.TAGLINE_STARTUP_SEED) {
        await win.webContents.executeJavaScript(`new Promise((resolve) => {
          const check = () => document.querySelector(${JSON.stringify(scenario === 'welcome' ? '.welcome' : '.tree-item')})
            && localStorage.getItem('tagline-settings') ? setTimeout(resolve, 100) : setTimeout(check, 10);
          check();
        })`);
        await win.webContents.executeJavaScript(`(() => {
          localStorage.setItem('tagline-settings', JSON.stringify({ modelAutoload: false, internalFlags: { hasSeenOnboarding: true }, editorMode: ${JSON.stringify(scenario === 'source' ? 'edit' : 'visual')} }));
          localStorage.setItem(${JSON.stringify(`tabs:${process.env.TAGLINE_STARTUP_VAULT}`)}, JSON.stringify({
            tabs: ${JSON.stringify(['visual', 'source'].includes(scenario) ? [{ id: 'startup-note', kind: 'file', path: 'Note 0.md' }] : [])},
            activeId: 'startup-note'
          }));
        })()`);
        app.exit(0);
        return;
      }
      const selector = {
        welcome: '.welcome', vault: '.sidebar .tree-item',
        visual: '.ProseMirror[contenteditable="true"]', source: '.source-editor .cm-content[contenteditable="true"]'
      }[scenario];
      const report = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const start = performance.now();
        const check = () => {
          if (document.querySelector(${JSON.stringify(selector)})) {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve({
              navigationMs: Math.round(performance.now())
            })));
          } else if (performance.now() - start > 15000) reject(new Error('Startup did not reach ${scenario}'));
          else setTimeout(check, 10);
        };
        check();
      })`);
      report.mainMs = Math.round(performance.now() - started);
      assert.ok(report.navigationMs < 15000);
      report.jsFiles = [...scripts].map((url) => require('node:url').fileURLToPath(url));
      report.initialJsBytes = report.jsFiles.reduce((sum, file) => sum + fs.statSync(file).size, 0);
      const chunks = report.jsFiles.map((file) => path.basename(file));
      assert.ok(report.initialJsBytes > 0);
      if (!process.env.TAGLINE_STARTUP_BASELINE) {
        assert.equal(requests['fs:snapshot'], scenario === 'welcome' ? 0 : 1);
        assert.equal(requests['fs:list'], 0);
        assert.equal(requests['fs:readAll'], 0);
        assert.ok(!chunks.some((file) => /^(Dialogs|CanvasView|FlowEditor|GraphView)-/.test(file)),
          'Unused dialogs and views must not load at startup');
        assert.equal(chunks.some((file) => /^VisualEditor-/.test(file)), scenario === 'visual');
        assert.equal(chunks.some((file) => /^Editor-/.test(file)), scenario === 'source');
      }
      if (scenario !== 'welcome') {
        const files = await win.webContents.executeJavaScript("[...document.querySelectorAll('.sidebar .tree-item')].map(item => item.title)");
        assert.equal(files.length, 200, JSON.stringify(files.filter((file) => !/^Note \d+\.md$/.test(file))));
      }
      if (process.env.TAGLINE_STARTUP_VERIFY) await verifyDeferredDialog(win);
      console.log('STARTUP ' + JSON.stringify(report));
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
});

async function verifyDeferredDialog(win) {
  const wc = win.webContents;
  const js = (code) => wc.executeJavaScript(code);
  const wait = async (condition) => {
    for (let i = 0; i < 200; i++) {
      if (await condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Deferred dialog did not reach the expected state');
  };
  let release;
  wc.session.webRequest.onBeforeRequest(({ url }, callback) => {
    if (/\/Dialogs-[^/]+\.js$/.test(url)) release = callback;
    else callback({});
  });
  const open = () => js("document.querySelector('.ribbon-settings-button').focus(); document.querySelector('.ribbon-settings-button').click()");
  await open();
  await wait(() => !!release);
  assert.equal(await js("!!document.querySelector('.deferred-dialog [role=status]')"), true);
  assert.equal(await js("!!document.querySelector('.ribbon').closest('[inert]')"), true);
  assert.equal(await js("!!document.activeElement.closest('.deferred-dialog')"), true);
  release({ cancel: true });
  await wait(() => js("!!document.querySelector('.deferred-dialog [role=alert]')"));
  assert.match(await js("document.querySelector('.deferred-dialog [role=alert]').textContent"), /Could not load/);
  wc.session.webRequest.onBeforeRequest(null);
  const reloaded = new Promise((resolve) => wc.once('did-finish-load', resolve));
  await js("[...document.querySelectorAll('.deferred-dialog button')].find(button => button.textContent === 'Reload').click()");
  await reloaded;
  await wait(() => js("!!document.querySelector('.ribbon-settings-button')"));
  await open();
  await wait(() => js("!!document.querySelector('.settings')"));
  await js("document.querySelector('.settings-footer .primary').click()");
  await wait(() => js("document.activeElement.matches('.ribbon-settings-button')"));
  assert.equal(await js("document.querySelectorAll('[inert]').length"), 0);
}

require('../electron/main.cjs');
