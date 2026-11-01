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

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
const DATED_PATH = /\/((?:19|20)\d{2})\/(?:\d{1,2}|[a-z]{3})\/\d{1,2}\//i;
// URL-only rules for well-known sites; these still work when the page itself cannot be fetched.
const URL_RULES = [
  { host: /(^|\.)nytimes\.com$/, path: DATED_PATH },
  { host: /(^|\.)washingtonpost\.com$/, path: DATED_PATH },
  { host: /(^|\.)theguardian\.com$/, path: new RegExp(`/((?:19|20)\\d{2})/(?:${MONTHS})/\\d{1,2}/`, 'i') },
  { host: /(^|\.)reuters\.com$/, path: /-((?:19|20)\d{2})-\d{2}-\d{2}\/?$/ },
  { host: /(^|\.)cnn\.com$/, path: DATED_PATH },
  { host: /(^|\.)npr\.org$/, path: DATED_PATH, publication: 'NPR' },
  { host: /(^|\.)foxnews\.com$/, publication: 'Fox News' },
  { host: /(^|\.)politico\.com$/, path: DATED_PATH, publication: 'Politico' },
  { host: /(^|\.)theatlantic\.com$/, path: /\/((?:19|20)\d{2})\/\d{2}\//, publication: 'The Atlantic' },
  { host: /(^|\.)foreignaffairs\.com$/, path: /\/((?:19|20)\d{2})-\d{2}-\d{2}\//, publication: 'Foreign Affairs' },
  { host: /(^|\.)cfr\.org$/, publication: 'Council on Foreign Relations' },
  { host: /(^|\.)rand\.org$/, path: /\/((?:19|20)\d{2})\/\d{2}\//, publication: 'RAND Corporation' },
  {
    host: /(^|\.)congress\.gov$/, publication: 'Congress.gov', title: /\/bill\/(\d+)th-congress\/([a-z-]+)\/(\d+)/i,
    titleFrom: (m) => `${m[2].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} ${m[3]} (${m[1]}th Congress)`,
  },
  { host: /(^|\.)supremecourt\.gov$/, publication: 'Supreme Court of the United States' },
  {
    host: /(^|\.)wikipedia\.org$/, publication: 'Wikipedia',
    title: /^\/wiki\/([^/?#]+)/, titleFrom: (m) => decodeURIComponent(m[1]).replace(/_/g, ' '),
  },
  {
    host: /(^|\.)arxiv\.org$/, publication: 'arXiv',
    path: /\/(?:abs|pdf)\/(\d{2})\d{2}\.\d{4,5}/, yearFrom: (m) => `20${m[1]}`,
  },
  { host: /(^|\.)doi\.org$/, title: /^\/(10\.\d{4,9}\/[^\s?#]+)/, titleFrom: (m) => `doi:${decodeURIComponent(m[1])}` },
];

function slugTitle(pathname) {
  const segment = pathname.split('/').filter(Boolean).reverse()
    .find((part) => /[a-z]/i.test(part) && part.includes('-') && !/^(?:index|amp)(?:\.\w+)?$/i.test(part));
  if (!segment) return '';
  const words = decodeURIComponent(segment).replace(/\.\w+$/, '').replace(/-(?:19|20)\d{2}-\d{2}-\d{2}$/, '')
    .replace(/-?[a-z]*\d{5,}[a-z\d]*$/i, '').split(/[-_]+/).filter(Boolean);
  if (words.length < 2) return '';
  const title = words.join(' ');
  return title[0].toUpperCase() + title.slice(1);
}

function parseUrl(address) {
  const url = validateUrl(address);
  const host = url.hostname.replace(/^www\./, '');
  const known = Object.entries(SITES).find(([domain]) => host === domain || host.endsWith('.' + domain));
  const rule = URL_RULES.find((r) => r.host.test(host)) || {};
  const pathMatch = rule.path && url.pathname.match(rule.path);
  const year = pathMatch ? (rule.yearFrom ? rule.yearFrom(pathMatch) : pathMatch[1])
    : (known ? url.pathname.match(/(?:\/|-)((?:19|20)\d{2})(?:\/|-)/)?.[1] || '' : '');
  const titleMatch = rule.title && url.pathname.match(rule.title);
  let title = '';
  if (titleMatch) title = rule.titleFrom ? rule.titleFrom(titleMatch) : titleMatch.slice(1).join(' ').toUpperCase();
  else if (known || rule.host) title = slugTitle(url.pathname);
  return { author: '', title, year, publication: rule.publication || known?.[1] || '', url: url.href };
}

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

// DNS lookup that refuses hosts resolving to private or local addresses.
function publicLookup(host, options, callback) {
  dns.lookup(host, { all: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) {
      return callback(new Error('Local and private network URLs are not supported.'));
    }
    callback(null, options.all ? addresses : addresses[0].address, addresses[0].family);
  });
}

function download(url, redirects = 0, responseType = 'html') {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).get(url, {
      headers: {
        Accept: responseType === 'json' ? 'application/json' : 'text/html,application/xhtml+xml',
        'User-Agent': 'Tagline/0.0.1 CitationMetadata',
      },
      lookup: publicLookup,
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        if (redirects >= 4) return reject(new Error('The article redirected too many times.'));
        try { resolve(download(validateUrl(new URL(response.headers.location, url).href), redirects + 1, responseType)); }
        catch (error) { reject(error); }
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        const restricted = [401, 402, 403, 429].includes(response.statusCode);
        const message = restricted
          ? `Automated metadata access is restricted (HTTP ${response.statusCode}). Use a DOI URL or enter citation details manually.`
          : `The website returned HTTP ${response.statusCode}. Enter citation details manually.`;
        return reject(new Error(message));
      }
      const contentType = response.headers['content-type'] || '';
      const acceptedType = responseType === 'json'
        ? /^application\/(?:json|[\w.+-]+\+json)\b/i.test(contentType)
        : /^(text\/html|application\/xhtml\+xml)\b/i.test(contentType);
      if (!acceptedType) {
        response.resume();
        return reject(new Error(`The URL did not return ${responseType === 'json' ? 'JSON metadata' : 'an HTML article'}.`));
      }
      let size = 0;
      const chunks = [];
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 2_000_000) request.destroy(new Error('The article is too large to extract metadata.'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(responseType === 'json' ? { json: body, url: url.href } : { html: body, url: url.href });
      });
    });
    const deadline = setTimeout(() => request.destroy(new Error('The website took too long to respond.')), 15000);
    request.on('close', () => clearTimeout(deadline));
    request.on('error', reject);
  });
}

function stripTags(value) {
  let previous;
  do {
    previous = value;
    value = value.replace(/<[^>]*>/g, '');
  } while (value !== previous);
  return value.replace(/[<>]/g, '');
}

function text(value) {
  const decoded = stripTags(String(value || '')).replace(/&#(x[\da-f]+|\d+);/gi, (_, number) => {
    const point = number[0].toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : Number(number);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  }).replace(/&(amp|quot|apos|lt|gt|nbsp|ndash|mdash|hellip|rsquo|lsquo|rdquo|ldquo|copy|reg|trade);/gi, (_, name) =>
    ({
      amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—',
      hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®', trade: '™',
    })[name.toLowerCase()]);
  return stripTags(decoded).replace(/\s+/g, ' ').trim().slice(0, 2000);
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[match[1].toLowerCase()] = text(match[2] ?? match[3] ?? match[4]);
  }
  return result;
}

