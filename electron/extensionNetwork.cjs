const https = require('node:https');
const net = require('node:net');
const { domainToASCII } = require('node:url');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { publicLookup } = require('./citationMetadata.cjs');

const MAX_NETWORK_HOSTS = 20;
const MAX_REQUEST_BYTES = 5_000_000;
const MAX_RESPONSE_BYTES = 5_000_000;
const MAX_HEADER_COUNT = 32;
const MAX_HEADER_BYTES = 16_384;
const REQUEST_TIMEOUT_MS = 30_000;
const HOST_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const BLOCKED_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.test',
  '.invalid',
  '.example',
  '.onion',
];
const BLOCKED_HEADERS = new Set([
  'accept-encoding',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'expect',
  'host',
  'origin',
  'proxy-authorization',
  'proxy-connection',
  'referer',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'user-agent',
]);

function validateNetworkHosts(value) {
  if (!Array.isArray(value) || value.length > MAX_NETWORK_HOSTS) {
    throw new Error(`networkHosts must be a list of at most ${MAX_NETWORK_HOSTS} hosts.`);
  }
  const hosts = value.map((host) => {
    if (typeof host !== 'string' || host !== host.trim() || host !== host.toLowerCase()) {
      throw new Error('Network hosts must be lowercase DNS names.');
    }
    const ascii = domainToASCII(host);
    if (
      !ascii ||
      ascii !== host ||
      !HOST_PATTERN.test(ascii) ||
      !/[a-z]/.test(ascii) ||
      net.isIP(ascii) ||
      ascii === 'localhost' ||
      BLOCKED_SUFFIXES.some((suffix) => ascii.endsWith(suffix))
    ) {
      throw new Error(
        'Network hosts must be exact public DNS names without wildcards, schemes, or ports.'
      );
    }
    return ascii;
  });
  if (new Set(hosts).size !== hosts.length) {
    throw new Error('Network hosts must be unique.');
  }
  return hosts;
}

function validateNetworkRequest(
  networkHosts,
  address,
  options = {},
  timeoutCap = REQUEST_TIMEOUT_MS
) {
  if (typeof address !== 'string' || address.length > 2048) {
    throw new Error('Network URL must be text up to 2048 characters.');
  }
  let url;
  try {
    url = new URL(address);
  } catch {
    throw new Error('Network URL is invalid.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !networkHosts.includes(url.hostname.toLowerCase())
  ) {
    throw new Error('Use HTTPS on an exact host declared in networkHosts.');
  }
  url.hash = '';
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Network options must be an object.');
  }
  if (
    Object.keys(options).some(
      (key) => !['method', 'headers', 'body', 'timeoutMs', 'responseType'].includes(key)
    )
  ) {
    throw new Error('Invalid network option.');
  }
  const method = options.method === undefined ? 'GET' : options.method;
  if (
    typeof method !== 'string' ||
    !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method.toUpperCase())
  ) {
    throw new Error('Unsupported network method.');
  }
  const normalizedMethod = method.toUpperCase();
  const body = options.body;
  if (body !== undefined && typeof body !== 'string') {
    throw new Error('Network request bodies must be text.');
  }
  if (body !== undefined && ['GET', 'HEAD'].includes(normalizedMethod)) {
    throw new Error('GET and HEAD requests cannot include a body.');
  }
  if (body !== undefined && Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) {
    throw new Error(`Network request bodies may not exceed ${MAX_REQUEST_BYTES} bytes.`);
  }
  const suppliedHeaders = options.headers === undefined ? {} : options.headers;
  if (
    !suppliedHeaders ||
    typeof suppliedHeaders !== 'object' ||
    Array.isArray(suppliedHeaders) ||
    Object.keys(suppliedHeaders).length > MAX_HEADER_COUNT
  ) {
    throw new Error(`Network headers must be an object with at most ${MAX_HEADER_COUNT} entries.`);
  }
  const headers = {
    'Accept-Encoding': 'identity',
    'User-Agent': 'Tagline Extension',
  };
  const names = new Set();
  let headerBytes = 0;
  for (const [name, value] of Object.entries(suppliedHeaders)) {
    const normalizedName = name.toLowerCase();
    if (
      !/^[!#$%&'*+-.^_`|~0-9a-z]+$/i.test(name) ||
      BLOCKED_HEADERS.has(normalizedName) ||
      names.has(normalizedName) ||
      typeof value !== 'string' ||
      value.length > 8192 ||
      /[\r\n]/.test(value)
    ) {
      throw new Error(`Invalid or unsupported network header: ${name}.`);
    }
    names.add(normalizedName);
    headerBytes += Buffer.byteLength(name, 'utf8') + Buffer.byteLength(value, 'utf8');
    if (headerBytes > MAX_HEADER_BYTES) {
      throw new Error(`Network headers may not exceed ${MAX_HEADER_BYTES} bytes.`);
    }
    headers[name] = value;
  }
  const timeoutMs =
    options.timeoutMs === undefined ? Math.min(REQUEST_TIMEOUT_MS, timeoutCap) : options.timeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > timeoutCap) {
    throw new Error(`Network timeout must be from 1 to ${timeoutCap} ms.`);
  }
  const responseType = options.responseType === undefined ? 'text' : options.responseType;
  if (!['text', 'json', 'base64'].includes(responseType)) {
    throw new Error('Network responseType must be text, json, or base64.');
  }
  return { url, method: normalizedMethod, headers, body, timeoutMs, responseType };
}

