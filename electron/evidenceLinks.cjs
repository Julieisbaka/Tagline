const https = require('node:https');
const http = require('node:http');
const { publicLookup, validateUrl } = require('./citationMetadata.cjs');

const MAX_URLS = 500;
const MAX_CONCURRENT = 4;
const MAX_REDIRECTS = 4;
const USER_AGENT = 'Tagline/0.0.1 EvidenceCheckup';
const DEAD_STATUSES = new Set([404, 410]);

/**
 * Send one request and resolve with the final response status, following redirects.
 * @param {URL} url - The URL to request; must already pass validateUrl.
 * @param {string} method - HTTP method, HEAD or GET.
 * @param {number} timeoutMs - Request timeout in milliseconds.
 * @param {number} [redirects] - Redirects already followed.
 * @returns {Promise<number>} - The HTTP status code.
 */
function probe(url, method, timeoutMs, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request(url, {
      method,
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
      lookup: publicLookup,
    }, (response) => {
      response.resume();
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        if (redirects >= MAX_REDIRECTS) return reject(new Error('too many redirects'));
        try {
          resolve(probe(validateUrl(new URL(response.headers.location, url).href), method, timeoutMs, redirects + 1));
        } catch (error) {
          reject(error);
        }
        return;
      }
      resolve(response.statusCode);
    });
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })));
    request.on('error', reject);
    request.end();
  });
}

/**
 * Fetch the closest Wayback Machine snapshot of a URL, if one exists.
 * @param {string} address - The original URL.
 * @param {number} timeoutMs - Request timeout in milliseconds.
 * @returns {Promise<string>} - The archived snapshot URL, or an empty string.
 */
function archiveSnapshot(address, timeoutMs) {
  const api = new URL('https://archive.org/wayback/available');
  api.searchParams.set('url', address);
  return new Promise((resolve) => {
    const request = https.get(api, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        return resolve('');
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('error', () => resolve(''));
      response.on('end', () => {
        try {
          const closest = JSON.parse(Buffer.concat(chunks).toString('utf8')).archived_snapshots?.closest;
          const archived = closest?.available && typeof closest.url === 'string' ? closest.url : '';
          resolve(archived.startsWith('https://web.archive.org/') ? archived : '');
        } catch {
          resolve('');
        }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy());
    request.on('error', () => resolve(''));
  });
}

/**
 * Check whether one cited URL still resolves.
 * @param {string} address - The cited URL.
 * @param {object} options - Timeout and archive-fallback settings.
 * @returns {Promise<object>} - `{ status, reason?, archiveUrl? }` where status is ok, dead, unverified, or skipped.
 */
async function checkUrl(address, { timeoutMs, archiveFallback }) {
  let url;
  try {
    url = validateUrl(address);
  } catch (error) {
    return { status: 'skipped', reason: error.message };
  }
  try {
    let status = await probe(url, 'HEAD', timeoutMs);
    if ([405, 501].includes(status)) status = await probe(url, 'GET', timeoutMs);
    if (status >= 200 && status < 400) return { status: 'ok' };
    if (DEAD_STATUSES.has(status)) {
      const archiveUrl = archiveFallback ? await archiveSnapshot(address, timeoutMs) : '';
      return { status: 'dead', reason: `HTTP ${status}`, archiveUrl };
    }
    return { status: 'unverified', reason: `HTTP ${status}` };
  } catch (error) {
    if (error.code === 'ENOTFOUND') {
      const archiveUrl = archiveFallback ? await archiveSnapshot(address, timeoutMs) : '';
      return { status: 'dead', reason: 'domain not found', archiveUrl };
    }
    return { status: 'unverified', reason: error.message };
  }
}

/**
 * Check a list of cited URLs with bounded concurrency.
 * @param {string[]} urls - Citation URLs to check.
 * @param {object} [options] - `timeoutSeconds` (1–60) and `archiveFallback`.
 * @returns {Promise<object>} - Map of URL to check result.
 */
async function checkLinks(urls, options = {}) {
  if (!Array.isArray(urls) || urls.some((value) => typeof value !== 'string' || value.length > 2048)) {
    throw new Error('Link check expects a list of URLs.');
  }
  const unique = [...new Set(urls)].slice(0, MAX_URLS);
  const timeoutSeconds = Math.min(60, Math.max(1, Math.round(Number(options.timeoutSeconds) || 10)));
  const settings = { timeoutMs: timeoutSeconds * 1000, archiveFallback: options.archiveFallback !== false };
  const results = {};
  let next = 0;
  const worker = async () => {
    while (next < unique.length) {
      const address = unique[next++];
      results[address] = await checkUrl(address, settings);
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, unique.length) }, worker));
  return results;
}

module.exports = { checkLinks };
