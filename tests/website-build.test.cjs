const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseDocument } = require('htmlparser2');
const { buildWebsite, loadSources, renderHtml } = require('../scripts/build-website.cjs');
const { syncDocs, syncValues } = require('../scripts/sync-doc-values.cjs');

const rootDir = path.join(__dirname, '..');

test('website build renders code-derived values from the application sources', async () => {
  const sources = await loadSources(rootDir);
  const render = (body) => renderHtml(`{{TAGLINE:${body}}}`, sources);

  assert.equal(render('SETTING:templateFolder'), sources.settings.templateFolder);
  assert.equal(render('SETTING:timerFloatingWindow'), 'off');
  assert.equal(render('KEY:send-card'), 'Mod+Shift+S');
  assert.equal(render('KEY_WIN:flow-row'), 'Ctrl+Enter');
  assert.equal(render('KEY_MAC:flow-row'), 'Cmd+Enter');
  assert.equal(render('KEY:flow-cell-up'), 'Alt+Up');
  assert.equal(render('KEY:flow-deselect'), 'Esc');
  assert.equal(render('LIMIT:themeFileBytes'), '65,536');
  assert.equal(render('LIMIT:themeFileBytes.max'), '1,048,576');
  assert.equal(render('CONST:electron/extensions/storage.cjs#MAX_SECRETS'), '50');
});

test('website build rejects unresolvable or malformed tokens', async () => {
  const sources = await loadSources(rootDir);

  for (const body of [
    'SETTING:doesNotExist',
    'SETTING:timerState',
    'KEY:doesNotExist',
    'KEY:new-flow',
    'LIMIT:themeFileBytes.step',
    'LIMIT:doesNotExist',
    'CONST:electron/extensions/storage.cjs#NOT_DECLARED',
    'CONST:../package.json#VERSION',
    'UNKNOWN:value',
  ]) {
    assert.throws(() => renderHtml(`{{TAGLINE:${body}}}`, sources), /ebsite template/, body);
  }
});

test('website build evaluates simple numeric constant products', async () => {
  const sources = await loadSources(rootDir);
  const constantRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tagline-website-const-'));

  try {
    fs.writeFileSync(
      path.join(constantRoot, 'limits.cjs'),
      'const MAX_BYTES = 5 * 1_024 * 1_024;\n'
    );
    assert.equal(
      renderHtml('{{TAGLINE:CONST:limits.cjs#MAX_BYTES}}', { ...sources, rootDir: constantRoot }),
      '5,242,880'
    );
  } finally {
    fs.rmSync(constantRoot, { recursive: true, force: true });
  }
});

