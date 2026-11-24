const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseDocument } = require('htmlparser2');

const root = path.join(__dirname, '..', 'website');
const pages = fs
  .readdirSync(root)
  .filter((file) => file.endsWith('.html'))
  .map((file) => path.join(root, file));

function elements(node) {
  return (node.children || []).flatMap((child) => [child, ...elements(child)]);
}

const documents = new Map(
  pages.map((file) => [file, elements(parseDocument(fs.readFileSync(file, 'utf8')))])
);

test('website pages have navigation and a working skip link', () => {
  for (const [file, nodes] of documents) {
    const label = path.relative(root, file);
    assert.ok(
      nodes.some((node) => node.name === 'html' && node.attribs.lang === 'en'),
      label
    );
    assert.equal(nodes.filter((node) => node.name === 'h1').length, 1, label);
    assert.ok(
      nodes.some((node) => node.name === 'main' && node.attribs.id === 'main'),
      label
    );
    assert.ok(
      nodes.some(
        (node) =>
          node.name === 'a' && node.attribs.class === 'skip-link' && node.attribs.href === '#main'
      ),
      label
    );
    const nav = nodes.find((node) => node.name === 'nav' && node.attribs.class === 'main-nav');
    assert.ok(nav, label);
    for (const name of ['Features', 'Pricing', 'Docs', 'Changelog']) {
      assert.ok(
        elements(nav).some((node) => node.type === 'text' && node.data.trim() === name),
        `${label}: ${name}`
      );
    }
  }
});

test('website local links, assets, and fragments resolve', () => {
  for (const [file, nodes] of documents) {
    const ids = nodes.filter((node) => node.attribs?.id).map((node) => node.attribs.id);
    assert.equal(new Set(ids).size, ids.length, `${file}: duplicate IDs`);
    for (const node of nodes) {
      const url = node.attribs?.href || node.attribs?.src;
      if (!url || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) {
        continue;
      }
      const [pathname, fragment] = url.split('#');
      const target = pathname
        ? path.resolve(path.dirname(file), decodeURIComponent(pathname.split('?')[0]))
        : file;
      assert.ok(fs.existsSync(target), `${file}: missing ${url}`);
      if (fragment) {
        assert.ok(
          documents
            .get(target)
            ?.some((element) => element.attribs?.id === decodeURIComponent(fragment)),
          `${file}: missing ${url}`
        );
      }
    }
  }
});

test('every documentation guide is linked from the documentation navigation', () => {
  const docs = path.join(__dirname, '..', 'docs');
  const config = JSON.parse(fs.readFileSync(path.join(docs, 'docs.json'), 'utf8'));
  const guides = fs.readdirSync(docs).filter((file) => file.endsWith('.mdx'));
  const pages = config.navigation.groups.flatMap((group) => group.pages);
  assert.ok(guides.length > 0, 'no documentation guides found');
  assert.deepEqual(pages.map((page) => `${page}.mdx`).sort(), guides.sort());
});
