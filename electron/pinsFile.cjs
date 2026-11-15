const VERSION = 1;
const MAX_PINS = 10_000;
const MAX_PATH_LENGTH = 4_096;
const CORRUPT_PREFIX = 'pins.json.corrupt-';
const KEEP_CORRUPT_BACKUPS = 3;

function validRelativePath(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_PATH_LENGTH) {
    return false;
  }
  if (/^[\\/]|^[a-z]:/i.test(value) || value.includes('\\')) {
    return false;
  }
  return !value.split('/').some((part) => !part || part === '.' || part === '..');
}

function normalizePaths(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  const seen = new Set();
  for (const item of value) {
    const path = typeof item === 'string' ? item.trim() : item;
    if (!validRelativePath(path)) {
      return null;
    }
    seen.add(path);
    if (seen.size > MAX_PINS) {
      return null;
    }
  }
  return [...seen];
}

function normalizePins(value) {
  if (Array.isArray(value)) {
    const favorites = normalizePaths(value);
    return favorites ? { favorites, pinnedTabs: [] } : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  if (!('favorites' in value) && !('pinnedTabs' in value) && !('tabs' in value)) {
    return null;
  }
  const favorites = normalizePaths(value.favorites ?? []);
  const pinnedTabs = normalizePaths(value.pinnedTabs ?? value.tabs ?? []);
  return favorites && pinnedTabs ? { favorites, pinnedTabs } : null;
}

function parsePins(raw) {
  try {
    return normalizePins(JSON.parse(raw));
  } catch {
    return null;
  }
}

function serializePins(value) {
  const pins = normalizePins(value);
  if (!pins) {
    throw new Error('Invalid pinned items data.');
  }
  return JSON.stringify({ version: VERSION, ...pins }, null, 2);
}

function staleCorruptBackups(names, keep = KEEP_CORRUPT_BACKUPS) {
  const backups = names.filter((name) => name.startsWith(CORRUPT_PREFIX)).sort();
  return backups.slice(0, Math.max(0, backups.length - keep));
}

module.exports = { parsePins, serializePins, staleCorruptBackups, validRelativePath, VERSION };