test('website builds without the retired documentation or unresolved tokens', async () => {
  const sources = await loadSources(rootDir);
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tagline-website-build-'));

  try {
    buildWebsite(path.join(rootDir, 'website'), outputDir, sources);

    assert.equal(fs.existsSync(path.join(outputDir, 'docs')), false);
    const pages = fs.readdirSync(outputDir).filter((name) => name.endsWith('.html'));
    assert.ok(pages.length > 0);
    for (const page of pages) {
      const html = fs.readFileSync(path.join(outputDir, page), 'utf8');
      assert.doesNotMatch(html, /\{\{TAGLINE:/, page);
    }
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('Mintlify documentation values stay synchronized with application defaults', async () => {
  const sources = await loadSources(rootDir);
  const input = '<kbd>{/* TAGLINE:KEY:commands */}old{/* /TAGLINE */}</kbd>';
  assert.equal(
    syncValues(input, sources),
    '<kbd>{/* TAGLINE:KEY:commands */}Mod+P{/* /TAGLINE */}</kbd>'
  );
  assert.throws(() => syncValues('{/* TAGLINE:KEY:commands */}old', sources), /Malformed/);
  assert.throws(
    () => syncValues('{/* TAGLINE:KEY:missing */}x{/* /TAGLINE */}', sources),
    /Unknown shortcut/
  );
  assert.deepEqual(await syncDocs(rootDir, true), []);
});

test('Mintlify preserves legacy guide URLs and section anchors', () => {
  const config = JSON.parse(fs.readFileSync(path.join(rootDir, 'docs', 'docs.json'), 'utf8'));
  const pages = config.navigation.groups.flatMap((group) => group.pages);
  const legacyAnchors = {
    customization: ['appearance', 'themes', 'extensions', 'formats'],
    'evidence-quality': ['scan', 'links', 'findings', 'quote', 'limits'],
    'extension-api': [
      'install',
      'registry',
      'review',
      'minimal',
      'assets',
      'manifest',
      'permissions',
      'network',
      'commands-editor',
      'events',
      'extension-apis',
      'ui',
      'helpers',
      'settings',
      'canvas-flow',
      'vault',
      'storage',
      'secrets',
      'themes-shortcuts',
    ],
    features: ['vaults', 'notes', 'research', 'speech-tools', 'export'],
    'flows-and-canvases': ['flow', 'cells', 'flow-v2', 'canvas', 'connections', 'files'],
    'getting-started': ['backups-and-migrations'],
    'google-docs': ['direct-sign-in', 'webhook', 'accounts', 'send-documents', 'response-codes'],
    'importing-and-exporting': ['requirements', 'pandoc', 'import', 'export', 'review'],
    index: [],
    integrations: [
      'agent-access',
      'tagline-links',
      'local-models',
      'document-conversion',
      'tabroom',
      'opencaselist',
      'google-docs',
    ],
    'json-formats': ['formats', 'flow-v2', 'editor-support', 'add-schema'],
    'keyboard-shortcuts': ['application', 'notes', 'flow', 'customize'],
    'notes-and-evidence': [
      'create-note',
      'edit-modes',
      'evidence-card',
      'research-workflow',
      'link-notes',
      'templates-history',
    ],
    'search-and-citations': [
      'vault-search',
      'semantic-search',
      'scholarly-search',
      'create-citation',
      'local-tools',
    ],
    'speech-workflows': [
      'choose-document',
      'send-evidence',
      'timing',
      'prep-timer',
      'floating-timer',
      'flows',
      'argument-map',
    ],
    'theme-api': [
      'create',
      'contract',
      'colors',
      'variables',
      'metadata',
      'contrast',
      'extension-themes',
    ],
    'vaults-and-backups': ['where', 'manage', 'backup', 'history', 'migration'],
  };
  for (const [slug, anchors] of Object.entries(legacyAnchors)) {
    assert.ok(pages.includes(slug), `${slug}: missing navigation`);
    const mdx = fs.readFileSync(path.join(rootDir, 'docs', `${slug}.mdx`), 'utf8');
    assert.ok(
      config.redirects.some(
        (entry) => entry.source === `/${slug}.html` && entry.destination === `/${slug}`
      ),
      `${slug}: missing legacy redirect`
    );
    for (const anchor of anchors) {
      assert.ok(mdx.includes(`{#${anchor}}`), `${slug}: missing legacy anchor ${anchor}`);
    }
  }
});

test('website and repository documentation links target existing Mintlify pages and anchors', () => {
  const config = JSON.parse(fs.readFileSync(path.join(rootDir, 'docs', 'docs.json'), 'utf8'));
  const pages = new Set(config.navigation.groups.flatMap((group) => group.pages));
  const origin = 'https://tagline.julieisbaka.dev';

  function check(href, file) {
    const url = new URL(href, `${origin}/`);
    if (url.origin !== origin || !/^\/docs(?:\/|$)/.test(url.pathname)) {
      return false;
    }
    assert.ok(
      href.startsWith(`${origin}/docs`),
      `${file}: use an absolute documentation URL: ${href}`
    );
    const slug =
      url.pathname === '/docs' || url.pathname === '/docs/' ? 'index' : url.pathname.slice(6);
    assert.ok(pages.has(slug), `${file}: missing documentation page: ${href}`);
    if (url.hash) {
      const mdx = fs.readFileSync(path.join(rootDir, 'docs', `${slug}.mdx`), 'utf8');
      assert.ok(
        mdx.includes(`{#${decodeURIComponent(url.hash.slice(1))}}`),
        `${file}: missing anchor: ${href}`
      );
    }
    return true;
  }

  for (const file of fs
    .readdirSync(path.join(rootDir, 'website'))
    .filter((name) => name.endsWith('.html'))) {
    let links = 0;
    const html = parseDocument(fs.readFileSync(path.join(rootDir, 'website', file), 'utf8'));
    const visit = (node) => {
      if (node.name === 'a' && node.attribs.href && check(node.attribs.href, file)) {
        links++;
      }
      for (const child of node.children || []) {
        visit(child);
      }
    };
    visit(html);
    assert.ok(links > 0, `${file}: no documentation links`);
  }
  for (const file of ['README.md', 'CONTRIBUTING.md', path.join('demo', 'README.md')]) {
    const content = fs.readFileSync(path.join(rootDir, file), 'utf8');
    const links = [
      ...content.matchAll(/\]\((https:\/\/tagline\.julieisbaka\.dev\/docs[^)\s]*)\)/g),
    ];
    assert.ok(links.length > 0, `${file}: no documentation links`);
    for (const [, href] of links) {
      check(href, file);
    }
  }
});
