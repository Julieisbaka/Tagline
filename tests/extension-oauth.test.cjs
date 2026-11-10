const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { beginExtensionAuthorization } = require('../electron/extensions/oauth.cjs');

function get(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      })
      .on('error', reject);
  });
}

test('extension OAuth uses an ephemeral loopback redirect and validates state', async () => {
  let badStateStatus;
  let receivedState;
  let receivedCodeChallenge;
  const flow = beginExtensionAuthorization({
    address: 'https://auth.example.com/authorize?client_id=client&response_type=code',
    networkHosts: ['auth.example.com'],
    timeoutMs: 5000,
    openExternal: async (authorizationAddress) => {
      const authorization = new URL(authorizationAddress);
      const redirect = new URL(authorization.searchParams.get('redirect_uri'));
      receivedState = authorization.searchParams.get('state');
      receivedCodeChallenge = authorization.searchParams.get('code_challenge');
      assert.equal(redirect.hostname, '127.0.0.1');
      assert.equal(redirect.protocol, 'http:');
      assert.equal(authorization.searchParams.get('client_id'), 'client');
      assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(await get(`${redirect.href}?state=wrong&code=nope`), 400);
      badStateStatus = 400;
      assert.equal(
        await get(
          `${redirect.href}?state=${encodeURIComponent(authorization.searchParams.get('state'))}&code=abc&scope=profile`
        ),
        200
      );
    },
  });
  const result = await flow.promise;
  assert.equal(badStateStatus, 400);
  assert.equal(result.redirectUri.startsWith('http://127.0.0.1:'), true);
  assert.equal(result.parameters.state, receivedState);
  assert.equal(result.parameters.code, 'abc');
  assert.equal(result.parameters.scope, 'profile');
  assert.equal(
    createHash('sha256').update(result.codeVerifier).digest('base64url'),
    receivedCodeChallenge
  );
});

test('extension OAuth rejects unapproved destinations and caller-supplied state', () => {
  const common = { networkHosts: ['auth.example.com'], openExternal: async () => {} };
  assert.throws(
    () => beginExtensionAuthorization({ ...common, address: 'http://auth.example.com/authorize' }),
    /HTTPS/
  );
  assert.throws(
    () =>
      beginExtensionAuthorization({ ...common, address: 'https://other.example.com/authorize' }),
    /exact host/
  );
  assert.throws(
    () =>
      beginExtensionAuthorization({
        ...common,
        address: 'https://auth.example.com/authorize?state=mine',
      }),
    /generates them/
  );
  assert.throws(
    () =>
      beginExtensionAuthorization({
        ...common,
        address: 'https://auth.example.com/authorize?code_challenge=abc&code_challenge_method=S256',
      }),
    /generates them/
  );
});

test('extension OAuth can be canceled and closes its loopback server', async () => {
  let browserStarted;
  const started = new Promise((resolve) => {
    browserStarted = resolve;
  });
  const flow = beginExtensionAuthorization({
    address: 'https://auth.example.com/authorize',
    networkHosts: ['auth.example.com'],
    timeoutMs: 5000,
    openExternal: async () => browserStarted(),
  });
  await started;
  flow.cancel();
  await assert.rejects(flow.promise, /canceled/);
});
