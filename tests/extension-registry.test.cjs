const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Ajv = require('ajv');
const {
  createExtensionRegistry,
  parseSourceUrl,
  validateRegistry,
  REGISTRY_URL,
} = require('../electron/extensionRegistry.cjs');
const { validateManifest } = require('../electron/extensions.cjs');

const root = path.join(__dirname, '..');
const blobSha = (body) =>
  createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');

test('committed registry is valid for the schema and the app', async () => {
  const registry = JSON.parse(
    await fs.readFile(path.join(root, 'extensions', 'registry.json'), 'utf8')
  );
  const schema = JSON.parse(
    await fs.readFile(path.join(root, 'schemas', 'extension-registry.schema.json'), 'utf8')
  );
  const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);
  assert.equal(validate(registry), true, JSON.stringify(validate.errors));
  assert.ok(validateRegistry(registry).length > 0);
});

test('registry URLs are limited to GitHub repository folders', () => {
  assert.deepEqual(parseSourceUrl('https://github.com/owner/repo/'), {
    url: 'https://github.com/owner/repo',
    owner: 'owner',
    repo: 'repo',
    ref: null,
    dir: '',
  });
  assert.deepEqual(parseSourceUrl('https://github.com/owner/repo/tree/v1.2/ext/my-ext'), {
    url: 'https://github.com/owner/repo/tree/v1.2/ext/my-ext',
    owner: 'owner',
    repo: 'repo',
    ref: 'v1.2',
    dir: 'ext/my-ext',
  });
  for (const url of [
    'http://github.com/owner/repo',
    'https://gitlab.com/owner/repo',
    'https://user@github.com/owner/repo',
    'https://github.com/owner',
    'https://github.com/owner/repo.git',
    'https://github.com/owner/repo/blob/main/manifest.json',
    'https://github.com/owner/repo/tree/main/../secret',
    'https://github.com/owner/repo?tab=readme',
    ' https://github.com/owner/repo',
  ]) {
    assert.throws(() => parseSourceUrl(url), /Registry URLs/, url);
  }
  assert.throws(
    () =>
      validateRegistry({
        version: 1,
        extensions: [{ url: 'https://github.com/a/b' }, { url: 'https://github.com/A/B/' }],
      }),
    /duplicates/
  );
  assert.throws(
    () => validateRegistry({ version: 1, extensions: [{ url: 'https://github.com/a/b', x: 1 }] }),
    /only a url/
  );
});

function fakeGitHub(files, { registry, sha = 'a'.repeat(40), tampered = {} } = {}) {
  const requests = [];
  const respond = (body, status = 200) =>
    new Response(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body), {
      status,
    });
  const fetchImpl = async (url) => {
    requests.push(url);
    if (url === REGISTRY_URL) {
      return respond(registry);
    }
    if (url === 'https://api.github.com/repos/owner/repo/commits/v1') {
      return respond(sha);
    }
    if (url === `https://api.github.com/repos/owner/repo/git/trees/${sha}?recursive=1`) {
      return respond({
        truncated: false,
        tree: Object.entries(files).map(([file, body]) => ({
          path: file,
          type: 'blob',
          mode: file.endsWith('.link') ? '120000' : '100644',
          size: Buffer.byteLength(body),
          sha: blobSha(Buffer.from(body)),
        })),
      });
    }
    const raw = url.match(/^https:\/\/raw\.githubusercontent\.com\/owner\/repo\/([^/]+)\/(.+)$/);
    if (raw && files[decodeURIComponent(raw[2])] !== undefined) {
      return respond(tampered[raw[2]] ?? files[decodeURIComponent(raw[2])]);
    }
    return respond('missing', 404);
  };
  return { fetchImpl, requests };
}

const manifest = (overrides = {}) =>
  JSON.stringify({
    manifestVersion: 1,
    id: 'notes-helper',
    name: 'Notes Helper',
    version: '1.0.0',
    authors: ['Ada'],
    main: 'main.js',
    ...overrides,
  });

async function setup(files, options) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-registry-'));
  const installed = [];
  const github = fakeGitHub(files, {
    registry: {
      version: 1,
      extensions: [
        { url: 'https://github.com/owner/repo/tree/v1/ext' },
        { url: 'https://github.com/owner/repo/tree/v1/broken' },
        { url: 'https://github.com/owner/repo/tree/v1/copy' },
      ],
    },
    ...options,
  });
  const registry = createExtensionRegistry({
    fetchImpl: github.fetchImpl,
    stagingRoot: () => dir,
    validateManifest,
    limits: () => undefined,
    maxFiles: 10,
    maxBytes: 10000,
    installFromFolder: async (folder) => {
      const copy = {};
      const walk = async (current) => {
        for (const entry of await fs.readdir(current, { withFileTypes: true })) {
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) {
            await walk(full);
          } else {
            copy[path.relative(folder, full).split(path.sep).join('/')] = await fs.readFile(
              full,
              'utf8'
            );
          }
        }
      };
      await walk(folder);
      installed.push(copy);
      return { id: 'notes-helper', name: 'Notes Helper', version: '1.0.0' };
    },
  });
  return { dir, registry, installed, requests: github.requests };
}

test('registry lists manifests and installs a commit-pinned, hash-verified folder', async () => {
  const files = {
    'ext/manifest.json': manifest(),
    'ext/main.js': 'tagline.log("hi")',
    'ext/themes/dark.json': '{}',
    'ext/node_modules/pkg/index.js': 'skip',
    'ext/escape.link': '../../secret',
    'broken/manifest.json': '{"manifestVersion":2}',
    'copy/manifest.json': manifest({ name: 'Copy' }),
    'outside.txt': 'not part of the extension',
  };
  const { dir, registry, installed, requests } = await setup(files);
  try {
    const { entries } = await registry.list();
    assert.equal(entries[0].id, 'notes-helper');
    assert.deepEqual(entries[0].authors, ['Ada']);
    assert.equal(entries[0].sourceUrl, 'https://github.com/owner/repo/tree/v1/ext');
    assert.match(entries[1].error, /manifestVersion/);
    assert.match(entries[2].error, /already uses the extension id/);

    const result = await registry.install(entries[0].url, 'notes-helper');
    assert.equal(result.commit, 'a'.repeat(40));
    assert.deepEqual(installed[0], {
      'main.js': 'tagline.log("hi")',
      'manifest.json': files['ext/manifest.json'],
      'themes/dark.json': '{}',
    });
    assert.ok(
      requests.includes(
        `https://raw.githubusercontent.com/owner/repo/${'a'.repeat(40)}/ext/main.js`
      ),
      'files download from the resolved commit'
    );
    assert.deepEqual(await fs.readdir(dir), [], 'staging folder is removed');

    await assert.rejects(registry.install(entries[1].url, 'notes-helper'), /not in the registry/);
    await assert.rejects(
      registry.install('https://github.com/other/repo', 'notes-helper'),
      /not in the registry/
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('registry install rejects files that do not match GitHub hashes', async () => {
  const files = {
    'ext/manifest.json': manifest(),
    'ext/main.js': 'original',
  };
  const { dir, registry, installed } = await setup(files, {
    tampered: { 'ext/main.js': 'evil!!!!' },
  });
  try {
    await registry.list();
    await assert.rejects(
      registry.install('https://github.com/owner/repo/tree/v1/ext', 'notes-helper'),
      /did not match GitHub: main\.js/
    );
    assert.equal(installed.length, 0);
    assert.deepEqual(await fs.readdir(dir), []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
