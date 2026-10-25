const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

if (!process.versions.electron) {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tagline-opencaselist-'));
  try {
    for (const stage of ['workflows', 'persisted']) {
      const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
        env: { ...process.env, TAGLINE_CASELIST_ROOT: root, TAGLINE_CASELIST_STAGE: stage },
        stdio: 'inherit', timeout: 90000,
      });
      if (result.error) throw result.error;
      assert.equal(result.status, 0, `${stage} failed`);
    }
    console.log('PASS OpenCaselist: official isolated sign-in, browsing/search, binary downloads, confirmed writes/uploads, expiry, re-login and persisted cookies.');
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
  return;
}

const { app, BrowserWindow, session, dialog } = require('electron');
const root = process.env.TAGLINE_CASELIST_ROOT;
assert.ok(root, 'Run this test through Node.');
const first = process.env.TAGLINE_CASELIST_STAGE === 'workflows';
const profile = path.join(root, 'profile'), vault = path.join(root, 'vault');
fs.mkdirSync(profile, { recursive: true });
fs.mkdirSync(vault, { recursive: true });
fs.writeFileSync(path.join(vault, 'Keep.md'), '# Local evidence');
if (first) fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify({ lastVault: vault, modelAutoload: false }));
const uploadFile = path.join(root, 'Upload.docx');
fs.writeFileSync(uploadFile, Buffer.from([80, 75, 3, 4, 255]));
app.setPath('userData', profile);
let apiRequests = [], confirmed = [], roundId = 1, loginWindows = 0;
let allowChange = false, loginCookie = 0, expireWrite = false, failTeamBrowse = false;
let rounds = [{
  round_id: 1, tournament: 'Example tournament', side: 'A', round: '1',
  opponent: 'Other team', report: 'Public report', opensource: 'ndt2026/Disclosure.docx'
}];
let cites = [{ cite_id: 1, round_id: 1, title: 'Evidence citation', cites: '**Author** claim' }];
const binary = Buffer.from([0, 255, 42, 13]);
const loadURL = BrowserWindow.prototype.loadURL;
BrowserWindow.prototype.loadURL = async function (url, ...args) {
  if (url !== 'https://opencaselist.com/login') return loadURL.call(this, url, ...args);
  loginWindows++;
  assert.equal(this.webContents.getLastWebPreferences().sandbox, true);
  assert.equal(this.webContents.getLastWebPreferences().nodeIntegration, false);
  assert.equal(this.webContents.getLastWebPreferences().preload, undefined);
  await loadURL.call(this, 'about:blank');
  await this.webContents.session.cookies.set({
    url: 'https://api.opencaselist.com', name: 'caselist_token', value: `mock-private-cookie-${++loginCookie}`,
    domain: '.opencaselist.com', secure: true, httpOnly: true, sameSite: 'no_restriction',
    expirationDate: Date.now() / 1000 + 14 * 24 * 60 * 60,
  });
};
dialog.showMessageBox = async (_win, options) => {
  confirmed.push(options);
  assert.equal(options.defaultId, 0);
  return { response: allowChange ? 1 : 0 };
};
dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(vault, 'Disclosure.docx') });
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [uploadFile] });
const fromPartition = session.fromPartition.bind(session);
session.fromPartition = (partition, ...args) => {
  const isolated = fromPartition(partition, ...args);
  if (partition !== 'persist:opencaselist') return isolated;
  isolated.fetch = async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://api.opencaselist.com');
    assert.equal(options.credentials, 'include');
    assert.equal(options.redirect, 'error');
    const route = parsed.pathname;
    const method = options.method;
    const body = options.body ? JSON.parse(options.body) : null;
    apiRequests.push({ route, method, body });
    const reply = (value, status = 200) => new Response(JSON.stringify(value), { status });
    if (method !== 'GET' && expireWrite) {
      expireWrite = false;
      return reply({ message: 'Expired' }, 401);
    }
    if (route === '/v1/search') {
      if (parsed.searchParams.get('q') === 'expire') return reply({ message: 'Expired' }, 401);
      return reply([{
        id: 1, path: 'ndt2026/Other/CD', team_display_name: 'Other CD',
        title: 'Disclosure', snippet: '<mark>Evidence</mark><img src=x onerror="window.attacked=true">',
        download_path: 'ndt2026/Disclosure.docx'
      }]);
    }
    if (route === '/v1/caselists') return reply([{ slug: 'ndt2026', name: 'College Policy 2026', archived: false }]);
    if (route.endsWith('/schools')) return reply([{ name: 'Example', display_name: 'Example University' }, { name: 'Other' }]);
    if (route.endsWith('/teams')) return reply(route.includes('/Other/') ? [{ name: 'CD' }] : [{ name: 'AB', display_name: 'Example AB' }]);
    if (route === '/v1/download') return new Response(binary);
    if (route.includes('/Other/') && route.endsWith('/rounds') && failTeamBrowse) return reply({ message: 'Unavailable' }, 503);
    if (route.includes('/Other/') && route.endsWith('/rounds')) return reply([{ round_id: 9, tournament: 'Other tournament', side: 'N', round: '4' }]);
    if (route.includes('/Other/') && route.endsWith('/cites')) return reply([]);
    if (route.endsWith('/rounds') && method === 'GET') return reply(rounds);
    if (route.endsWith('/cites') && method === 'GET') return reply(cites);
    if (route.endsWith('/rounds') && method === 'POST') {
      rounds.push({ ...body, round_id: ++roundId, opensource: body.filename ? 'ndt2026/Upload.docx' : null });
      return reply({ message: 'Created' }, 201);
    }
    if (/\/rounds\/\d+$/.test(route) && method === 'GET') return reply(rounds.find((round) => round.round_id === Number(route.split('/').at(-1))));
    if (/\/rounds\/\d+$/.test(route) && method === 'PUT') {
      const round = rounds.find((round) => round.round_id === Number(route.split('/').at(-1)));
      Object.assign(round, body);
      return reply({ message: 'Updated' });
    }
    if (route.endsWith('/cites') && method === 'POST') { cites.push({ ...body, cite_id: 2 }); return reply({ message: 'Created' }, 201); }
    if (/\/cites\/\d+$/.test(route) && method === 'DELETE') { cites = cites.filter((cite) => cite.cite_id !== Number(route.split('/').at(-1))); return reply({ message: 'Deleted' }); }
    if (/\/rounds\/\d+$/.test(route) && method === 'DELETE') { rounds = rounds.filter((round) => round.round_id !== Number(route.split('/').at(-1))); return reply({ message: 'Deleted' }); }
    throw new Error(`Unexpected mocked request ${method} ${route}`);
  };
  return isolated;
};
app.on('browser-window-created', (_event, win) => {
  if (win.getTitle() === 'Sign in to OpenCaselist') return;
  win.webContents.once('did-finish-load', async () => {
    const wc = win.webContents;
    const js = (code) => wc.executeJavaScript(code);
    const wait = async (code) => {
      for (let i = 0; i < 200; i++) { if (await js(code)) return; await new Promise((resolve) => setTimeout(resolve, 25)); }
      throw new Error(`Timed out: ${code}`);
    };
    const click = async (text, scope = '.opencaselist-dialog') => {
      const expression = `[...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find(button => button.textContent.trim() === ${JSON.stringify(text)} && !button.disabled)`;
      await wait(`!!(${expression})`);
      await js(`(${expression}).click()`);
    };
    const select = async (key, value) => {
      await js(`(() => { const select = document.querySelector('[data-caselist-select=${key}]');
        select.value = ${JSON.stringify(value)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await wait("!document.querySelector('.opencaselist-selectors').disabled");
    };
    const input = async (label, value, scope = '.opencaselist-dialog') => {
      await js(`(() => { const label = [...document.querySelectorAll(${JSON.stringify(`${scope} label`)})].find(label => label.querySelector('span')?.textContent === ${JSON.stringify(label)});
        const input = label.querySelector('input,textarea'); const setter = Object.getOwnPropertyDescriptor(input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,'value').set;
        setter.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    };
    try {
      await wait("!!document.querySelector('.ribbon-settings-button')");
      await js("document.querySelector('.ribbon-settings-button').focus(); document.querySelector('.ribbon-settings-button').click()");
      await wait("!!document.querySelector('[data-section=integrations]')");
      await js("document.querySelector('[data-section=integrations]').click()");
      assert.equal(apiRequests.length, 0, 'Opening Settings never contacts OpenCaselist');
      await wait("!document.querySelector('.opencaselist-password-settings fieldset').disabled");
      if (first) {
        assert.equal(await js("document.querySelector('[data-setting=opencaselistRequirePasswordForWrites]').checked"), false);
        await js("document.querySelector('[data-setting=opencaselistRequirePasswordForWrites]').click()");
        await input('New write password', 'local tournament password', '.opencaselist-password-settings');
        await input('Confirm new write password', 'mismatched', '.opencaselist-password-settings');
        await click('Save write protection', '.opencaselist-password-settings');
        await wait("document.querySelector('.opencaselist-password-settings [role=alert]')?.textContent.includes('do not match')");
        assert.equal(await js("window.api.openCaselist.writePasswordStatus().then(value => value.enabled)"), false);
        await input('Confirm new write password', 'local tournament password', '.opencaselist-password-settings');
        await click('Save write protection', '.opencaselist-password-settings');
        await wait("!!document.querySelector('.opencaselist-password-settings [role=status]')");
        const config = JSON.parse(fs.readFileSync(path.join(profile, 'config.json'), 'utf8'));
        assert.equal(config.opencaselistRequirePasswordForWrites, true);
        assert.ok(config.opencaselistWritePassword.hash);
        assert.ok(!JSON.stringify(config).includes('local tournament password'));
        await js("document.querySelector('[data-setting=opencaselistRequirePasswordForWrites]').click()");
        await input('Current write password', 'wrong password', '.opencaselist-password-settings');
        await click('Save write protection', '.opencaselist-password-settings');
        await wait("document.querySelector('.opencaselist-password-settings [role=alert]')?.textContent.includes('Incorrect')");
        assert.equal(await js("window.api.openCaselist.writePasswordStatus().then(value => value.enabled)"), true);
        await input('Current write password', 'local tournament password', '.opencaselist-password-settings');
        await click('Save write protection', '.opencaselist-password-settings');
        await wait("!!document.querySelector('.opencaselist-password-settings [role=status]')");
        assert.equal(await js("window.api.openCaselist.writePasswordStatus().then(value => value.enabled)"), false);
        await js("document.querySelector('[data-setting=opencaselistRequirePasswordForWrites]').click()");
        await input('Current write password', 'local tournament password', '.opencaselist-password-settings');
        await input('New write password', 'updated tournament password', '.opencaselist-password-settings');
        await input('Confirm new write password', 'updated tournament password', '.opencaselist-password-settings');
        await click('Save write protection', '.opencaselist-password-settings');
        await wait("!!document.querySelector('.opencaselist-password-settings [role=status]')");
        assert.equal(await js("document.querySelector('.opencaselist-password-settings input[type=password]').value"), '');
      } else {
        assert.deepEqual(await js("window.api.openCaselist.writePasswordStatus()"), { enabled: true, passwordSet: true, unlocked: false });
        await assert.rejects(js("window.api.openCaselist.write('delete-round', { caselist: 'ndt2026', school: 'Example', team: 'AB', round: 1 })"), /password required/);
      }
      await click('Open OpenCaselist', '.settings');
      await wait("!!document.querySelector('.opencaselist-dialog')");
      if (!first) {
        await wait("document.querySelector('.opencaselist-dialog').textContent.includes('Signed in')");
        assert.equal(loginWindows, 0, 'Session survives application restart');
        await wait("document.querySelectorAll('[data-caselist-select=caselist] option').length === 2");
        await click('Sign out');
        await wait("document.querySelector('.opencaselist-dialog').textContent.includes('Not signed in')");
        assert.equal((await fromPartition('persist:opencaselist').cookies.get({ name: 'caselist_token' })).length, 0);
        app.exit(0);
        return;
      }
      await click('Sign in');
      await wait("document.querySelectorAll('[data-caselist-select=caselist] option').length === 2");
      assert.equal(loginWindows, 1);
      assert.equal(await js("JSON.stringify(window.api).includes('mock-private-cookie')"), false);
      await select('caselist', 'ndt2026');
      await select('school', 'Example');
      await select('team', 'AB');
      await wait("!!document.querySelector('.opencaselist-card')");
      assert.ok(await js("document.querySelector('.opencaselist-dialog').textContent.includes('Evidence citation')"));
      await click('Download to vault');
      await wait("!!document.querySelector('.opencaselist-dialog [role=status]') && document.querySelector('.opencaselist-dialog').textContent.includes('Saved disclosure:')");
      assert.deepEqual(fs.readFileSync(path.join(vault, 'Disclosure.docx')), binary);
      assert.equal(fs.readFileSync(path.join(vault, 'Keep.md'), 'utf8'), '# Local evidence');
      const writes = () => apiRequests.filter((request) => request.method !== 'GET');
      await click('Delete round');
      await wait("!!document.querySelector('.opencaselist-write-unlock')");
      assert.equal(writes().length, 0);
      await click('Cancel', '.opencaselist-write-unlock');
      await wait("!document.querySelector('.opencaselist-write-unlock')");
      assert.equal(writes().length, 0, 'Cancelling the password prompt prevents writes');
      await click('Delete round');
      await wait("!!document.querySelector('.opencaselist-write-unlock')");
      await input('Write password', 'wrong password');
      await click('Unlock and continue');
      await wait("document.querySelector('.opencaselist-dialog [role=alert]')?.textContent.includes('Incorrect')");
      assert.equal(writes().length, 0);
      await input('Write password', 'updated tournament password');
      await click('Unlock and continue');
      await wait("!document.querySelector('.opencaselist-write-unlock')");
      await wait("!document.querySelector('.opencaselist-selectors').disabled");
      assert.equal(writes().length, 0, 'Native cancellation prevents server changes');
      allowChange = true;
      await click('Edit round');
      await input('Tournament', 'Updated tournament');
      await click('Review and publish…');
      await wait("!document.querySelector('.opencaselist-form')");
      assert.equal(rounds[0].tournament, 'Updated tournament');
      assert.equal(rounds[0].opensource, 'ndt2026/Disclosure.docx');
      assert.equal(await js("!!document.querySelector('.opencaselist-write-unlock')"), false, 'Write activity reuses the unlock');
      await click('Upload disclosure');
      await input('Tournament', 'Uploaded tournament'); await input('Round', '2');
      await click('Choose file and publish…');
      await wait("!document.querySelector('.opencaselist-form')");
      assert.equal(writes().at(-1).body.opensource, fs.readFileSync(uploadFile).toString('base64'));
      assert.equal(writes().at(-1).body.filename, 'Upload.docx');
      await click('Add citations');
      await input('Title', 'New citation'); await input('Citations', 'Author, 2026');
      await click('Review and publish…');
      await wait("!document.querySelector('.opencaselist-form')");
      assert.ok(cites.some((cite) => cite.title === 'New citation'));
      await click('Delete citations');
      await wait("!document.querySelector('.opencaselist-selectors').disabled");
      assert.equal(cites.some((cite) => cite.cite_id === 1), false);
      await input('Search disclosures', 'evidence');
      await click('Search');
      await wait("!!document.querySelector('section[aria-label=\"Search results\"]')");
      assert.equal(await js("!!document.querySelector('.opencaselist-card img') || !!window.attacked"), false);
      failTeamBrowse = true;
      await click('Browse team');
      await wait("!!document.querySelector('.opencaselist-dialog [role=alert]')");
      assert.equal(await js("document.querySelector('[data-caselist-select=school]').value"), 'Example',
        'Failed search navigation must not change the selected school');
      await click('Clear search');
      assert.ok(await js("document.querySelector('.opencaselist-card').textContent.includes('Updated tournament')"),
        'Failed navigation retains the original team and its disclosures together');
      failTeamBrowse = false;
      await click('Search');
      await wait("!!document.querySelector('section[aria-label=\"Search results\"]')");
      await click('Browse team');
      await wait("!document.querySelector('section[aria-label=\"Search results\"]')");
      assert.equal(await js("document.querySelector('[data-caselist-select=school]').value"), 'Other');
      assert.equal(await js("document.querySelector('[data-caselist-select=team]').value"), 'CD');
      assert.ok(await js("document.querySelector('.opencaselist-card').textContent.includes('Other tournament')"));
      assert.equal(await js("document.querySelector('.opencaselist-dialog').textContent.includes('Updated tournament')"), false);
      await select('school', 'Example');
      await select('team', 'AB');
      await click('Add round');
      await input('Tournament', 'Preserved draft'); await input('Round', '3');
      expireWrite = true;
      const beforeExpiredWrite = writes().length;
      await click('Review and publish…');
      await wait("!!document.querySelector('.opencaselist-dialog [role=alert]')");
      assert.equal(writes().length, beforeExpiredWrite + 1, 'Expired writes are not automatically retried');
      assert.equal(rounds.some((round) => round.tournament === 'Preserved draft'), false);
      await click('Sign in');
      await wait("!!document.querySelector('.opencaselist-form')");
      assert.equal(await js("document.querySelector('.opencaselist-form input').value"), 'Preserved draft');
      await click('Cancel');
      await input('Search disclosures', 'expire');
      await click('Search');
      await wait("!!document.querySelector('.opencaselist-dialog [role=alert]')");
      assert.match(await js("document.querySelector('.opencaselist-dialog [role=alert]').textContent"), /expired/);
      await click('Sign in');
      await wait("!!document.querySelector('.opencaselist-selectors')");
      assert.equal(loginWindows, 3);
      assert.ok(confirmed.length >= 5);
      assert.equal((await fromPartition('persist:tagline-web').cookies.get({ name: 'caselist_token' })).length, 0);
      await fromPartition('persist:opencaselist').cookies.flushStore();
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
});
require('../electron/main.cjs');
