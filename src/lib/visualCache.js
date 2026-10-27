import defaults from './defaultSettings.json' with { type: 'json' };

const cache = new Map();
let maxEntries = defaults.visualCacheEntries;
let maxCharacters = defaults.visualCacheCharacters;
let characters = 0;

/** Evict least-recently-used serialized documents until configured bounds are met. @returns {void} */
function trimCache() {
  while (cache.size > maxEntries || characters > maxCharacters) {
    const oldest = cache.keys().next().value;
    characters -= cache.get(oldest).size;
    cache.delete(oldest);
  }
}

/** Configure maximum cached document count and serialized character budget. @param {number} entries @param {number} limit @returns {void} */
export function configureVisualCache(entries, limit) {
  if (!Number.isInteger(entries) || entries < 0 || !Number.isInteger(limit) || limit < 0) {
    throw new Error('Cache limits must be non-negative integers.');
  }
  maxEntries = entries;
  maxCharacters = limit;
  trimCache();
}

/** Return a cloned cached visual document and promote it to most-recently-used. @param {string} markdown @returns {object|null} */
export function cachedDocument(markdown) {
  const entry = cache.get(markdown);
  if (!entry) return null;
  cache.delete(markdown);
  cache.set(markdown, entry);
  return structuredClone(entry.json);
}

/** Cache a cloned visual document if it fits current entry and character limits. @param {string} markdown @param {object} json @returns {void} */
export function cacheDocument(markdown, json) {
  const size = markdown.length + JSON.stringify(json).length;
  const previous = cache.get(markdown);
  if (previous) { characters -= previous.size; cache.delete(markdown); }
  if (!maxEntries || size > maxCharacters) return;
  cache.set(markdown, { json: structuredClone(json), size });
  characters += size;
  trimCache();
}
