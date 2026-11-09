const https = require('node:https');
const http = require('node:http');
const dns = require('node:dns');
const net = require('node:net');

function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  return net.isIP(address) === 6 && /^[23]/.test(address) && !/^2001:(?:db8|0):/i.test(address);
}

function validateUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a valid article URL.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port))
  ) {
    throw new Error('Use a public HTTP or HTTPS article URL.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || (net.isIP(host) && !publicAddress(host))) {
    throw new Error('Local and private network URLs are not supported.');
  }
  return url;
}

// DNS lookup that refuses hosts resolving to private or local addresses.
function publicLookup(host, options, callback) {
  dns.lookup(host, { all: true }, (error, addresses) => {
    if (error) {
      return callback(error);
    }
    if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) {
      return callback(new Error('Local and private network URLs are not supported.'));
    }
    callback(null, options.all ? addresses : addresses[0].address, addresses[0].family);
  });
}

function download(url, redirects = 0, responseType = 'html') {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).get(
      url,
      {
        headers: {
          Accept:
            responseType === 'json'
              ? 'application/json'
              : responseType === 'article'
                ? 'text/html,application/xhtml+xml,text/plain'
                : 'text/html,application/xhtml+xml',
          'Accept-Encoding': 'identity',
          'User-Agent': 'Tagline/0.0.1 CitationMetadata',
        },
        lookup: publicLookup,
      },
      (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.resume();
          if (redirects >= 4) {
            return reject(new Error('The article redirected too many times.'));
          }
          try {
            resolve(
              download(
                validateUrl(new URL(response.headers.location, url).href),
                redirects + 1,
                responseType
              )
            );
          } catch (error) {
            reject(error);
          }
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          const restricted = [401, 402, 403, 429].includes(response.statusCode);
          const message =
            responseType === 'article'
              ? `The source website returned HTTP ${response.statusCode}. Open the original source to review it manually.`
              : restricted
                ? `Automated metadata access is restricted (HTTP ${response.statusCode}). Use a DOI URL or enter citation details manually.`
                : `The website returned HTTP ${response.statusCode}. Enter citation details manually.`;
          return reject(new Error(message));
        }
        const contentType = response.headers['content-type'] || '';
        if (
          responseType === 'article' &&
          response.headers['content-encoding'] &&
          response.headers['content-encoding'] !== 'identity'
        ) {
          response.resume();
          return reject(new Error('Compressed source responses are not supported.'));
        }
        const charset = contentType.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1];
        if (responseType === 'article' && charset && !/^utf-?8$/i.test(charset)) {
          response.resume();
          return reject(new Error('Only UTF-8 source pages are supported.'));
        }
        const acceptedType =
          responseType === 'json'
            ? /^application\/(?:json|[\w.+-]+\+json)\b/i.test(contentType)
            : /^(text\/html|application\/xhtml\+xml)\b/i.test(contentType) ||
              (responseType === 'article' && /^text\/plain\b/i.test(contentType));
        if (!acceptedType) {
          response.resume();
          return reject(
            new Error(
              `The URL did not return ${responseType === 'json' ? 'JSON metadata' : responseType === 'article' ? 'HTML or plain text' : 'an HTML article'}.`
            )
          );
        }
        let size = 0;
        const chunks = [];
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > 2_000_000) {
            request.destroy(
              new Error(
                responseType === 'article'
                  ? 'The source is too large to compare.'
                  : 'The article is too large to extract metadata.'
              )
            );
          } else {
            chunks.push(chunk);
          }
        });
        response.on('error', reject);
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve(
            responseType === 'json'
              ? { json: body, url: url.href }
              : { html: body, url: url.href, contentType }
          );
        });
      }
    );
    const deadline = setTimeout(
      () => request.destroy(new Error('The website took too long to respond.')),
      15000
    );
    request.on('close', () => clearTimeout(deadline));
    request.on('error', reject);
  });
}

module.exports = { publicAddress, publicLookup, validateUrl, download };
