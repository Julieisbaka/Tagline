const { validateUrl } = require('./network.cjs');
const { parseUrl, cleanUrl, canonicalPageUrl, doiFromUrl } = require('./urls.cjs');

function stripTags(value) {
  let previous;
  do {
    previous = value;
    value = value.replace(/<[^>]*>/g, '');
  } while (value !== previous);
  return value.replace(/[<>]/g, '');
}

function text(value) {
  const decoded = stripTags(String(value || ''))
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, number) => {
      const point =
        number[0].toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : Number(number);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
    })
    .replace(
      /&(amp|quot|apos|lt|gt|nbsp|ndash|mdash|hellip|rsquo|lsquo|rdquo|ldquo|copy|reg|trade);/gi,
      (_, name) =>
        ({
          amp: '&',
          quot: '"',
          apos: "'",
          lt: '<',
          gt: '>',
          nbsp: ' ',
          ndash: '–',
          mdash: '—',
          hellip: '…',
          rsquo: '’',
          lsquo: '‘',
          rdquo: '”',
          ldquo: '“',
          copy: '©',
          reg: '®',
          trade: '™',
        })[name.toLowerCase()]
    );
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
  return []
    .concat(value || [])
    .map((item) => {
      if (typeof item === 'string') {
        return text(item);
      }
      if (!item || typeof item !== 'object') {
        return '';
      }
      const name =
        item.name ||
        item.alternateName ||
        [item.givenName || item.given, item.familyName || item.family].filter(Boolean).join(' ');
      return text(name);
    })
    .filter(Boolean)
    .join(', ');
}

function parseMetadata(html, address, { allowUrlFallback = true } = {}) {
  const url = validateUrl(address);
  const meta = new Map();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const values = attributes(tag);
    const key = (values.property || values.name || values.itemprop || '').toLowerCase();
    if (key && values.content) {
      const entries = meta.get(key) || [];
      if (!entries.includes(values.content)) {
        entries.push(values.content);
      }
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
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === 'object') {
      const types = []
        .concat(value['@type'] || [])
        .map((type) => String(type).split(/[\/#]/).pop().toLowerCase());
      if (
        types.some((type) =>
          ['newsarticle', 'article', 'scholarlyarticle', 'report', 'blogposting'].includes(type)
        )
      ) {
        articles.push(value);
      }
      for (const [key, child] of Object.entries(value)) {
        if (key !== '@context') {
          visit(child);
        }
      }
    }
  };
  for (const match of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    try {
      visit(JSON.parse(match[1]));
    } catch {
      /* Publishers sometimes include invalid JSON-LD; meta tags remain usable. */
    }
  }
  const targetUrl = canonicalPageUrl(canonical, url.href) || canonicalPageUrl(url.href, url.href);
  const entityUrl = (value) =>
    typeof value === 'string'
      ? value
      : value && typeof value === 'object'
        ? value['@id'] || value.url || ''
        : '';
  const articleScore = (article) => {
    const articleUrl = entityUrl(article.url) || entityUrl(article.mainEntityOfPage);
    const matchesPage = articleUrl && canonicalPageUrl(articleUrl, url.href) === targetUrl;
    return (
      (matchesPage ? 100 : 0) +
      (article.headline || article.name ? 8 : 0) +
      (article.author ? 4 : 0) +
      (article.datePublished ? 2 : 0) +
      (article.publisher ? 1 : 0)
    );
  };
  const article =
    articles.reduce(
      (best, candidate) =>
        !best || articleScore(candidate) > articleScore(best) ? candidate : best,
      null
    ) || {};
  const fromUrl = parseUrl(url.href);
  const confidence = {};
  const spans = {};
  const date =
    text(article.datePublished || article.dateCreated) ||
    get(
      'article:published_time',
      'citation_publication_date',
      'citation_date',
      'citation_online_date',
      'parsely-pub-date',
      'dcterms.issued',
      'dc.date',
      'date',
      'datepublished',
      'pubdate',
      'sailthru.date'
    );
  const year = date.match(/\b(?:19|20)\d{2}\b/)?.[0] || (allowUrlFallback ? fromUrl.year : '');
  if (year) {
    confidence.year = {
      score: article.datePublished ? 0.95 : 0.8,
      source: article.datePublished
        ? 'jsonld'
        : get('citation_publication_date')
          ? 'highwire'
          : 'meta',
    };
  }

  const jsonldTitle = text(article.headline || article.name);
  const metaTitle = get(
    'citation_title',
    'dc.title',
    'dcterms.title',
    'og:title',
    'twitter:title',
    'parsely-title'
  );
  const htmlTitle = text(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const title = jsonldTitle || metaTitle || htmlTitle || (allowUrlFallback ? fromUrl.title : '');
  if (title) {
    confidence.title = {
      score: jsonldTitle ? 0.95 : metaTitle ? 0.85 : 0.6,
      source: jsonldTitle ? 'jsonld' : metaTitle ? 'meta' : 'html',
    };
  }

  const authorMeta = getAll(
    'citation_author',
    'dc.creator',
    'dcterms.creator',
    'citation_author_institution'
  )
    .map((author) => author.replace(/^By\s+/i, ''))
    .filter(Boolean)
    .join(', ');
  const jsonldAuthor = names(article.author);
  const metaAuthor =
    authorMeta ||
    get('author', 'author_name', 'article:author', 'parsely-author', 'byl').replace(/^By\s+/i, '');
  const author = jsonldAuthor || metaAuthor || '';
  if (author) {
    confidence.author = {
      score: jsonldAuthor ? 0.95 : authorMeta ? 0.85 : 0.7,
      source: jsonldAuthor ? 'jsonld' : authorMeta ? 'highwire' : 'meta',
    };
  }

  const jsonldPub = names(article.publisher);
  const metaPub = get(
    'og:site_name',
    'citation_journal_title',
    'citation_conference_title',
    'citation_publisher',
    'citation_technical_report_institution',
    'application-name',
    'dc.publisher',
    'dcterms.publisher'
  );
  const publication = jsonldPub || metaPub || (allowUrlFallback ? fromUrl.publication : '');
  if (publication) {
    confidence.publication = {
      score: jsonldPub ? 0.9 : metaPub ? 0.8 : 0.5,
      source: jsonldPub ? 'jsonld' : metaPub ? 'meta' : 'url',
    };
  }

  const doi =
    get('citation_doi', 'dc.identifier', 'prism.doi').replace(/^doi:\s*/i, '') ||
    doiFromUrl(url.href) ||
    '';
  const clean = cleanUrl(canonical || get('og:url') || url.href, url.href);
  const original = url.href;
  if (clean) {
    confidence.url = {
      score: canonical ? 0.95 : 0.8,
      source: canonical ? 'canonical' : 'resolved',
    };
  }

  return {
    author,
    title,
    year,
    publication,
    url: clean || original,
    originalUrl: original,
    canonicalUrl: clean || original,
    doi: doi || '',
    confidence,
    spans,
  };
}

module.exports = { parseMetadata, text, names };