function names(value) {
  return [].concat(value || []).map((item) => {
    if (typeof item === 'string') return text(item);
    if (!item || typeof item !== 'object') return '';
    const name = item.name || item.alternateName ||
      [item.givenName || item.given, item.familyName || item.family].filter(Boolean).join(' ');
    return text(name);
  }).filter(Boolean).join(', ');
}

function canonicalPageUrl(value, base) {
  if (typeof value !== 'string' || !value) return '';
  try {
    const url = new URL(value, base);
    return `${url.origin}${url.pathname.replace(/\/+$/, '') || '/'}`.toLowerCase();
  } catch {
    return '';
  }
}

function parseMetadata(html, address) {
  const url = validateUrl(address);
  const meta = new Map();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const values = attributes(tag);
    const key = (values.property || values.name || values.itemprop || '').toLowerCase();
    if (key && values.content) {
      const entries = meta.get(key) || [];
      if (!entries.includes(values.content)) entries.push(values.content);
      meta.set(key, entries);
    }
  }
  const getAll = (...keys) => keys.flatMap((key) => meta.get(key) || []);
  const get = (...keys) => getAll(...keys).find(Boolean) || '';
  let canonical = get('og:url');
  if (!canonical) {
    for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
      const values = attributes(tag);
      if (values.href && values.rel?.toLowerCase().split(/\s+/).includes('canonical')) {
        canonical = values.href;
        break;
      }
    }
  }
  const articles = [];
  const visit = (value) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      const types = [].concat(value['@type'] || []).map((type) => String(type).split(/[\/#]/).pop().toLowerCase());
      if (types.some((type) => ['newsarticle', 'article', 'scholarlyarticle', 'report', 'blogposting'].includes(type))) {
        articles.push(value);
      }
      for (const [key, child] of Object.entries(value)) if (key !== '@context') visit(child);
    }
  };
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1])); }
    catch { /* Publishers sometimes include invalid JSON-LD; meta tags remain usable. */ }
  }
  const targetUrl = canonicalPageUrl(canonical, url.href) || canonicalPageUrl(url.href, url.href);
  const entityUrl = (value) => typeof value === 'string' ? value
    : value && typeof value === 'object' ? value['@id'] || value.url || '' : '';
  const articleScore = (article) => {
    const articleUrl = entityUrl(article.url) || entityUrl(article.mainEntityOfPage);
    const matchesPage = articleUrl && canonicalPageUrl(articleUrl, url.href) === targetUrl;
    return (matchesPage ? 100 : 0) + (article.headline || article.name ? 8 : 0) +
      (article.author ? 4 : 0) + (article.datePublished ? 2 : 0) + (article.publisher ? 1 : 0);
  };
  const article = articles.reduce((best, candidate) =>
    !best || articleScore(candidate) > articleScore(best) ? candidate : best, null) || {};
  const fromUrl = parseUrl(url.href);
  const date = text(article.datePublished || article.dateCreated) ||
    get('article:published_time', 'citation_publication_date', 'citation_online_date', 'parsely-pub-date',
      'dcterms.issued', 'dc.date', 'date', 'datepublished', 'pubdate');
  const year = date.match(/\b(?:19|20)\d{2}\b/)?.[0] || fromUrl.year;
  const title = text(article.headline || article.name) ||
    get('citation_title', 'dc.title', 'dcterms.title', 'og:title', 'twitter:title', 'parsely-title') ||
    text(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]) || fromUrl.title;
  const authorMeta = getAll('citation_author', 'dc.creator', 'dcterms.creator')
    .map((author) => author.replace(/^By\s+/i, '')).filter(Boolean).join(', ');
  return {
    author: names(article.author) || authorMeta ||
      get('author', 'author_name', 'article:author', 'parsely-author', 'byl').replace(/^By\s+/i, ''),
    title, year,
    publication: names(article.publisher) ||
      get('og:site_name', 'citation_journal_title', 'citation_conference_title', 'application-name',
        'dc.publisher', 'dcterms.publisher') || fromUrl.publication,
    url: url.href,
  };
}

