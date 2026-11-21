export function resourceLimits(settings) {
  return {
    visualCacheEntries: settings.lowResourceMode
      ? Math.min(settings.visualCacheEntries, 8)
      : settings.visualCacheEntries,
    visualCacheCharacters: settings.lowResourceMode
      ? Math.min(settings.visualCacheCharacters, 2_000_000)
      : settings.visualCacheCharacters,
    searchMaxResults: settings.lowResourceMode
      ? Math.min(settings.searchMaxResults, 20)
      : settings.searchMaxResults,
  };
}
