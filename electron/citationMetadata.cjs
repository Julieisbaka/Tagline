const https = require('node:https');
const http = require('node:http');
const dns = require('node:dns');
const net = require('node:net');

const SITES = {
  'reuters.com': 'Reuters', 'apnews.com': 'Associated Press', 'bbc.com': 'BBC',
  'bbc.co.uk': 'BBC', 'nytimes.com': 'The New York Times', 'washingtonpost.com': 'The Washington Post',
  'theguardian.com': 'The Guardian', 'nature.com': 'Nature', 'science.org': 'Science',
  'brookings.edu': 'Brookings Institution', 'pewresearch.org': 'Pew Research Center',
};

function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)));
  }
  return net.isIP(address) === 6 && /^[23]/.test(address) && !/^2001:(?:db8|0):/i.test(address);
}

function validateUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    (url.port && !['80', '443'].includes(url.port))) throw new Error('Use a public HTTP or HTTPS article URL.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || (net.isIP(host) && !publicAddress(host))) {
    throw new Error('Local and private network URLs are not supported.');
  }
  return url;
}

function download(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).get(url, {
      headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Tagline/0.0.1 CitationMetadata' },
      lookup(host, options, callback) {
        dns.lookup(host, { all: true }, (error, addresses) => {
          if (error) return callback(error);
          if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) {
            return callback(new Error('Local and private network URLs are not supported.'));
          }
          callback(null, options.all ? addresses : addresses[0].address, addresses[0].family);
        });
      },
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        if (redirects >= 4) return reject(new Error('The article redirected too many times.'));
        try { resolve(download(validateUrl(new URL(response.headers.location, url).href), redirects + 1)); }
        catch (error) { reject(error); }
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`The website returned HTTP ${response.statusCode}. Enter citation details manually.`));
      }
      if (!/^(text\/html|application\/xhtml\+xml)\b/i.test(response.headers['content-type'] || '')) {
        response.resume();
        return reject(new Error('The URL did not return an HTML article.'));
      }
      let size = 0;
      const chunks = [];
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 2_000_000) request.destroy(new Error('The article is too large to extract metadata.'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8'), url: url.href }));
    });
    const deadline = setTimeout(() => request.destroy(new Error('The website took too long to respond.')), 15000);
    request.on('close', () => clearTimeout(deadline));
    request.on('error', reject);
  });
}

function text(value) {
  return String(value || '').replace(/<[^>]*>/g, '').replace(/&#(x[\da-f]+|\d+);/gi, (_, number) => {
    const point = number[0].toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : Number(number);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  }).replace(/&(amp|quot|apos|lt|gt|nbsp);/gi, (_, name) =>
    ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' })[name.toLowerCase()])
    .replace(/\s+/g, ' ').trim().slice(0, 2000);
}

function parseMetadata(html, address) {
  const url = validateUrl(address);
  const meta = new Map();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attributes[match[1].toLowerCase()] = text(match[2] ?? match[3] ?? match[4]);
    }
    const key = (attributes.property || attributes.name || '').toLowerCase();
    if (attributes.content && !meta.has(key)) meta.set(key, attributes.content);
  }
  const get = (...keys) => keys.map((key) => meta.get(key)).find(Boolean) || '';
  const articles = [];
  const visit = (value) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      if ([].concat(value['@type'] || []).some((type) => /^(?:NewsArticle|Article|ScholarlyArticle|Report|BlogPosting)$/.test(type))) articles.push(value);
      if (value['@graph']) visit(value['@graph']);
    }
  };
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1])); }
    catch { /* Publishers sometimes include invalid JSON-LD; meta tags remain usable. */ }
  }
  const article = articles[0] || {};
  const names = (value) => [].concat(value || []).map((item) => text(typeof item === 'string' ? item : item?.name)).filter(Boolean).join(', ');
  const host = url.hostname.replace(/^www\./, '');
  const site = Object.entries(SITES).find(([domain]) => host === domain || host.endsWith('.' + domain));
  const date = text(article.datePublished) || get('article:published_time', 'citation_publication_date', 'date', 'datepublished', 'pubdate');
  const year = date.match(/\b(?:19|20)\d{2}\b/)?.[0] || url.pathname.match(/\/((?:19|20)\d{2})(?:\/|-)/)?.[1] || '';
  const title = text(article.headline || article.name) || get('citation_title', 'og:title', 'twitter:title') ||
    text(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  return {
    author: names(article.author) || get('citation_author', 'author', 'parsely-author', 'dc.creator', 'byl').replace(/^By\s+/i, ''),
    title, year,
    publication: names(article.publisher) || get('og:site_name', 'citation_journal_title', 'application-name') || site?.[1] || '',
    url: url.href,
  };
}

async function extractCitation(value) {
  if (typeof value !== 'string' || value.length > 8000) throw new Error('Enter a valid article URL.');
  const { html, url } = await download(validateUrl(value));
  const fields = parseMetadata(html, url);
  if (!fields.title && !fields.author && !fields.year) throw new Error('No article metadata was found. Enter citation details manually.');
  return fields;
}

module.exports = { parseMetadata, extractCitation, publicAddress, validateUrl };