function responseInfo(response) {
  const headers = Object.fromEntries(
    Object.entries(response.headers).filter(
      ([name, value]) => value !== undefined && name !== 'set-cookie'
    )
  );
  const status = response.statusCode || 0;
  return {
    status,
    statusText: response.statusMessage || '',
    ok: status >= 200 && status < 300,
    headers,
  };
}

function requestExtensionNetwork(networkHosts, address, options, timeoutCap = REQUEST_TIMEOUT_MS) {
  const request = validateNetworkRequest(networkHosts, address, options, timeoutCap);
  return new Promise((resolve, reject) => {
    const outgoing = https.request(
      request.url,
      {
        method: request.method,
        headers: request.headers,
        lookup: publicLookup,
      },
      (response) => {
        const contentLength = Number(response.headers['content-length']);
        if (
          request.method !== 'HEAD' &&
          Number.isFinite(contentLength) &&
          contentLength > MAX_RESPONSE_BYTES
        ) {
          response.resume();
          outgoing.destroy(
            new Error(`Network responses may not exceed ${MAX_RESPONSE_BYTES} bytes.`)
          );
          return;
        }
        if (
          response.headers['content-encoding'] &&
          response.headers['content-encoding'] !== 'identity'
        ) {
          response.resume();
          outgoing.destroy(new Error('Compressed network responses are not supported.'));
          return;
        }
        const chunks = [];
        let size = 0;
        let exceeded = false;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            exceeded = true;
            outgoing.destroy(
              new Error(`Network responses may not exceed ${MAX_RESPONSE_BYTES} bytes.`)
            );
          } else if (!exceeded) {
            chunks.push(chunk);
          }
        });
        response.on('error', reject);
        response.on('aborted', () => reject(new Error('Network response ended unexpectedly.')));
        response.on('end', () => {
          if (exceeded) {
            return;
          }
          const bytes = Buffer.concat(chunks);
          let body = bytes.toString(request.responseType === 'base64' ? 'base64' : 'utf8');
          if (request.responseType === 'json') {
            try {
              body = JSON.parse(body);
            } catch {
              reject(new Error('Network response is not valid JSON.'));
              return;
            }
          }
          resolve({ ...responseInfo(response), body });
        });
      }
    );
    const deadline = setTimeout(
      () => outgoing.destroy(new Error('Network request timed out.')),
      request.timeoutMs
    );
    outgoing.on('close', () => clearTimeout(deadline));
    outgoing.on('error', reject);
    if (request.body !== undefined) {
      outgoing.write(request.body);
    }
    outgoing.end();
  });
}

// The caller owns and removes the exclusively opened temporary file.
function downloadExtensionNetwork(networkHosts, address, options, timeoutCap, maxBytes, file) {
  const request = validateNetworkRequest(networkHosts, address, options, timeoutCap);
  if (options?.responseType !== undefined) {
    throw new Error('responseType is not supported for downloads.');
  }
  return new Promise((resolve, reject) => {
    let activeResponse;
    const outgoing = https.request(
      request.url,
      {
        method: request.method,
        headers: request.headers,
        lookup: publicLookup,
      },
      (response) => {
        const info = responseInfo(response);
        const length = Number(response.headers['content-length']);
        const tooLarge = request.method !== 'HEAD' && Number.isFinite(length) && length > maxBytes;
        if (
          !info.ok ||
          tooLarge ||
          (response.headers['content-encoding'] &&
            response.headers['content-encoding'] !== 'identity')
        ) {
          response.resume();
          outgoing.destroy(
            new Error(
              !info.ok
                ? `Download failed with HTTP ${info.status}.`
                : tooLarge
                  ? `Network downloads may not exceed ${maxBytes} bytes.`
                  : 'Compressed network responses are not supported.'
            )
          );
          return;
        }
        activeResponse = response;
        let size = 0;
        const bound = new Transform({
          transform(chunk, _encoding, callback) {
            size += chunk.length;
            callback(
              size > maxBytes
                ? new Error(`Network downloads may not exceed ${maxBytes} bytes.`)
                : null,
              chunk
            );
          },
        });
        pipeline(response, bound, file.createWriteStream()).then(
          () => resolve({ ...info, bytes: size }),
          reject
        );
      }
    );
    const deadline = setTimeout(
      () => outgoing.destroy(new Error('Network request timed out.')),
      request.timeoutMs
    );
    outgoing.on('close', () => clearTimeout(deadline));
    outgoing.on('error', (error) => {
      if (activeResponse) {
        activeResponse.destroy(error);
      } else {
        reject(error);
      }
    });
    if (request.body !== undefined) {
      outgoing.write(request.body);
    }
    outgoing.end();
  });
}

module.exports = {
  MAX_NETWORK_HOSTS,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  validateNetworkHosts,
  validateNetworkRequest,
  requestExtensionNetwork,
  downloadExtensionNetwork,
};
