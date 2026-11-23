const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { validateManifest } = require('../electron/extensions/manifest.cjs');
const { validateLimits } = require('../electron/customization.mjs');

const root = path.join(__dirname, '../extensions/scholarly-search');
async function start(fetch) {
  const sent = [];
  const writes = [];
  const opened = [];
  let handler;
  let html;
  const tagline = {
    webviews: {
      onMessage: (_id, fn) => {
        handler = fn;
      },
      setHtml: async (_id, value) => {
        html = value;
      },
      postMessage: async (_id, value) => {
        sent.push(value);
      },
    },
    extension: { readFile: (name) => fs.readFile(path.join(root, name), 'utf8') },
    network: { fetch },
    helpers: { citations: { create: async (details) => `Citation: ${details.author}` } },
    vault: {
      create: async (name, content) => {
        writes.push({ name, content });
        return name;
      },
    },
    ui: { openExternal: async () => true, openNote: async (name) => opened.push(name) },
  };
  const source = await fs.readFile(path.join(root, 'main.js'), 'utf8');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction('tagline', source)(tagline);
  return { send: handler, sent, writes, opened, html };
}

test('scholarly search is a standalone extension and normalizes Crossref results', async () => {
  const manifest = validateManifest(
    JSON.parse(await fs.readFile(path.join(root, 'manifest.json'))),
    root,
    validateLimits()
  );
  assert.equal(manifest.contributes.webviews[0].placement, 'search');
  const plugin = await start(async (address, options) => {
    const url = new URL(address);
    assert.equal(url.host, 'api.crossref.org');
    assert.equal(url.searchParams.get('query.bibliographic'), 'climate policy');
    assert.equal(options.responseType, 'json');
    return {
      ok: true,
      body: {
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
      },
    };
  });
  assert.match(plugin.html, /Search Crossref/);
  await plugin.send({ type: 'search', query: ' climate policy ' });
  assert.deepEqual(plugin.sent[0].results[0], {
    author: 'Ada Smith',
    year: '2023',
    title: 'Climate Policy',
    publication: 'Journal',
    url: 'https://doi.org/10.1234/one(two)',
  });
  assert.equal(plugin.sent[0].results[1].year, '');
  await plugin.send({ type: 'excerpt-start' });
  await plugin.send({ type: 'excerpt-chunk', text: 'Evidence from the source.' });
  await plugin.send({ type: 'save', tag: 'Climate Policy', citation: { author: 'Ada Smith' } });
  assert.equal(plugin.writes[0].name, 'Climate Policy.md');
  assert.match(plugin.writes[0].content, /Ada Smith[\s\S]*Evidence from the source/);
  assert.equal(plugin.sent.at(-1).type, 'saved');
  assert.deepEqual(plugin.opened, ['Climate Policy.md']);
  await plugin.send({ type: 'search', query: 'a'.repeat(301) });
  assert.match(plugin.sent.at(-1).message, /300/);
});

test('scholarly search reports invalid Crossref responses', async () => {
  const plugin = await start(async () => ({ ok: true, body: {} }));
  await plugin.send({ type: 'search', query: 'test' });
  assert.match(plugin.sent.at(-1).message, /invalid/);
});
