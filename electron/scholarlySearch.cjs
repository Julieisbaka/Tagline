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
  const response = await fetch(validateUrl(url.href), 0, 'json');
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
      const doi =
        typeof item?.DOI === 'string' &&
        /^10\.\d{4,9}\/\S+$/i.test(item.DOI) &&
        item.DOI.length <= 500
          ? item.DOI
          : '';
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
        url: doi ? `https://doi.org/${doi.split('/').map(encodeURIComponent).join('/')}` : '',
      };
    })
    .filter((item) => item.title);
}

function registerScholarlySearch({ ipcMain, assertModelSender }) {
  ipcMain.handle('scholarly:search', (event, query) => {
    assertModelSender(event, 'Scholarly search');
    return searchScholarly(query);
  });
}

module.exports = { searchScholarly, registerScholarlySearch };
