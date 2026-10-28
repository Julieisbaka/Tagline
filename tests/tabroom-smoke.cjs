const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

if (!process.versions.electron) {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tagline-tabroom-smoke-'));
  try {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
      env: { ...process.env, TAGLINE_TABROOM_ROOT: root }, stdio: 'inherit', timeout: 90000,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
  return;
}

const { app, BrowserWindow, session, dialog, shell } = require('electron');
const openedUrls = [];
shell.openExternal = async (url) => { openedUrls.push(url); };
const root = process.env.TAGLINE_TABROOM_ROOT;
assert.ok(root, 'Run through Node after building.');
const profile = path.join(root, 'profile');
const vault = path.join(root, 'vault');
fs.mkdirSync(profile);
fs.mkdirSync(vault);
fs.writeFileSync(path.join(vault, 'Keep.md'), '# Test');
fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify({ lastVault: vault, modelAutoload: false }));
app.setPath('userData', profile);
const backup = {
  id: 123, name: '<img src=x onerror=window.attacked=true>', city: 'Test City',
  categories: [{
    name: 'Policy',
    judges: Array.from({ length: 51 }, (_, i) => ({ id: i + 1, first: 'Judge', last: String(i), school: 10 })),
    events: [{
      id: 30, name: 'Policy', entries: [
        {
          id: 20, school: 10, name: 'Example AB', code: 'EX AB', students: [
            { id: 101, first: 'Alice', last: 'Able' }, { id: 102, first: 'Bob', last: 'Baker' },
          ]
        },
        { id: 21, school: 10, name: 'Placeholder', code: ' tba ' },
      ]
    }],
  }],
  schools: [{ id: 10, name: 'Example School', code: 'EX', chapter: 100 }], description: 'x'.repeat(45000)
};
const raw = JSON.stringify(backup) + '\n';
const rawPages = Math.ceil(JSON.stringify(backup, null, 2).length / 20000);
fs.writeFileSync(path.join(vault, 'tournament.json'), raw);
const destination = path.join(root, 'tournament.json');
let requests = 0;
let loginWindows = 0;
let wikiRequests = 0;
let wikiMode = 'verified';
let includePreviousSeason = true;
const fromPartition = session.fromPartition.bind(session);
session.fromPartition = (name, ...args) => {
  const isolated = fromPartition(name, ...args);
  if (name === 'persist:tabroom') isolated.fetch = async (url, options) => {
    requests++;
    assert.equal(url, 'https://www.tabroom.com/api/download_data.mhtml?tourn_id=123');
    assert.equal(options.credentials, 'include');
    if (requests === 2) return new Response('<html>Unavailable</html>');
    if (requests === 3) return new Response(JSON.stringify({
      id: 123, name: 'Restricted snapshot', schools: [], categories: [{ name: 'Policy' }],
    }));
    return new Response(raw);
  };
  if (name === 'persist:opencaselist') {
    isolated.cookies.get = async () => [{ name: 'caselist_token', value: 'mock-cookie', expirationDate: Date.now() / 1000 + 1000 }];
    isolated.fetch = async (url, options) => {
      wikiRequests++;
      assert.equal(options.method, 'GET');
      if (wikiMode === 'error') return new Response('{}', { status: 403 });
      const value = url.endsWith('/teams') ? [{
        name: 'AbBa', display_name: 'Example School AbBa',
        ...(wikiMode !== 'generated' ? {
          debater1_first: 'Alice', debater1_last: 'Able', debater2_first: 'Bob', debater2_last: 'Baker',
        } : {}),
        ...(wikiMode === 'verified' ? { debater1_student_id: 101, debater2_student_id: 102 } : {}),
      }] : url.endsWith('/schools') ? [{ name: 'ExampleSchool', display_name: 'Example School', chapter_id: 100 }]
        : [{ name: 'ndt2026', display_name: 'College Policy 2026', year: 2026, event: 'cx' },
        ...(includePreviousSeason ? [{ name: 'ndt2025', display_name: 'College Policy 2025', year: 2025, archived: true, event: 'cx' }] : [])];
      return new Response(JSON.stringify(value));
    };
  }
  return isolated;
};
dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
const loadURL = BrowserWindow.prototype.loadURL;
BrowserWindow.prototype.loadURL = async function (url, ...args) {
  if (url !== 'https://www.tabroom.com/user/login/login.mhtml') return loadURL.call(this, url, ...args);
  loginWindows++;
  const preferences = this.webContents.getLastWebPreferences();
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.preload, undefined);
  await loadURL.call(this, 'about:blank');
  await this.webContents.session.cookies.set({
    url: 'https://www.tabroom.com', name: 'mock-session', value: 'private-session',
    secure: true, httpOnly: true, expirationDate: Date.now() / 1000 + 1000,
  });
  this.close();
};
app.on('browser-window-created', (_event, win) => {
  if (win.getTitle().startsWith('Sign in to Tabroom')) return;
  win.webContents.once('did-finish-load', async () => {
    const js = (code) => win.webContents.executeJavaScript(code);
    const wait = async (code) => {
      for (let i = 0; i < 200; i++) {
        if (await js(code)) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`Timed out: ${code}`);
    };
    const click = async (label, scope = '.tabroom-dialog') => {
      const expression = `[...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`;
      await wait(`!!(${expression})`);
      await js(`(${expression}).click()`);
    };
    const input = async (value) => js(`(() => {
      const input=document.querySelector('.tabroom-field input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    try {
      await wait("!!document.querySelector('.onboarding-skip')");
      await js("document.querySelector('.onboarding-skip').click()");
      await wait("!!document.querySelector('.ribbon-settings-button')");
      await js("document.querySelector('.ribbon-settings-button').click()");
      await click('Integrations', '.settings');
      await click('Open Tabroom', '.settings');
      await wait("!!document.querySelector('.tabroom-dialog')");
      await input('123');
      await click('Load tournament');
      await wait("!!document.querySelector('.tabroom-summary')");
      assert.equal(await js("document.querySelector('.tabroom-dialog h4').textContent"), backup.name);
      assert.equal(await js("!!window.attacked || !!document.querySelector('.tabroom-dialog img')"), false);
      assert.equal(await js("!!document.querySelector('.tabroom-json')"), false, 'Structured overview is the default');
      assert.equal(await js("document.querySelector('.tabroom-metadata').textContent.includes('Test City')"), true);
      await click('Judges', '.tabroom-views');
      await wait("document.querySelectorAll('.tabroom-table tbody tr').length===50");
      assert.equal(await js("document.querySelector('.tabroom-table').textContent.includes('Example School')"), true);
      await click('Next');
      await wait("document.querySelectorAll('.tabroom-table tbody tr').length===1");
      await js(`(() => {
        const input=document.querySelector('.tabroom-filter input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Judge 10');
        input.dispatchEvent(new Event('input',{bubbles:true}));
      })()`);
      await wait("document.querySelectorAll('.tabroom-table tbody tr').length===1&&document.querySelector('.tabroom-table').textContent.includes('Judge 10')");
      await click('Teams', '.tabroom-views');
      await wait("document.querySelector('.tabroom-table')?.textContent.includes('Example AB')");
      assert.equal(await js("document.querySelectorAll('.tabroom-table tbody tr').length"), 1);
      assert.equal(wikiRequests, 0, 'No automatic OpenCaselist requests');
      assert.equal(await js("!!document.querySelector('.tabroom-result a[href*=opencaselist]')"), false);
      assert.equal(await js("document.querySelector('.tabroom-table a').href"),
        'https://www.tabroom.com/index/tourn/postings/entry_record.mhtml?tourn_id=123&entry_id=20');
      assert.equal(await js("document.querySelector('.tabroom-table a[href*=id1]').href"),
        'https://www.tabroom.com/index/results/team_lifetime_record.mhtml?id1=101');
      await js("document.querySelector('.tabroom-table a').click()");
      await js("document.querySelector('.tabroom-table a[href*=id1]').click()");
      await wait("!document.querySelector('.tabroom-result [role=alert]')");
      await click('Load supported seasons');
      await wait("document.querySelector('.tabroom-caselist select').options.length===3");
      assert.equal(await js("document.querySelector('.tabroom-caselist select').value"), '');
      assert.equal(await js("[...document.querySelectorAll('.tabroom-table button')].find(b=>b.textContent==='Find on OpenCaselist').disabled"), true);
      const selectSeason = async (value) => {
        await js(`(() => {
          const select=document.querySelector('.tabroom-caselist select');
          select.value=${JSON.stringify(value)}; select.dispatchEvent(new Event('change',{bubbles:true}));
        })()`);
        await wait("!!document.querySelector('.tabroom-result section[aria-label=\"Teams\"][aria-busy=\"false\"]')");
      };
      await selectSeason('ndt2026');
      await click('Find on OpenCaselist');
      await wait("document.querySelector('.tabroom-match')?.textContent.includes('Verified match')");
      assert.equal(await js("document.querySelector('.tabroom-match a').href"), 'https://opencaselist.com/ndt2026/ExampleSchool/AbBa');
      await js("document.querySelector('.tabroom-match a').click()");
      wikiMode = 'candidate';
      await selectSeason('ndt2025');
      assert.equal(await js("JSON.parse(localStorage.getItem('tagline-tabroom-caselist'))"), 'ndt2025');
      assert.equal(await js("!!document.querySelector('.tabroom-match')"), false, 'Season change clears stale matches');
      await click('Find on OpenCaselist');
      await wait("document.querySelector('.tabroom-match')?.textContent.includes('Possible match')");
      assert.equal(await js("document.querySelector('.tabroom-match').textContent.includes('Lower confidence')"), false);
      wikiMode = 'generated';
      await click('Find on OpenCaselist');
      await wait("document.querySelector('.tabroom-match')?.textContent.includes('Lower confidence: school and generated name code only.')");
      assert.equal(await js("document.querySelector('.tabroom-match a').href"), 'https://opencaselist.com/ndt2025/ExampleSchool/AbBa');
      assert.equal(await js("document.querySelector('.tabroom-match').textContent.includes('Verified match')"), false);
      wikiMode = 'error';
      await click('Find on OpenCaselist');
      await wait("document.querySelector('.tabroom-result [role=alert]')?.textContent.includes('denied')");
      assert.deepEqual(openedUrls, [
        'https://www.tabroom.com/index/tourn/postings/entry_record.mhtml?tourn_id=123&entry_id=20',
        'https://www.tabroom.com/index/results/team_lifetime_record.mhtml?id1=101',
        'https://opencaselist.com/ndt2026/ExampleSchool/AbBa',
      ]);
      wikiMode = 'verified';
      await click('Raw JSON', '.tabroom-views');
      await wait("!!document.querySelector('.tabroom-json')");
      const originalSize = win.getSize();
      for (const [width, height] of [[1100, 850], [700, 600], [420, 650]]) {
        win.setMinimumSize(320, 400);
        win.setSize(width, height);
        await new Promise((resolve) => setTimeout(resolve, 200));
        for (const view of ['Overview', 'Teams', 'Raw JSON']) {
          await click(view, '.tabroom-views');
          if (view === 'Teams') await wait("!!document.querySelector('.tabroom-table')");
          if (view === 'Teams') assert.equal(await js("document.querySelector('.tabroom-caselist select').value"), 'ndt2025');
          const layout = await js(`(() => {
            const dialog = document.querySelector('.tabroom-dialog');
            const bounds = dialog.getBoundingClientRect();
            const header = dialog.querySelector('header').getBoundingClientRect();
            const close = dialog.querySelector('header button').getBoundingClientRect();
            const preview = dialog.querySelector('.tabroom-json');
            const elements = [...dialog.querySelectorAll('button, input, select, pre')]
              .filter(element => !element.closest('.tabroom-table-scroll') && !element.closest('[hidden]'));
            return {
              fits: bounds.top >= 0 && bounds.bottom <= innerHeight && bounds.left >= 0 && bounds.right <= innerWidth,
              noHorizontalOverflow: dialog.scrollWidth <= dialog.clientWidth + 1,
              bodyFits: dialog.querySelector('.tabroom-body').scrollWidth <= dialog.querySelector('.tabroom-body').clientWidth + 1,
              controlsFit: elements.every(element => {
                const rect = element.getBoundingClientRect();
                return rect.width > 0 && rect.left >= bounds.left && rect.right <= bounds.right;
              }),
              headerHeight: header.height,
              closeOnRight: close.right >= bounds.right - 32,
              previewHeight: preview?.clientHeight,
            };
          })()`);
          assert.equal(layout.fits, true, `${view} dialog fits ${width}x${height}: ${JSON.stringify(layout)}`);
          assert.equal(layout.noHorizontalOverflow, true, `${view}: no horizontal overflow at ${width}px`);
          assert.equal(layout.bodyFits, true, `${view}: body has no horizontal overflow at ${width}px`);
          assert.equal(layout.controlsFit, true, `${view}: controls fit at ${width}px`);
          assert.equal(layout.closeOnRight, true, `close button aligned at ${width}px`);
          assert.ok(layout.headerHeight >= 28, `header does not shrink at ${width}px`);
          if (view === 'Raw JSON') assert.ok(layout.previewHeight >= 120, `readable JSON at ${width}px`);
        }
      }
      win.setSize(...originalSize);
      await click('Next');
      await wait(`document.querySelector('.tabroom-dialog').textContent.includes('Page 2 of ${rawPages}')`);
      await click('Previous');
      await wait(`document.querySelector('.tabroom-dialog').textContent.includes('Page 1 of ${rawPages}')`);
      await click('Save tournament JSON');
      await wait("document.querySelector('.tabroom-dialog').textContent.includes('Saved tournament JSON:')");
      assert.equal(fs.readFileSync(destination, 'utf8'), raw);
      assert.equal(requests, 1);
      await click('Load tournament');
      await wait("document.querySelector('.tabroom-dialog [role=alert]')?.textContent.includes('valid JSON')");
      assert.equal(await js("!!document.querySelector('.tabroom-json')"), false);
      await click('Sign in on Tabroom');
      await wait("[...document.querySelectorAll('.tabroom-dialog button')].some(b=>b.textContent==='Clear Tabroom session'&&!b.disabled)");
      assert.equal(loginWindows, 1);
      assert.deepEqual(await js('window.api.tabroom.status()'), { hasSession: true });
      await click('Load tournament');
      await wait("!!document.querySelector('.tabroom-summary')");
      await click('Teams', '.tabroom-views');
      await click('Load supported seasons');
      await wait("document.querySelector('.tabroom-caselist select').value==='ndt2025'");
      includePreviousSeason = false;
      await click('Load supported seasons');
      await wait("document.querySelector('.tabroom-caselist select').options.length===2");
      assert.equal(await js("document.querySelector('.tabroom-caselist select').value"), '', 'Unavailable previous season is not selected');
      includePreviousSeason = true;
      await click('Load supported seasons');
      await wait("document.querySelector('.tabroom-caselist select').value==='ndt2025'");
      await selectSeason('');
      await click('Load supported seasons');
      await wait("!document.querySelector('.tabroom-caselist select').disabled");
      assert.equal(await js("document.querySelector('.tabroom-caselist select').value"), '', 'Explicitly cleared preference stays cleared');
      await click('Judges', '.tabroom-views');
      await wait("document.querySelector('.tabroom-result').textContent.includes('Not provided in this snapshot')");
      await click('Schools', '.tabroom-views');
      await wait("document.querySelector('.tabroom-result').textContent.includes('No records in the provided data.')");
      await click('Clear Tabroom session');
      await wait("document.querySelector('.tabroom-dialog').textContent.includes('No Tabroom browser session saved')");
      assert.equal(await js("!!document.querySelector('.tabroom-result')"), false);
      assert.deepEqual(await js('window.api.tabroom.status()'), { hasSession: false });
      await click('Close');
      await wait("!document.querySelector('.tabroom-dialog')");
      const requestsBeforeFileOpen = requests;
      await wait("[...document.querySelectorAll('.file-tree .tree-label')].some(label=>label.textContent==='tournament.json')");
      await js("[...document.querySelectorAll('.file-tree .tree-label')].find(label=>label.textContent==='tournament.json').closest('.tree-item').click()");
      await wait("!!document.querySelector('.tabroom-file-view .tabroom-summary')");
      assert.equal(await js("document.querySelector('.tabroom-file-view h2').textContent"), 'tournament.json');
      await click('Judges', '.tabroom-file-view .tabroom-views');
      await wait("document.querySelectorAll('.tabroom-file-view .tabroom-table tbody tr').length===50");
      assert.equal(await js("!!document.querySelector('.tabroom-file-view .tabroom-caselist')"), false);
      assert.equal(requests, requestsBeforeFileOpen, 'Opening a saved tournament JSON never performs a Tabroom request');
      assert.equal(await js("!!window.attacked || !!document.querySelector('.tabroom-file-view img')"), false);
      console.log('PASS Tabroom UI: dialog and direct JSON tables, nested records, filtering, paging, responsive views, safe JSON, export, errors and isolated login.');
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
});
require('../electron/main.cjs');
