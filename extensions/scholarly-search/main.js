// This is an ordinary Tagline extension: all network, UI and vault access goes
// through the same sandbox APIs available to independently installed extensions.
const surface = 'search';
let excerpt = '';

const clean = (value) =>
  String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => {
      const point = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
    })
    .replace(
      /&(amp|quot|apos|lt|gt|nbsp|ndash|mdash);/gi,
      (_, n) =>
        ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—' })[
          n.toLowerCase()
        ]
    )
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
const names = (value) =>
  []
    .concat(value || [])
    .map((item) => {
      if (typeof item === 'string') return clean(item);
      if (!item || typeof item !== 'object') return '';
      return clean(
        item.name ||
          item.alternateName ||
          [item.givenName || item.given, item.familyName || item.family].filter(Boolean).join(' ')
      );
    })
    .filter(Boolean)
    .join(', ')
    .slice(0, 150);

async function search(query) {
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
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await tagline.network.fetch(url.href, { responseType: 'json' });
      if (!response.ok) throw new Error(`Crossref returned HTTP ${response.status}.`);
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  const data = response.body;
  if (data?.status !== 'ok' || !Array.isArray(data.message?.items)) {
    throw new Error('Crossref returned invalid search results.');
  }
  return data.message.items
    .slice(0, 20)
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => {
      let doi = typeof item.DOI === 'string' ? item.DOI.trim() : '';
      if (!/^10\.\d{4,9}\/[^\s]+$/i.test(doi) || doi.length > 500) doi = '';
      doi = doi.replace(/[.,;:]+$/, '');
      while ((doi.match(/\)/g) || []).length > (doi.match(/\(/g) || []).length && doi.endsWith(')'))
        doi = doi.slice(0, -1);
      doi = doi.replace(/[.,;:]+$/, '');
      const year = Number(
        (item.published || item['published-online'] || item['published-print'] || item.issued)?.[
          'date-parts'
        ]?.[0]?.[0]
      );
      return {
        author: names(item.author),
        year: Number.isInteger(year) && year >= 1000 && year <= 9999 ? String(year) : '',
        title: names(item.title),
        publication: names(item['container-title']) || clean(item.publisher),
        url: doi ? `https://doi.org/${doi}` : '',
      };
    })
    .filter((item) => item.title);
}

tagline.webviews.onMessage(surface, async (message) => {
  try {
    if (message?.type === 'search') {
      const results = await search(message.query);
      await tagline.webviews.postMessage(surface, { type: 'results', results });
    } else if (message?.type === 'excerpt-start') {
      excerpt = '';
    } else if (message?.type === 'excerpt-chunk') {
      if (typeof message.text !== 'string' || excerpt.length + message.text.length > 200000)
        throw new Error('Source excerpt is too long.');
      excerpt += message.text;
    } else if (message?.type === 'save') {
      const heading = String(message.tag || '')
        .trim()
        .replace(/\s+/g, ' ');
      if (!heading || !excerpt.trim()) throw new Error('Enter a card tag and source excerpt.');
      const citation = await tagline.helpers.citations.create(message.citation);
      const name =
        heading
          .replace(/[\\/:*?"<>|\x00-\x1f]/g, '-')
          .replace(/[. ]+$/g, '')
          .slice(0, 100) || 'Evidence card';
      const path = await tagline.vault.create(
        `${name}.md`,
        `#### ${heading}\n\n${citation}\n\n${excerpt.trim()}\n`
      );
      excerpt = '';
      await tagline.webviews.postMessage(surface, { type: 'saved', path });
      await tagline.ui.openNote(path);
    } else if (
      message?.type === 'open' &&
      typeof message.url === 'string' &&
      message.url.startsWith('https://doi.org/')
    ) {
      await tagline.ui.openExternal(message.url);
    }
  } catch (error) {
    await tagline.webviews.postMessage(surface, {
      type: 'error',
      message: String(error.message || error).slice(0, 500),
    });
  }
});

await tagline.webviews.setHtml(surface, await tagline.extension.readFile('view.html'));
