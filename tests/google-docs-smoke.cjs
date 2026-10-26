if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tagline-google-docs-ui-'));
  try {
    const result = spawnSync(require('electron'), [__filename], {
      env: { ...process.env, TAGLINE_GOOGLE_DOCS_ROOT: root }, stdio: 'inherit', timeout: 90000,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
  return;
}

const { app, dialog, shell, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { TOKEN_URL, USERINFO_URL, UPLOAD_URL, SCOPES } = require('../electron/googleOAuth.cjs');
const nativeFetch = global.fetch;

(async () => {
  const root = process.env.TAGLINE_GOOGLE_DOCS_ROOT;
  if (!root) throw new Error('Run through npm run test:google-docs.');
  const profile = path.join(root, 'profile');
  const vault = path.join(root, 'vault');
  await fs.mkdir(profile);
  await fs.mkdir(vault);
  await fs.writeFile(path.join(vault, 'Evidence.md'), '# Evidence\n\n**Bold text** and ==highlighted evidence==.\n');
  await fs.writeFile(path.join(profile, 'config.json'), JSON.stringify({ lastVault: vault, modelAutoload: false }));
  const upload = path.join(root, 'Upload.html');
  await fs.writeFile(upload, '<h1>Uploaded evidence</h1>');
  app.setPath('userData', profile);
  const endpoint = 'https://script.google.com/macros/s/smoke-test/exec';
  const schoolEndpoint = 'https://script.google.com/macros/s/school-test/exec';
  const secret = 'smoke-test-secret-'.repeat(3);
  const schoolSecret = 'school-secret-'.repeat(3);
  const personalAccount = { email: 'personal@example.com', displayName: 'Personal' };
  const schoolAccount = { email: 'school@example.edu', displayName: 'School' };
  const docUrl = 'https://docs.google.com/document/d/smoke-doc/edit';
  const sent = [], confirmations = [], opened = [];
  const directUploads = [];
  let holdOAuth = false;
  let confirm = 1, resultCode = 201;
  global.fetch = async (url, init) => {
    if (url === TOKEN_URL) return new Response(JSON.stringify({
      access_token: 'smoke-access-token', refresh_token: 'smoke-refresh-token', token_type: 'Bearer', scope: SCOPES.join(' '),
    }));
    if (url === USERINFO_URL) return new Response(JSON.stringify({
      sub: 'smoke-subject', email: personalAccount.email, email_verified: true,
    }));
    if (url === UPLOAD_URL) {
      assert.equal(init.headers.Authorization, 'Bearer smoke-access-token');
      assert.equal(init.method, 'POST');
      directUploads.push(init.body);
      return new Response(JSON.stringify({ id: 'direct-doc', mimeType: 'application/vnd.google-apps.document' }));
    }
    assert.ok([endpoint, schoolEndpoint].includes(url), 'The smoke test must never contact real Google services');
    const payload = JSON.parse(init.body);
    const account = url === schoolEndpoint ? schoolAccount : personalAccount;
    assert.equal(payload.secret, url === schoolEndpoint ? schoolSecret : secret);
    if (payload.action === 'account') return new Response(JSON.stringify({
      ok: true, code: 200, document: null, account,
    }));
    assert.equal(payload.expectedAccount, account.email);
    sent.push({ ...payload, endpoint: url });
    return new Response(JSON.stringify({
      ok: resultCode === 201, code: resultCode, message: resultCode === 201 ? 'Created' : 'Incorrect secret',
      document: resultCode === 201 ? { id: 'smoke-doc', title: JSON.parse(init.body).title, url: docUrl } : null,
      account: resultCode === 201 ? account : null,
    }));
  };
  dialog.showMessageBox = async (_win, options) => {
    confirmations.push(options);
    return { response: confirm };
  };
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [upload] });
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(root, 'webhook.gs') });
  shell.openExternal = async (url) => {
    opened.push(url);
    if (url.startsWith('https://accounts.google.com/')) {
      if (holdOAuth) return;
      const authorization = new URL(url);
      const callback = new URL(authorization.searchParams.get('redirect_uri'));
      callback.search = new URLSearchParams({ code: 'mock-code', state: authorization.searchParams.get('state') });
      assert.equal((await nativeFetch(callback)).status, 200);
    }
  };

  app.on('browser-window-created', (_event, win) => {
    win.webContents.once('did-finish-load', async () => {
      const js = (code) => win.webContents.executeJavaScript(code);
      const wait = async (code) => {
        for (let i = 0; i < 120; i++) {
          if (await js(code)) return;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(`Timed out: ${code}`);
      };
      const button = (selector, text) => js(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(el => el.textContent.trim() === ${JSON.stringify(text)});
        if (!el) throw new Error('Missing button: ' + ${JSON.stringify(text)});
        el.click();
      })()`);
      const input = (selector, value) => js(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      const select = (selector, value) => js(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      try {
        await wait("!!document.querySelector('.onboarding-skip')");
        await js("document.querySelector('.onboarding-skip').click()");
        await wait("!!document.querySelector('.tree-item[title=\"Evidence.md\"]')");
        assert.equal(await safeStorage.isAsyncEncryptionAvailable(), true, 'Smoke test needs OS credential encryption');
        await js("document.querySelector('.ribbon-settings-button').click()");
        await wait("!!document.querySelector('[data-section=integrations]')");
        await js("document.querySelector('[data-section=integrations]').click()");
        await wait("!!document.querySelector('.google-docs-settings')");
        await button('.google-docs-settings button', 'Set up Google Docs transfer');
        await wait("!!document.querySelector('.google-docs-setup')");
        await wait(`(() => {
          const rect = document.querySelector('.google-docs-setup').getBoundingClientRect();
          return rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth;
        })()`);
        assert.equal(await js("document.querySelector('.google-docs-script textarea').value"),
          (await fs.readFile(path.join(__dirname, '..', 'electron', 'google-docs-webhook.gs'), 'utf8')).replace(/\r\n/g, '\n'));
        assert.match(await js("document.querySelector('.google-docs-setup').textContent"), /WEBHOOK_SECRET/);
        await button('.google-docs-setup button', 'Save script...');
        await wait("document.querySelector('.google-docs-setup').textContent.includes('Script saved')");
        assert.equal(await fs.readFile(path.join(root, 'webhook.gs'), 'utf8'),
          await fs.readFile(path.join(__dirname, '..', 'electron', 'google-docs-webhook.gs'), 'utf8'));
        await button('.google-docs-setup button', 'Close');
        await input('[data-setting=googleDocsEndpoint]', endpoint);
        await input('[data-setting=googleDocsSecret]', secret);
        await button('.google-docs-settings button', 'Save Google Docs connection');
        await wait("document.querySelector('.google-docs-settings').textContent.includes('configuration saved')");
        assert.equal(await js("document.querySelector('[data-setting=googleDocsSecret]').value"), '');
        assert.ok(!(await fs.readFile(path.join(profile, 'google-docs.json'), 'utf8')).includes(secret));
        assert.ok(!(await js("localStorage.getItem('tagline-settings')")).includes(secret));
        assert.equal(sent.length, 0, 'Saving verifies the account but must not upload documents');
        assert.ok(confirmations[0].detail.includes(personalAccount.email));

        await button('.google-docs-settings button', 'Upload DOCX or HTML...');
        await wait("document.querySelector('.google-docs-settings').textContent.includes('code 201')");
        assert.equal(sent[0].mimeType, 'text/html');
        assert.equal(Buffer.from(sent[0].contentBase64, 'base64').toString('utf8'), '<h1>Uploaded evidence</h1>');
        await button('.google-docs-settings button', 'Open Google Doc');
        assert.deepEqual(opened, [`${docUrl}?authuser=${encodeURIComponent(personalAccount.email)}`]);
        await select('[data-setting=googleDocsConnection]', '');
        await input('[data-setting=googleDocsEndpoint]', schoolEndpoint);
        await input('[data-setting=googleDocsSecret]', schoolSecret);
        await button('.google-docs-settings button', 'Save Google Docs connection');
        await wait("document.querySelector('.google-docs-settings').textContent.includes('configuration saved')");
        const connections = await js('window.api.googleDocs.status()');
        assert.equal(connections.connections.length, 2);
        const schoolId = connections.connections.find((item) => item.account.email === schoolAccount.email).id;
        const personalId = connections.connections.find((item) => item.account.email === personalAccount.email).id;
        assert.ok(confirmations.at(-1).detail.includes(schoolAccount.email));
        await button('.settings-footer button', 'Done');

        await js("document.querySelector('.tree-item[title=\"Evidence.md\"]').click()");
        await wait("!!document.querySelector('.note-actions')");
        await button('.note-actions button', 'Export');
        await wait("!!document.querySelector('.export-dialog')");
        await select('.export-dialog select', 'google-docs');
        await wait("document.querySelectorAll('[data-setting=googleDocsDestination] option').length === 3");
        assert.equal(await js("document.querySelector('[data-setting=googleDocsDestination]').value"), '');
        assert.equal(await js("document.querySelector('.export-dialog button.primary').disabled"), true);
        await select('[data-setting=googleDocsDestination]', schoolId);
        await wait("[...document.querySelectorAll('.export-dialog button')].some(el => el.textContent === 'Send to Google Docs')");
        confirm = 0;
        await button('.export-dialog button', 'Send to Google Docs');
        await wait("[...document.querySelectorAll('.export-dialog button')].some(el => el.textContent === 'Send to Google Docs' && !el.disabled)");
        assert.equal(sent.length, 1, 'Cancel must not send');
        confirm = 1;
        await button('.export-dialog button', 'Send to Google Docs');
        await wait("document.querySelector('.export-dialog').textContent.includes('code 201')");
        const html = Buffer.from(sent[1].contentBase64, 'base64').toString('utf8');
        assert.match(html, /<strong>Bold text<\/strong>/);
        assert.match(html, /highlighted evidence/);
        assert.equal(sent[1].secret, schoolSecret);
        assert.equal(sent[1].endpoint, schoolEndpoint);
        assert.equal(sent[1].title, 'Evidence');
        assert.ok(confirmations.at(-1).detail.includes(schoolAccount.email));
        await button('.export-dialog button', 'Open Google Doc');
        assert.equal(opened.at(-1), `${docUrl}?authuser=${encodeURIComponent(schoolAccount.email)}`);

        await select('[data-setting=googleDocsDestination]', personalId);
        resultCode = 401;
        await button('.export-dialog button', 'Send to Google Docs');
        await wait("document.querySelector('.export-dialog [role=alert]')?.textContent.includes('401')");
        assert.equal(sent.length, 3, 'Do not automatically retry');
        assert.equal(sent[2].endpoint, endpoint);
        assert.equal(sent[2].secret, secret);
        assert.equal(await js("!!document.querySelector('.export-dialog [role=status]')"), false);
        await button('.export-dialog button', 'Close');
        await js("document.querySelector('.ribbon-settings-button').click()");
        await wait("!!document.querySelector('[data-section=integrations]')");
        await js("document.querySelector('[data-section=integrations]').click()");
        await wait("!!document.querySelector('.google-docs-settings')");
        holdOAuth = true;
        await button('.google-docs-settings button', 'Connect Google account');
        await wait("[...document.querySelectorAll('.google-docs-settings button')].some(b=>b.textContent==='Cancel Google sign-in')");
        await button('.google-docs-settings button', 'Cancel Google sign-in');
        await wait("document.querySelector('.google-docs-settings [role=alert]')?.textContent.includes('canceled')");
        holdOAuth = false;
        await button('.google-docs-settings button', 'Connect Google account');
        await wait("document.querySelector('.google-docs-settings').textContent.includes('configuration saved')");
        const mixed = await js('window.api.googleDocs.status()');
        assert.equal(mixed.connections.length, 3);
        const oauth = mixed.connections.find(connection => connection.type === 'oauth');
        assert.ok(oauth);
        assert.equal(await js("!!document.querySelector('[data-setting=googleDocsEndpoint]')"), false);
        assert.equal(await js("document.querySelector('[data-setting=googleDocsConnection]').value"), oauth.id);
        const persisted = await fs.readFile(path.join(profile, 'google-docs.json'), 'utf8');
        assert.ok(!persisted.includes('smoke-refresh-token'));
        assert.ok(!persisted.includes('smoke-access-token'));
        await button('.google-docs-settings button', 'Upload DOCX or HTML...');
        await wait("document.querySelector('.google-docs-settings').textContent.includes('code 201')");
        assert.equal(directUploads.length, 1);
        assert.ok(directUploads[0].includes(Buffer.from('<h1>Uploaded evidence</h1>')));
        assert.match(confirmations.at(-1).detail, /directly to Google Drive/);
        await select('[data-setting=googleDocsConnection]', schoolId);
        assert.equal(await js("document.querySelector('[data-setting=googleDocsEndpoint]').value"), schoolEndpoint);
        await button('.settings-footer button', 'Done');
        await button('.note-actions button', 'Export');
        await wait("!!document.querySelector('.export-dialog')");
        await select('.export-dialog select', 'google-docs');
        await wait("document.querySelectorAll('[data-setting=googleDocsDestination] option').length === 4");
        assert.equal(await js("document.querySelector('[data-setting=googleDocsDestination]').value"), '');
        await select('[data-setting=googleDocsDestination]', oauth.id);
        await button('.export-dialog button', 'Send to Google Docs');
        await wait("document.querySelector('.export-dialog').textContent.includes('code 201')");
        assert.equal(directUploads.length, 2);
        assert.match(directUploads[1].toString(), /<strong>Bold text<\/strong>/);
        await button('.export-dialog button', 'Open Google Doc');
        assert.equal(opened.at(-1), `https://docs.google.com/document/d/direct-doc/edit?authuser=${encodeURIComponent(personalAccount.email)}`);
        console.log('PASS: Apps Script and OAuth coexist; browser sign-in/cancel, encrypted credentials, explicit destinations, script and direct file/note uploads, confirmations and errors (mocked Google).');
        app.exit(0);
      } catch (error) { console.error(error); app.exit(1); }
    });
  });
  require('../electron/main.cjs');
})().catch((error) => { console.error(error); app.exit(1); });