function doiFromUrl(address) {
  const url = validateUrl(address);
  if (!/^(?:dx\.)?doi\.org$/i.test(url.hostname)) return '';
  let doi;
  try { doi = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, ''); }
  catch { return ''; }
  if (!/^10\.\d{4,9}\/[-._;()/:+A-Z0-9]+$/i.test(doi) ||
    doi.split('/').some((part) => !part || part === '.' || part === '..')) return '';
  return doi;
}

function crossrefYear(value) {
  const year = Number(value?.['date-parts']?.[0]?.[0]);
  return Number.isInteger(year) && year >= 1000 && year <= 9999 ? String(year) : '';
}

async function crossrefCitation(address) {
  const doi = doiFromUrl(address);
  if (!doi) return null;
  const path = doi.split('/').map(encodeURIComponent).join('/');
  const endpoint = validateUrl(`https://api.crossref.org/works/doi/${path}`);
  const { json } = await download(endpoint, 0, 'json');
  let response;
  try { response = JSON.parse(json); }
  catch { throw new Error('Crossref returned invalid JSON metadata.'); }
  if (response?.status !== 'ok' || !response.message || typeof response.message !== 'object') {
    throw new Error('Crossref did not return a metadata record for this DOI.');
  }
  const work = response.message;
  const date = work.published || work['published-online'] || work['published-print'] || work.issued || work.created;
  const fields = {
    author: names(work.author),
    year: crossrefYear(date),
    title: names(work.title),
    publication: names(work['container-title']) || text(work.publisher),
    url: parseUrl(address).url,
  };
  return fields.author || fields.year || fields.title || fields.publication ? fields : null;
}

async function extractCitation(value) {
  if (typeof value !== 'string' || value.length > 8000) throw new Error('Enter a valid article URL.');
  const fromUrl = parseUrl(value);
  const doi = doiFromUrl(value);
  let crossrefError = null;
  if (doi) {
    try {
      const metadata = await crossrefCitation(value);
      if (metadata) return metadata;
    } catch (error) {
      crossrefError = error;
    }
  }
  let fields;
  try {
    const { html, url } = await download(validateUrl(value));
    fields = parseMetadata(html, url);
  } catch (error) {
    const hasUsefulUrlFields = (!!fromUrl.title && !fromUrl.title.startsWith('doi:')) ||
      fromUrl.year || fromUrl.publication;
    if (!hasUsefulUrlFields) {
      if (crossrefError) {
        throw new Error(`DOI metadata lookup failed (${crossrefError.message}); publisher metadata lookup failed (${error.message}).`);
      }
      throw error;
    }
    return fromUrl;
  }
  if (!fields.title && !fields.author && !fields.year) {
    if (crossrefError) throw new Error(`No article metadata was found. The Crossref lookup also failed (${crossrefError.message}). Enter citation details manually.`);
    throw new Error('No article metadata was found. Enter citation details manually.');
  }
  return fields;
}

module.exports = { parseMetadata, parseUrl, extractCitation, crossrefCitation, doiFromUrl, publicAddress, publicLookup, validateUrl };
