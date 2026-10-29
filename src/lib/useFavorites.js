import { useCallback, useEffect, useState } from 'react';
import { readStoredJson } from './storedJson.js';

const STORAGE_KEY = 'tagline-favorites';

export function renameFavorites(paths, from, to) {
  return paths.map((path) => path === from || path.startsWith(from + '/') ? to + path.slice(from.length) : path);
}

export function removeFavorites(paths, removed) {
  return paths.filter((path) => path !== removed && !path.startsWith(removed + '/'));
}

export function useFavorites(root) {
  const [vaults, setVaults] = useState(() => readStoredJson(STORAGE_KEY, {}, (value) =>
    value && typeof value === 'object' && !Array.isArray(value) &&
    Object.values(value).every((paths) => Array.isArray(paths) && paths.every((path) => typeof path === 'string'))));

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(vaults)); }
    catch (error) { window.dispatchEvent(new CustomEvent('app-error', { detail: `Could not save pinned notes: ${error.message}` })); }
  }, [vaults]);

  const update = useCallback((change) => {
    if (!root) return;
    setVaults((previous) => ({ ...previous, [root]: change(previous[root] || []) }));
  }, [root]);

  return {
    paths: vaults[root] || [],
    toggle: (path) => update((paths) => paths.includes(path) ? paths.filter((item) => item !== path) : [...paths, path]),
    rename: (from, to) => update((paths) => renameFavorites(paths, from, to)),
    remove: (path) => update((paths) => removeFavorites(paths, path)),
  };
}
