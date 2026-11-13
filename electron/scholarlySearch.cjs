const { download, validateUrl } = require('./citationMetadata/network.cjs');
const { text, names } = require('./citationMetadata/parsing.cjs');

async function searchScholarly(query, fetch = download) {
  if (typeof query !== 'string' || !query.trim() || query.length > 300) {
    throw new Error('Enter a search of at most 300 characters.');
  }
  const url = new URL('https://api.crossref.org/works');
  url.searchParams.set('query.bibliographic', query.trim());
  url.searchParams.set('rows', '20');
  url.searchParams.set(
    'select',
    'DOI,title,author,published,published-online,published-print,issued,container-title,publisher'
  );
  let response;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await fetch(validateUrl(url.href), 0, 'json');
      break;
    } catch (error) {
      lastError = error;
      if (attempt === 2) {
        throw error;
      }
    }
  }
  if (!response) {
    throw lastError || new Error('Scholarly search failed.');
  }
  let items;
  try {
    const data = JSON.parse(response.json);
    if (data.status !== 'ok' || !Array.isArray(data.message?.items)) {
      throw new Error();
    }
    items = data.message.items;
  } catch {
    throw new Error('Crossref returned invalid search results.');
  }
  return items
    .slice(0, 20)
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => {
      const rawDoi = typeof item?.DOI === 'string' ? item.DOI.trim() : '';
      let doi = '';
      if (rawDoi && /^10\.\d{4,9}\/[^\s]+$/i.test(rawDoi) && rawDoi.length <= 500) {
        doi = rawDoi.replace(/[.,;:]+$/, '');
        while ((doi.match(/\)/g) || []).length > (doi.match(/\(/g) || []).length && doi.endsWith(')')) {
          doi = doi.slice(0, -1);
        }
        doi = doi.replace(/[.,;:]+$/, '');
      }
      const year = Number(
        (item.published || item['published-online'] || item['published-print'] || item.issued)?.[
          'date-parts'
        ]?.[0]?.[0]
      );
      return {
        author: names(item.author),
        year: Number.isInteger(year) && year >= 1000 && year <= 9999 ? String(year) : '',
        title: names(item.title),
        publication: names(item['container-title']) || text(item.publisher),
        url: doi ? `https://doi.org/${doi}` : '',
      };
    })
    .filter((item) => item.title);
}

function registerScholarlySearch({ ipcMain, assertMainFrameSender }) {
  ipcMain.handle('scholarly:search', (event, query) => {
    assertMainFrameSender(event, 'Scholarly search');
    return searchScholarly(query);
  });
}

module.exports = { searchScholarly, registerScholarlySearch };
