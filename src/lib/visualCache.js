const cache = new Map();
let maxEntries = 16;
let maxCharacters = 4_000_000;
let characters = 0;

function trimCache() {
  while (cache.size > maxEntries || characters > maxCharacters) {
    const oldest = cache.keys().next().value;
    characters -= cache.get(oldest).size;
    cache.delete(oldest);
  }
}

export function configureVisualCache(entries, limit) {
  if (!Number.isInteger(entries) || entries < 0 || !Number.isInteger(limit) || limit < 0) {
    throw new Error('Cache limits must be non-negative integers.');
  }
  maxEntries = entries;
  maxCharacters = limit;
  trimCache();
}

export function cachedDocument(markdown) {
  const entry = cache.get(markdown);
  if (!entry) return null;
  cache.delete(markdown);
  cache.set(markdown, entry);
  return structuredClone(entry.json);
}

export function cacheDocument(markdown, json) {
  const size = markdown.length + JSON.stringify(json).length;
  const previous = cache.get(markdown);
  if (previous) { characters -= previous.size; cache.delete(markdown); }
  if (!maxEntries || size > maxCharacters) return;
  cache.set(markdown, { json: structuredClone(json), size });
  characters += size;
  trimCache();
}
