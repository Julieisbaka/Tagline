const { test } = require('node:test');
const assert = require('node:assert/strict');
const { searchScholarly } = require('../electron/scholarlySearch.cjs');

test('scholarly search uses Crossref and normalizes citation metadata', async () => {
  const fetch = async (url, redirects, type) => {
    assert.equal(url.host, 'api.crossref.org');
    assert.equal(url.searchParams.get('query.bibliographic'), 'climate policy');
    assert.equal(type, 'json');
    return {
      json: JSON.stringify({
        status: 'ok',
        message: {
          items: [
            {
              DOI: '10.1234/one(two)',
              title: ['<i>Climate</i> Policy'],
              author: [{ given: 'Ada', family: 'Smith' }],
              issued: { 'date-parts': [[2023]] },
              'container-title': ['Journal'],
            },
            { title: ['Missing details'] },
            null,
          ],
        },
      }),
    };
  };
  const result = await searchScholarly(' climate policy ', fetch);
  assert.deepEqual(result[0], {
    author: 'Ada Smith',
    year: '2023',
    title: 'Climate Policy',
    publication: 'Journal',
    url: 'https://doi.org/10.1234/one(two)',
  });
  assert.equal(result[1].year, '');
  await assert.rejects(searchScholarly(' ', fetch), /search/);
  await assert.rejects(searchScholarly('a'.repeat(301), fetch), /300/);
  await assert.rejects(
    searchScholarly('test', async () => ({ json: '{' })),
    /invalid/
  );
});
