const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

// The community registry is a list of GitHub URLs maintained through pull requests to
// extensions/registry.json. Downloads are pinned to the resolved commit and every file is checked
// against its Git blob hash before the normal folder installer validates and copies it.
const REGISTRY_URL =
  'https://raw.githubusercontent.com/Julieisbaka/Tagline/main/extensions/registry.json';
const REGISTRY_PAGE = 'https://github.com/Julieisbaka/Tagline/blob/main/extensions/registry.json';
const ALLOWED_HOSTS = new Set(['api.github.com', 'raw.githubusercontent.com']);
const MAX_ENTRIES = 500;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_TREE_BYTES = 16 * 1024 * 1024;
const CACHE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 20000;
const CONCURRENCY = 6;
const SKIPPED_NAMES = new Set(['.git', 'node_modules']);
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const SEGMENT = /^[A-Za-z0-9._@+-]{1,255}$/;

function parseSourceUrl(value) {
  const fail = () => {
    throw new Error(
      'Registry URLs must look like https://github.com/owner/repo or https://github.com/owner/repo/tree/ref/folder.'
    );
  };
  if (typeof value !== 'string' || value !== value.trim() || value.length > 2048) {
    fail();
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    fail();
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.href.replace(/\/$/, '') !== value.replace(/\/$/, '')
  ) {
    fail();
  }
  const parts = url.pathname.replace(/\/$/, '').split('/').slice(1);
  const [owner, repo, kind, ref, ...dir] = parts;
  if (
    !OWNER.test(owner || '') ||
    !REPO.test(repo || '') ||
    repo === '.' ||
    repo === '..' ||
    repo.endsWith('.git') ||
    (parts.length > 2 && (kind !== 'tree' || !ref)) ||
    [ref, ...dir].some(
      (segment) => segment !== undefined && (!SEGMENT.test(segment) || /^\.+$/.test(segment))
    )
  ) {
    fail();
  }
  return {
    url: `https://github.com/${parts.join('/')}`,
    owner,
    repo,
    ref: ref || null,
    dir: dir.join('/'),
  };
}

// GitHub owner and repository names are case-insensitive; refs and folder paths are not.
function assertSameSource(source, sourceUrl) {
  let declared = null;
  try {
    declared = sourceUrl ? parseSourceUrl(sourceUrl.replace(/\/$/, '')) : null;
  } catch {
    // Reported below as a mismatch.
  }
  if (
    !declared ||
    declared.owner.toLowerCase() !== source.owner.toLowerCase() ||
    declared.repo.toLowerCase() !== source.repo.toLowerCase() ||
    declared.ref !== source.ref ||
    declared.dir !== source.dir
  ) {
    throw new Error(
      `The manifest sourceUrl must match the registry URL ${source.url} (found ${sourceUrl || 'none'}).`
    );
  }
}

function validateRegistry(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 1) {
    throw new Error('The extension registry must be an object with version 1.');
  }
  if (!Array.isArray(data.extensions) || data.extensions.length > MAX_ENTRIES) {
    throw new Error(`The extension registry must list at most ${MAX_ENTRIES} extensions.`);
  }
  const seen = new Set();
  return data.extensions.map((entry, index) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      Object.keys(entry).some((key) => key !== 'url')
    ) {
      throw new Error(`Registry entry ${index + 1} must contain only a url.`);
    }
    const source = parseSourceUrl(entry.url);
    const key = source.url.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`Registry entry ${index + 1} duplicates ${source.url}.`);
    }
    seen.add(key);
    return source;
  });
}

const encodePath = (value) => value.split('/').map(encodeURIComponent).join('/');
const rawUrl = (source, ref, file) =>
  `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${encodeURIComponent(ref)}/${encodePath(file)}`;
const joinPath = (dir, file) => (dir ? `${dir}/${file}` : file);

