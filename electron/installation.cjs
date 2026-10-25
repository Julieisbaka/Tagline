const os = require('node:os');
const { version } = require('../package.json');
const REPOSITORY_URL = 'https://github.com/Julieisbaka/Tagline';
const RELEASES_URL = `${REPOSITORY_URL}/releases`;
const LATEST_RELEASE_API = 'https://api.github.com/repos/Julieisbaka/Tagline/releases/latest';

function parseVersion(value) {
  const match = typeof value === 'string' && value.match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-z-]+(?:\.[\da-z-]+)*))?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?$/i);
  if (!match || match[4]?.split('.').some((part) => /^\d+$/.test(part) && part.length > 1 && part[0] === '0')) {
    throw new Error('Release version is not a valid semantic version.');
  }
  return { core: match.slice(1, 4).map(BigInt), pre: match[4]?.split('.') || [] };
}

function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  const compare = (x, y) => x === y ? 0 : x < y ? -1 : 1;
  for (let index = 0; index < 3; index++) {
    const order = compare(a.core[index], b.core[index]);
    if (order) return order;
  }
  if (!a.pre.length || !b.pre.length) return compare(!a.pre.length, !b.pre.length);
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index++) {
    if (a.pre[index] === undefined) return -1;
    if (b.pre[index] === undefined) return 1;
    const x = a.pre[index], y = b.pre[index], xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    const order = xn && yn ? compare(BigInt(x), BigInt(y)) : xn !== yn ? (xn ? -1 : 1) : compare(x, y);
    if (order) return order;
  }
  return 0;
}

async function checkForUpdates(currentVersion, fetchImpl = fetch) {
  parseVersion(currentVersion);
  const response = await fetchImpl(LATEST_RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Tagline-release-check' },
    signal: AbortSignal.timeout(15000), redirect: 'error', credentials: 'omit',
  });
  if (response.status === 404) {
    throw new Error("GitHub could not find a release accessible without signing in (HTTP 404). The repository may be private, or no stable release may be publicly available. This check does not use your browser's GitHub sign-in. Open View releases to check with your signed-in account.");
  }
  if (response.status === 403 || response.status === 429) throw new Error('GitHub rate limit reached. Try again later.');
  if (!response.ok) throw new Error(`GitHub release check failed (HTTP ${response.status}).`);
  const release = await response.json();
  if (!release || release.draft || release.prerelease || typeof release.tag_name !== 'string') {
    throw new Error('GitHub returned an invalid release.');
  }
  return {
    currentVersion, latestVersion: release.tag_name,
    updateAvailable: compareVersions(release.tag_name, currentVersion) > 0
  };
}

function installationInfo(app) {
  return {
    version: app.isPackaged ? app.getVersion() : version,
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    osVersion: os.release(),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    executable: app.getPath('exe'),
    profile: app.getPath('userData'),
  };
}

module.exports = { installationInfo, checkForUpdates, compareVersions, REPOSITORY_URL, RELEASES_URL };
