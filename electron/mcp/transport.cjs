const http = require('node:http');
const crypto = require('node:crypto');

const MAX_BODY_BYTES = 4 * 1024 * 1024;

function tokensMatch(actual, expected) {
  const a = crypto.createHash('sha256').update(String(actual)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

function createMcpHttpServer({ service, getToken }) {
  let server = null;
  let port = 0;

  const reply = (res, status, body, headers = {}) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...headers,
    });
    res.end(payload);
  };

  async function onRequest(req, res) {
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
    if (!hosts.includes(String(req.headers.host).toLowerCase()) || req.headers.origin) {
      return reply(res, 403, { error: 'Forbidden.' });
    }
    if (new URL(req.url, 'http://localhost').pathname !== '/mcp') {
      return reply(res, 404, { error: 'Not found. Use /mcp.' });
    }
    const authorization = String(req.headers.authorization || '');
    if (!authorization.startsWith('Bearer ') || !tokensMatch(authorization.slice(7), getToken())) {
      return reply(
        res,
        401,
        { error: 'Missing or invalid bearer token.' },
        {
          'WWW-Authenticate': 'Bearer realm="tagline"',
        }
      );
    }
    if (req.method !== 'POST') {
      return reply(res, 405, { error: 'Use POST.' }, { Allow: 'POST' });
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        return reply(res, 413, { error: 'Request too large.' });
      }
      chunks.push(chunk);
    }
    let message;
    try {
      message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return reply(res, 400, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error.' },
      });
    }
    if (Array.isArray(message)) {
      const responses = (await Promise.all(message.map((item) => service.handle(item)))).filter(
        Boolean
      );
      return responses.length ? reply(res, 200, responses) : reply(res, 202);
    }
    const response = await service.handle(message);
    return response ? reply(res, 200, response) : reply(res, 202);
  }

  return {
    get port() {
      return port;
    },
    listen: (requestedPort) =>
      new Promise((resolve, reject) => {
        const next = http.createServer((req, res) => {
          onRequest(req, res).catch(() => {
            if (!res.headersSent) {
              reply(res, 500, { error: 'Internal error.' });
            }
          });
        });
        next.once('error', reject);
        next.listen(requestedPort, '127.0.0.1', () => {
          next.removeListener('error', reject);
          server = next;
          port = next.address().port;
          resolve(port);
        });
      }),
    close: () =>
      new Promise((resolve) => {
        if (!server) {
          resolve();
          return;
        }
        const closing = server;
        server = null;
        port = 0;
        closing.close(() => resolve());
        closing.closeAllConnections();
      }),
  };
}

module.exports = { createMcpHttpServer };
