const {
  publicAddress,
  publicLookup,
  validateUrl,
  download,
} = require('./citationMetadata/network.cjs');
const { parseUrl, cleanUrl, doiFromUrl } = require('./citationMetadata/urls.cjs');
const { parseMetadata, text, names } = require('./citationMetadata/parsing.cjs');

function crossrefYear(value) {
  const year = Number(value?.['date-parts']?.[0]?.[0]);
  return Number.isInteger(year) && year >= 1000 && year <= 9999 ? String(year) : '';
}

async function crossrefCitation(address) {
  const doi = doiFromUrl(address);
  if (!doi) {
    return null;
  }
  const path = doi.split('/').map(encodeURIComponent).join('/');
  const endpoint = validateUrl(`https://api.crossref.org/works/doi/${path}`);
  const { json } = await download(endpoint, 0, 'json');
  let response;
  try {
    response = JSON.parse(json);
  } catch {
    throw new Error('Crossref returned invalid JSON metadata.');
  }
  if (response?.status !== 'ok' || !response.message || typeof response.message !== 'object') {
    throw new Error('Crossref did not return a metadata record for this DOI.');
  }
  const work = response.message;
  const date =
    work.published ||
    work['published-online'] ||
    work['published-print'] ||
    work.issued ||
    work.created;
  const fields = {
    author: names(work.author),
    year: crossrefYear(date),
    title: names(work.title),
    publication: names(work['container-title']) || text(work.publisher),
    url: parseUrl(address).url,
  };
  return fields.author || fields.year || fields.title || fields.publication ? fields : null;
}

async function extractCitation(value, { sourceOnly = false } = {}) {
  if (typeof value !== 'string' || value.length > 8000) {
    throw new Error('Enter a valid article URL.');
  }
  value = value.trim();
  const doiInput = value.match(/^(?:doi:\s*)?(10\.\d{4,9}\/\S+)$/i);
  if (doiInput) {
    value = `https://doi.org/${doiInput[1]}`;
  } else if (/^(?:[a-z\d-]+\.)+[a-z]{2,}(?:[/?#]|$)/i.test(value)) {
    value = `https://${value}`;
  }
  const originalUrl = cleanUrl(validateUrl(value).href);
  const fromUrl = parseUrl(value);
  const doi = doiFromUrl(value);
  let crossrefError = null;
  if (doi) {
    try {
      const metadata = await crossrefCitation(value);
      if (metadata) {
        return {
          ...metadata,
          url: cleanUrl(metadata.url),
          originalUrl,
          canonicalUrl: cleanUrl(metadata.url),
          confidence: metadata.confidence || {
            author: { score: 0.95, source: 'crossref' },
            title: { score: 0.95, source: 'crossref' },
            year: { score: 0.95, source: 'crossref' },
          },
          spans: metadata.spans || {},
        };
      }
    } catch (error) {
      crossrefError = error;
    }
  }
  let fields;
  let resolvedUrl = originalUrl;
  try {
    const result = await download(validateUrl(value));
    resolvedUrl = cleanUrl(result.url);
    fields = parseMetadata(result.html, result.url, { allowUrlFallback: !sourceOnly });
    fields.originalUrl = originalUrl;
    if (resolvedUrl && resolvedUrl !== originalUrl) {
      fields.resolvedUrl = resolvedUrl;
    }
  } catch (error) {
    if (sourceOnly) {
      if (crossrefError) {
        throw new Error(
          `DOI metadata lookup failed (${crossrefError.message}); publisher metadata lookup failed (${error.message}).`
        );
      }
      throw error;
    }
    const hasUsefulUrlFields =
      (!!fromUrl.title && !fromUrl.title.startsWith('doi:')) || fromUrl.year || fromUrl.publication;
    if (!hasUsefulUrlFields) {
      if (crossrefError) {
        throw new Error(
          `DOI metadata lookup failed (${crossrefError.message}); publisher metadata lookup failed (${error.message}).`
        );
      }
      throw error;
    }
    return {
      ...fromUrl,
      url: cleanUrl(fromUrl.url),
      originalUrl,
      canonicalUrl: cleanUrl(fromUrl.url),
      confidence: {},
      spans: {},
    };
  }
  if (!fields.title && !fields.author && !fields.year && (!sourceOnly || !fields.publication)) {
    if (crossrefError) {
      throw new Error(
        `No article metadata was found. The Crossref lookup also failed (${crossrefError.message}). Enter citation details manually.`
      );
    }
    throw new Error('No article metadata was found. Enter citation details manually.');
  }
  return fields;
}

module.exports = {
  parseMetadata,
  parseUrl,
  extractCitation,
  crossrefCitation,
  doiFromUrl,
  publicAddress,
  publicLookup,
  validateUrl,
  download,
};