async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function createExtensionRegistry({
  fetchImpl = (...args) => globalThis.fetch(...args),
  registryUrl = REGISTRY_URL,
  stagingRoot,
  validateManifest,
  limits,
  installFromFolder,
  validateSchema,
  maxFiles,
  maxBytes,
}) {
  let cache = null;

  async function request(url, { accept = 'application/json', limit = MAX_JSON_BYTES } = {}) {
    if (!ALLOWED_HOSTS.has(new URL(url).hostname)) {
      throw new Error('Extension registry downloads are limited to GitHub.');
    }
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { Accept: accept, 'User-Agent': 'Tagline' },
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(
        error?.name === 'TimeoutError'
          ? 'GitHub did not respond in time.'
          : 'Could not reach GitHub. Check your connection and try again.'
      );
    }
    if (response.url && !ALLOWED_HOSTS.has(new URL(response.url).hostname)) {
      throw new Error('Extension registry downloads are limited to GitHub.');
    }
    if (!response.ok) {
      throw new Error(
        response.status === 404
          ? 'Not found on GitHub.'
          : response.status === 403 || response.status === 429
            ? 'GitHub rate limit reached. Try again later.'
            : `GitHub returned HTTP ${response.status}.`
      );
    }
    if (Number(response.headers?.get?.('content-length')) > limit) {
      throw new Error('The download is too large.');
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > limit) {
      throw new Error('The download is too large.');
    }
    return body;
  }

  const requestJson = async (url, options) => {
    const body = await request(url, options);
    try {
      return JSON.parse(body.toString('utf8'));
    } catch {
      throw new Error('GitHub returned invalid JSON.');
    }
  };

  function checkManifest(source, value) {
    validateSchema?.(value);
    const manifest = validateManifest(value, path.join(stagingRoot(), 'preview'), limits());
    assertSameSource(source, manifest.sourceUrl);
    return manifest;
  }

  async function inspect(source) {
    try {
      const manifest = checkManifest(
        source,
        await requestJson(
          rawUrl(source, source.ref || 'HEAD', joinPath(source.dir, 'manifest.json'))
        )
      );
      return {
        url: source.url,
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        authors: manifest.authors,
        sourceUrl: manifest.sourceUrl,
        permissions: manifest.permissions,
        networkHosts: manifest.networkHosts,
        error: null,
      };
    } catch (error) {
      return { url: source.url, id: null, name: source.url, error: error.message };
    }
  }

  async function list(refresh = false) {
    if (!refresh && cache && Date.now() - cache.fetchedAt < CACHE_MS) {
      return cache.result;
    }
    const sources = validateRegistry(await requestJson(registryUrl));
    const entries = await mapLimit(sources, CONCURRENCY, inspect);
    const ids = new Set();
    for (const entry of entries) {
      if (entry.id && ids.has(entry.id)) {
        Object.assign(entry, {
          id: null,
          error: `Another registry entry already uses the extension id "${entry.id}".`,
        });
      } else if (entry.id) {
        ids.add(entry.id);
      }
    }
    const result = { registryUrl: REGISTRY_PAGE, entries, fetchedAt: Date.now() };
    cache = { fetchedAt: result.fetchedAt, result, sources };
    return result;
  }

  async function resolveCommit(source) {
    const sha = (
      await request(
        `https://api.github.com/repos/${source.owner}/${source.repo}/commits/${encodeURIComponent(source.ref || 'HEAD')}`,
        { accept: 'application/vnd.github.sha', limit: 200 }
      )
    )
      .toString('utf8')
      .trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) {
      throw new Error('GitHub returned an invalid commit.');
    }
    return sha;
  }

  async function download(source, sha, staging) {
    const tree = await requestJson(
      `https://api.github.com/repos/${source.owner}/${source.repo}/git/trees/${sha}?recursive=1`,
      { accept: 'application/vnd.github+json', limit: MAX_TREE_BYTES }
    );
    if (!tree || !Array.isArray(tree.tree)) {
      throw new Error('GitHub returned an invalid file list.');
    }
    if (tree.truncated) {
      throw new Error('The repository is too large to install from the registry.');
    }
    const prefix = source.dir ? `${source.dir}/` : '';
    const files = tree.tree.filter(
      (item) =>
        item?.type === 'blob' &&
        item.mode !== '120000' &&
        typeof item.path === 'string' &&
        item.path.startsWith(prefix) &&
        !item.path
          .slice(prefix.length)
          .split('/')
          .some((segment) => SKIPPED_NAMES.has(segment))
    );
    if (!files.some((item) => item.path === `${prefix}manifest.json`)) {
      throw new Error('No manifest.json was found at the registry URL.');
    }
    let total = 0;
    for (const item of files) {
      if (!Number.isSafeInteger(item.size) || item.size < 0 || !/^[0-9a-f]{40}$/.test(item.sha)) {
        throw new Error('GitHub returned an invalid file list.');
      }
      total += item.size;
    }
    if (files.length > maxFiles || total > maxBytes) {
      throw new Error('Extension folder is too large to install.');
    }
    await mapLimit(files, CONCURRENCY, async (item) => {
      const relative = item.path.slice(prefix.length);
      const target = path.resolve(staging, ...relative.split('/'));
      const contained = path.relative(staging, target);
      if (!contained || contained.startsWith('..') || path.isAbsolute(contained)) {
        throw new Error(`File escapes the extension folder: ${relative}`);
      }
      const body = await request(rawUrl(source, sha, item.path), {
        accept: 'application/octet-stream',
        limit: item.size,
      });
      const blobSha = createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
      if (body.length !== item.size || blobSha !== item.sha) {
        throw new Error(`Downloaded file did not match GitHub: ${relative}`);
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, body);
    });
  }

  async function install(url, expectedId) {
    if (typeof url !== 'string' || typeof expectedId !== 'string') {
      throw new Error('Invalid registry install request.');
    }
    if (!cache) {
      await list();
    }
    const source = cache.sources.find((item) => item.url === url);
    const entry = cache.result.entries.find((item) => item.url === url);
    if (!source || !entry || entry.error || entry.id !== expectedId) {
      throw new Error('That extension is not in the registry. Refresh the list and try again.');
    }
    const sha = await resolveCommit(source);
    const staging = path.join(stagingRoot(), randomUUID());
    await fs.mkdir(staging, { recursive: true });
    try {
      await download(source, sha, staging);
      const manifest = checkManifest(
        source,
        JSON.parse(await fs.readFile(path.join(staging, 'manifest.json'), 'utf8'))
      );
      if (manifest.id !== expectedId) {
        throw new Error('The extension changed since the list loaded. Refresh and try again.');
      }
      return { ...(await installFromFolder(staging)), commit: sha };
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }

  return { list, install };
}

module.exports = {
  createExtensionRegistry,
  parseSourceUrl,
  validateRegistry,
  REGISTRY_URL,
  REGISTRY_PAGE,
};
