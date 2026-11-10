const http = require('node:http');
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');
const { validateNetworkRequest } = require('../extensionNetwork.cjs');

const MAX_TIMEOUT_MS = 5 * 60_000;

function beginExtensionAuthorization({
  address,
  networkHosts,
  timeoutMs = MAX_TIMEOUT_MS,
  openExternal,
}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`OAuth timeout must be from 1000 to ${MAX_TIMEOUT_MS} ms.`);
  }
  if (typeof openExternal !== 'function') {
    throw new Error('Browser opening is unavailable.');
  }

  const request = validateNetworkRequest(networkHosts, address);
  const authorizationUrl = request.url;
  if (
    authorizationUrl.searchParams.has('state') ||
    authorizationUrl.searchParams.has('code_challenge') ||
    authorizationUrl.searchParams.has('code_challenge_method')
  ) {
    throw new Error('Do not supply OAuth state or PKCE parameters; Tagline generates them.');
  }
  const state = randomBytes(32).toString('base64url');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const callbackPath = `/tagline-oauth/${randomBytes(18).toString('base64url')}`;
  let server;
  let timer;
  let rejectPending;
  let settled = false;
  let listening = false;
  let redirectUri;

  const cleanup = () => {
    clearTimeout(timer);
    if (server?.listening) {
      server.close();
      server.closeAllConnections?.();
    }
  };

  const promise = new Promise((resolve, reject) => {
    rejectPending = reject;
    const finish = (error, value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };

    server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
      const host = `127.0.0.1:${server.address()?.port}`;
      if (req.method !== 'GET' || req.headers.host !== host || !req.url || req.url.length > 8192) {
        res.writeHead(400).end('Invalid authorization callback.');
        return;
      }
      let callback;
      try {
        callback = new URL(req.url, `http://${host}`);
      } catch {
        res.writeHead(400).end('Invalid authorization callback URL.');
        return;
      }
      const receivedState = callback.searchParams.get('state') || '';
      if (
        callback.origin !== `http://${host}` ||
        callback.pathname !== callbackPath ||
        callback.searchParams.getAll('state').length !== 1 ||
        Buffer.byteLength(receivedState) !== Buffer.byteLength(state) ||
        !timingSafeEqual(Buffer.from(receivedState), Buffer.from(state))
      ) {
        res.writeHead(400).end('Invalid authorization callback.');
        return;
      }
      const parameters = Object.create(null);
      for (const [key, value] of callback.searchParams) {
        if (!key || key.length > 128 || value.length > 4096 || Object.hasOwn(parameters, key)) {
          res.writeHead(400).end('Invalid authorization callback parameters.');
          return;
        }
        parameters[key] = value;
      }
      if (Boolean(parameters.code) === Boolean(parameters.error)) {
        res.writeHead(400).end('Invalid authorization result.');
        return;
      }
      res.end('Authorization complete. You can close this tab and return to Tagline.', () =>
        finish(null, { redirectUri, codeVerifier, parameters })
      );
    });
    server.once('error', (error) => finish(error));
    server.listen(0, '127.0.0.1', async () => {
      if (settled) {
        cleanup();
        return;
      }
      listening = true;
      redirectUri = `http://127.0.0.1:${server.address().port}${callbackPath}`;
      authorizationUrl.searchParams.set('redirect_uri', redirectUri);
      authorizationUrl.searchParams.set('state', state);
      authorizationUrl.searchParams.set('code_challenge', codeChallenge);
      authorizationUrl.searchParams.set('code_challenge_method', 'S256');
      timer = setTimeout(() => finish(new Error('OAuth authorization timed out.')), timeoutMs);
      try {
        await openExternal(authorizationUrl.href);
      } catch {
        finish(new Error('Could not open the authorization page in your browser.'));
      }
    });
  });
  promise.catch(() => {});

  return {
    promise,
    cancel() {
      if (!settled) {
        settled = true;
        cleanup();
        rejectPending(new Error('OAuth authorization canceled.'));
      }
    },
    get listening() {
      return listening;
    },
  };
}

module.exports = { beginExtensionAuthorization, MAX_TIMEOUT_MS };
