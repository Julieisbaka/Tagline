const http = require('node:http');
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');

const CLIENT_ID = '818494340995-sn11ahtnhgepgmuppijsank8hktpglli.apps.googleusercontent.com';
const SCOPES = ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/drive.file'];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id%2Cname%2CmimeType';

function createGoogleOAuth({ shell, fetchImpl = fetch, authorizationTimeout = 180000 }) {
  let cancelPending;
  const request = async (url, options, upload = false) => {
    let response;
    try {
      response = await fetchImpl(url, {
        ...options, redirect: 'error', credentials: 'omit',
        signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(upload ? 120000 : 30000)])
          : AbortSignal.timeout(upload ? 120000 : 30000),
      });
    } catch {
      throw new Error(upload
        ? 'Google Drive upload could not be confirmed. Check Drive before retrying; a document may already have been created.'
        : 'Cannot reach Google. Check your connection and try again.');
    }
    const limit = 64 * 1024;
    if (!response.body) throw new Error('Google returned an empty response.');
    const reader = response.body.getReader();
    let bytes = 0;
    const chunks = [];
    try {
      if (Number(response.headers.get('content-length')) > limit) throw new Error('Google response is too large.');
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > limit) throw new Error('Google response is too large.');
        chunks.push(Buffer.from(value));
      }
    } catch {
      throw new Error(upload
        ? 'Cannot read the Google Drive result. Check Drive before retrying.'
        : 'Cannot read the Google authorization response. Try connecting again.');
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error(upload ? 'Invalid Google Drive result. Check Drive before retrying.' : 'Google returned an invalid authorization response.'); }
    if (!response.ok) {
      if (data?.error === 'invalid_grant' || response.status === 401)
        throw new Error('Google authorization expired or was revoked. Reconnect this Google account in Settings. Testing-mode authorization may expire after seven days.');
      if (response.status === 403) throw new Error('Google denied access. Check granted permissions, Drive API availability, account policies, storage and quotas.');
      throw new Error(`Google request failed (HTTP ${response.status}).${upload ? ' Check Drive before retrying.' : ' Check the OAuth client configuration and try again.'}`);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Google returned an invalid response.');
    return data;
  };
  const tokens = async (parameters, requireRefresh, signal) => {
    const data = await request(TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal,
      body: new URLSearchParams({ client_id: CLIENT_ID, ...parameters }).toString(),
    });
    if (typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 16384 ||
      /[\r\n]/.test(data.access_token) || typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer' ||
      (requireRefresh && (typeof data.refresh_token !== 'string' || !data.refresh_token)) ||
      (data.refresh_token !== undefined && (typeof data.refresh_token !== 'string' ||
        !data.refresh_token || data.refresh_token.length > 16384)))
      throw new Error('Google did not return valid offline authorization. Connect the account again.');
    const granted = typeof data.scope === 'string' ? data.scope.split(' ') : [];
    if (requireRefresh && (!granted.includes('openid') ||
      !granted.includes('https://www.googleapis.com/auth/drive.file') ||
      !granted.some((scope) => scope === 'email' || scope === 'https://www.googleapis.com/auth/userinfo.email')))
      throw new Error('Google did not grant all required permissions. Connect again and allow email and file access.');
    return { accessToken: data.access_token, refreshToken: data.refresh_token };
  };
  const account = async (accessToken, signal) => {
    const data = await request(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` }, signal });
    if (typeof data.sub !== 'string' || !data.sub || data.sub.length > 255 ||
      typeof data.email !== 'string' || data.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) || data.email_verified !== true)
      throw new Error('Google did not identify a verified account.');
    return { subject: data.sub, account: { email: data.email.toLowerCase(), displayName: '' } };
  };
  const authorize = async () => {
    if (cancelPending) throw new Error('Google sign-in is already in progress.');
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    let cancelReason;
    const controller = new AbortController();
    let resolveCode, rejectCode;
    const codePromise = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
    // Opening the browser may still be pending when cancellation or timeout fires.
    codePromise.catch(() => { });
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
      const host = `127.0.0.1:${server.address()?.port}`;
      if (req.method !== 'GET' || req.headers.host !== host || !req.url || req.url.length > 8192) {
        res.writeHead(400); res.end('Invalid sign-in callback.'); return;
      }
      let url;
      try { url = new URL(req.url, `http://${host}`); }
      catch { res.writeHead(400); res.end('Invalid sign-in callback URL.'); return; }
      const receivedState = url.searchParams.get('state') || '';
      if (url.origin !== `http://${host}` || url.pathname !== '/oauth2callback' || url.searchParams.getAll('state').length !== 1 ||
        Buffer.byteLength(receivedState) !== Buffer.byteLength(state) || !timingSafeEqual(Buffer.from(receivedState), Buffer.from(state))) {
        res.writeHead(400); res.end('Invalid sign-in callback.'); return;
      }
      if (url.searchParams.has('error')) {
        res.end('Sign-in was not completed. Return to Tagline.');
        rejectCode(new Error('Google sign-in was declined or could not be completed.'));
      } else if (url.searchParams.getAll('code').length === 1 && url.searchParams.get('code')) {
        res.end('You can close this tab and return to Tagline to finish connecting.');
        resolveCode(url.searchParams.get('code'));
      } else {
        res.writeHead(400); res.end('Missing authorization code.');
        rejectCode(new Error('Google did not return an authorization code.'));
      }
    });
    cancelPending = () => {
      cancelReason = new Error('Google sign-in canceled.');
      controller.abort();
      rejectCode(cancelReason);
    };
    const timer = setTimeout(() => {
      cancelReason = new Error('Google sign-in timed out. Try connecting again.');
      controller.abort();
      rejectCode(cancelReason);
    }, authorizationTimeout);
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      server.on('error', rejectCode);
      const redirect = `http://127.0.0.1:${server.address().port}/oauth2callback`;
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({
        client_id: CLIENT_ID, redirect_uri: redirect, response_type: 'code',
        scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent select_account',
        state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
      }).toString();
      try { await shell.openExternal(url.href); }
      catch { throw new Error('Cannot open the Google sign-in page in your browser.'); }
      const code = await codePromise;
      const result = await tokens({ code, code_verifier: verifier, redirect_uri: redirect, grant_type: 'authorization_code' }, true, controller.signal);
      const identity = await account(result.accessToken, controller.signal);
      if (cancelReason) throw cancelReason;
      return { ...result, ...identity };
    } catch (error) {
      throw cancelReason || error;
    } finally {
      clearTimeout(timer);
      cancelPending = undefined;
      server.close();
      server.closeAllConnections();
    }
  };
  const refresh = (refreshToken) => tokens({ refresh_token: refreshToken, grant_type: 'refresh_token' }, false);
  const upload = async (accessToken, title, mimeType, bytes) => {
    const boundary = `tagline_${randomBytes(24).toString('hex')}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify({ name: title, mimeType: 'application/vnd.google-apps.document' })}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
      bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const data = await request(UPLOAD_URL, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
    }, true);
    if (typeof data.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(data.id) ||
      data.mimeType !== 'application/vnd.google-apps.document')
      throw new Error('Google Drive did not confirm a new Google Doc. Check Drive before retrying.');
    return { id: data.id, title, url: `https://docs.google.com/document/d/${data.id}/edit` };
  };
  return { authorize, refresh, account, upload, cancel: () => cancelPending?.() };
}

module.exports = { createGoogleOAuth, CLIENT_ID, SCOPES, TOKEN_URL, USERINFO_URL, UPLOAD_URL };
