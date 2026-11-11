const { validateUrl } = require('./network.cjs');

const SITES = {
  'reuters.com': 'Reuters',
  'apnews.com': 'Associated Press',
  'bbc.com': 'BBC',
  'bbc.co.uk': 'BBC',
  'nytimes.com': 'The New York Times',
  'washingtonpost.com': 'The Washington Post',
  'theguardian.com': 'The Guardian',
  'nature.com': 'Nature',
  'science.org': 'Science',
  'brookings.edu': 'Brookings Institution',
  'pewresearch.org': 'Pew Research Center',
};

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
const DATED_PATH = /\/((?:19|20)\d{2})\/(?:\d{1,2}|[a-z]{3})\/\d{1,2}\//i;
// URL-only rules for well-known sites; these still work when the page itself cannot be fetched.
const URL_RULES = [
  { host: /(^|\.)nytimes\.com$/, path: DATED_PATH },
  { host: /(^|\.)washingtonpost\.com$/, path: DATED_PATH },
  {
    host: /(^|\.)theguardian\.com$/,
    path: new RegExp(`/((?:19|20)\\d{2})/(?:${MONTHS})/\\d{1,2}/`, 'i'),
  },
  { host: /(^|\.)reuters\.com$/, path: /-((?:19|20)\d{2})-\d{2}-\d{2}\/?$/ },
  { host: /(^|\.)cnn\.com$/, path: DATED_PATH },
  { host: /(^|\.)npr\.org$/, path: DATED_PATH, publication: 'NPR' },
  { host: /(^|\.)foxnews\.com$/, publication: 'Fox News' },
  { host: /(^|\.)politico\.com$/, path: DATED_PATH, publication: 'Politico' },
  {
    host: /(^|\.)theatlantic\.com$/,
    path: /\/((?:19|20)\d{2})\/\d{2}\//,
    publication: 'The Atlantic',
  },
  {
    host: /(^|\.)foreignaffairs\.com$/,
    path: /\/((?:19|20)\d{2})-\d{2}-\d{2}\//,
    publication: 'Foreign Affairs',
  },
  { host: /(^|\.)cfr\.org$/, publication: 'Council on Foreign Relations' },
  {
    host: /(^|\.)rand\.org$/,
    path: /\/((?:19|20)\d{2})\/\d{2}\//,
    publication: 'RAND Corporation',
  },
  {
    host: /(^|\.)congress\.gov$/,
    publication: 'Congress.gov',
    title: /\/bill\/(\d+)th-congress\/([a-z-]+)\/(\d+)/i,
    titleFrom: (m) =>
      `${m[2].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} ${m[3]} (${m[1]}th Congress)`,
  },
  { host: /(^|\.)supremecourt\.gov$/, publication: 'Supreme Court of the United States' },
  {
    host: /(^|\.)wikipedia\.org$/,
    publication: 'Wikipedia',
    title: /^\/wiki\/([^/?#]+)/,
    titleFrom: (m) => decodeURIComponent(m[1]).replace(/_/g, ' '),
  },
  {
    host: /(^|\.)arxiv\.org$/,
    publication: 'arXiv',
    path: /\/(?:abs|pdf)\/(\d{2})\d{2}\.\d{4,5}/,
    yearFrom: (m) => `20${m[1]}`,
  },
  {
    host: /(^|\.)doi\.org$/,
    title: /^\/(10\.\d{4,9}\/[^\s?#]+)/,
    titleFrom: (m) => `doi:${decodeURIComponent(m[1])}`,
  },
];

function slugTitle(pathname) {
  const segment = pathname
    .split('/')
    .filter(Boolean)
    .reverse()
    .find(
      (part) =>
        /[a-z]/i.test(part) && part.includes('-') && !/^(?:index|amp)(?:\.\w+)?$/i.test(part)
    );
  if (!segment) {
    return '';
  }
  const words = decodeURIComponent(segment)
    .replace(/\.\w+$/, '')
    .replace(/-(?:19|20)\d{2}-\d{2}-\d{2}$/, '')
    .replace(/-?[a-z]*\d{5,}[a-z\d]*$/i, '')
    .split(/[-_]+/)
    .filter(Boolean);
  if (words.length < 2) {
    return '';
  }
  const title = words.join(' ');
  return title[0].toUpperCase() + title.slice(1);
}

function parseUrl(address) {
  const url = validateUrl(address);
  const host = url.hostname.replace(/^www\./, '');
  const known = Object.entries(SITES).find(
    ([domain]) => host === domain || host.endsWith('.' + domain)
  );
  const rule = URL_RULES.find((r) => r.host.test(host)) || {};
  const pathMatch = rule.path && url.pathname.match(rule.path);
  const year = pathMatch
    ? rule.yearFrom
      ? rule.yearFrom(pathMatch)
      : pathMatch[1]
    : known
      ? url.pathname.match(/(?:\/|-)((?:19|20)\d{2})(?:\/|-)/)?.[1] || ''
      : '';
  const titleMatch = rule.title && url.pathname.match(rule.title);
  let title = '';
  if (titleMatch) {
    title = rule.titleFrom
      ? rule.titleFrom(titleMatch)
      : titleMatch.slice(1).join(' ').toUpperCase();
  } else if (known || rule.host) {
    title = slugTitle(url.pathname);
  }
  return {
    author: '',
    title,
    year,
    publication: rule.publication || known?.[1] || '',
    url: cleanUrl(url.href),
    originalUrl: url.href,
    canonicalUrl: cleanUrl(url.href),
  };
}

const TRACKING_PARAMS = /^(?:utm_[a-z0-9_]+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src)$/i;

function cleanUrl(value, base) {
  if (typeof value !== 'string' || !value) {
    return '';
  }
  try {
    const url = new URL(value, base);
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hash = '';
    if (/^(?:dx\.)?doi\.org$/i.test(url.hostname)) {
      url.protocol = 'https:';
      url.hostname = 'doi.org';
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.href;
  } catch {
    return typeof value === 'string' ? value : '';
  }
}

function canonicalPageUrl(value, base) {
  if (typeof value !== 'string' || !value) {
    return '';
  }
  try {
    const url = new URL(cleanUrl(value, base) || value, base);
    return `${url.origin}${url.pathname.replace(/\/+$/, '') || '/'}`.toLowerCase();
  } catch {
    return '';
  }
}

function doiFromUrl(address) {
  let url;
  try {
    url = validateUrl(address);
  } catch {
    return '';
  }
  if (!/^(?:dx\.)?doi\.org$/i.test(url.hostname)) {
    const raw = String(address || '').trim();
    const match = raw.match(/^(?:doi:\s*)?(10\.\d{4,9}\/\S+)$/i);
    if (!match) {
      return '';
    }
    const doi = match[1].replace(/[),.;:!?]+$/, '');
    return /^10\.\d{4,9}\/[-._;()/:+A-Z0-9]+$/i.test(doi) ? doi : '';
  }
  let doi;
  try {
    doi = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, '');
  } catch {
    return '';
  }
  doi = doi.replace(/[),.;:!?]+$/, '');
  if (
    !/^10\.\d{4,9}\/[-._;()/:+A-Z0-9]+$/i.test(doi) ||
    doi.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    return '';
  }
  return doi;
}

module.exports = { parseUrl, cleanUrl, canonicalPageUrl, doiFromUrl };
