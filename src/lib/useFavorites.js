import { useCallback, useEffect, useRef, useState } from 'react';
import { readStoredJson } from './storedJson.js';

const STORAGE_KEY = 'tagline-favorites';

export function renameFavorites(paths, from, to) {
  return paths.map((path) =>
    path === from || path.startsWith(from + '/') ? to + path.slice(from.length) : path
  );
}

export function removeFavorites(paths, removed) {
  return paths.filter((path) => path !== removed && !path.startsWith(removed + '/'));
}

function reportSave(error) {
  window.dispatchEvent(
    new CustomEvent('app-error', { detail: `Could not save pinned items: ${error.message}` })
  );
}

// .tagline/pins.json is the single source of truth for pins and favorites. The legacy
// localStorage map is kept only as the one-way migration source; purged per vault once read.
// Remove STORAGE_KEY and this helper after one release.
function purgeLegacyRoot(root) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }
    const map = JSON.parse(raw);
    if (!map || typeof map !== 'object' || !(root in map)) {
      return;
    }
    delete map[root];
    if (Object.keys(map).length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    }
  } catch {
    // best effort; stale legacy data is harmless if it lingers
  }
}

export function useFavorites(root) {
  const [vaults, setVaults] = useState(() =>
    readStoredJson(
      STORAGE_KEY,
      {},
      (value) =>
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.values(value).every(
          (paths) => Array.isArray(paths) && paths.every((path) => typeof path === 'string')
        )
    )
  );
  const [tabPins, setTabPins] = useState({});
  const [loadedRoot, setLoadedRoot] = useState(null);
  const vaultsRef = useRef(vaults);
  vaultsRef.current = vaults;
  const tabPinsRef = useRef(tabPins);
  tabPinsRef.current = tabPins;

  useEffect(() => {
    let cancelled = false;
    if (!root) {
      setLoadedRoot(null);
      return undefined;
    }
    setLoadedRoot(null);
    if (!window.api?.readPins) {
      setLoadedRoot(root);
      return undefined;
    }
    window.api
      .readPins()
      .then((saved) => {
        if (cancelled) {
          return;
        }
        if (saved) {
          setVaults((previous) => ({ ...previous, [root]: saved.favorites }));
          setTabPins((previous) => ({ ...previous, [root]: saved.pinnedTabs }));
          setLoadedRoot(root);
          purgeLegacyRoot(root);
          return;
        }
        const favorites = vaultsRef.current[root] || [];
        const pinnedTabs = tabPinsRef.current[root] || [];
        const migrate =
          favorites.length || pinnedTabs.length
            ? window.api.writePins({ favorites, pinnedTabs })
            : Promise.resolve();
        migrate.then(
          () => {
            if (!cancelled) {
              setLoadedRoot(root);
              purgeLegacyRoot(root);
            }
          },
          (error) => !cancelled && reportSave(error)
        );
      })
      .catch((error) => {
        if (!cancelled) {
          reportSave(error);
          setLoadedRoot(root);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [root]);

  useEffect(() => {
    if (!root || loadedRoot !== root || !window.api?.writePins) {
      return;
    }
    window.api
      .writePins({ favorites: vaults[root] || [], pinnedTabs: tabPins[root] || [] })
      .catch(reportSave);
  }, [vaults, tabPins, root, loadedRoot]);

  const updateFavorites = useCallback(
    (change) => {
      if (!root) {
        return;
      }
      setVaults((previous) => ({ ...previous, [root]: change(previous[root] || []) }));
    },
    [root]
  );

  const updateTabPins = useCallback(
    (change) => {
      if (!root) {
        return;
      }
      setTabPins((previous) => ({ ...previous, [root]: change(previous[root] || []) }));
    },
    [root]
  );

  return {
    paths: vaults[root] || [],
    pinnedTabs: tabPins[root] || [],
    loaded: loadedRoot === root,
    toggle: (path) =>
      updateFavorites((paths) =>
        paths.includes(path) ? paths.filter((item) => item !== path) : [...paths, path]
      ),
    rename: (from, to) => {
      updateFavorites((paths) => renameFavorites(paths, from, to));
      updateTabPins((paths) => renameFavorites(paths, from, to));
    },
    remove: (path) => {
      updateFavorites((paths) => removeFavorites(paths, path));
      updateTabPins((paths) => removeFavorites(paths, path));
    },
    pinTab: useCallback(
      (path) => updateTabPins((paths) => (paths.includes(path) ? paths : [...paths, path])),
      [updateTabPins]
    ),
    unpinTab: useCallback(
      (path) => {
        const next = (tabPins[root] || []).filter((item) => item !== path);
        return next.length === (tabPins[root] || []).length ? (tabPins[root] || []) : next;
      },
      [root, tabPins]
    ),
  };
}
