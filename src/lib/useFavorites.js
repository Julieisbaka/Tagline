import { useCallback, useEffect, useRef, useState } from 'react';
import { translate } from './i18n.js';
import { readStoredJson } from './storedJson.js';

const STORAGE_KEY = 'tagline-favorites';

const PIN_ERROR_KEYS = {
  load: 'Could not load pinned items: {error}',
  save: 'Could not save pinned items: {error}',
};

/**
 * Build the toast text for a pin failure, keeping read and write failures distinct.
 * @param {'load'|'save'} kind
 * @param {unknown} error
 * @returns {string}
 */
export function pinErrorDetail(kind, error) {
  const key = PIN_ERROR_KEYS[kind] || PIN_ERROR_KEYS.save;
  return translate(key, { error: error?.message || String(error || '') });
}

/**
 * Interpret the value returned by the pins reader.
 * @param {*} saved
 * @returns {{favorites: string[]|null, pinnedTabs: string[]|null, corrupted: boolean}}
 */
export function parsePinsResult(saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
    return { favorites: null, pinnedTabs: null, corrupted: false };
  }
  if (saved.corrupted === true) {
    return { favorites: [], pinnedTabs: [], corrupted: true };
  }
  return {
    favorites: Array.isArray(saved.favorites) ? saved.favorites : null,
    pinnedTabs: Array.isArray(saved.pinnedTabs) ? saved.pinnedTabs : null,
    corrupted: false,
  };
}

export function renameFavorites(paths, from, to) {
  return paths.map((path) =>
    path === from || path.startsWith(from + '/') ? to + path.slice(from.length) : path
  );
}

export function removeFavorites(paths, removed) {
  return paths.filter((path) => path !== removed && !path.startsWith(removed + '/'));
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
  const [pinStatus, setPinStatus] = useState(null);
  const lastError = useRef('');
  const vaultsRef = useRef(vaults);
  vaultsRef.current = vaults;
  const tabPinsRef = useRef(tabPins);
  tabPinsRef.current = tabPins;

  // Report a pin failure once per distinct message and keep it visible as a status.
  const reportPinError = useCallback((level, message) => {
    if (lastError.current === message) {
      return;
    }
    lastError.current = message;
    setPinStatus({ level, message });
    window.dispatchEvent(new CustomEvent('app-error', { detail: message }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    lastError.current = '';
    setPinStatus(null);
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
        const result = parsePinsResult(saved);
        if (result.favorites) {
          setVaults((previous) => ({ ...previous, [root]: result.favorites }));
          setTabPins((previous) => ({ ...previous, [root]: result.pinnedTabs }));
          setLoadedRoot(root);
          purgeLegacyRoot(root);
          if (result.corrupted) {
            reportPinError('warning', translate('Pinned items could not be read and were reset'));
          }
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
          (error) => !cancelled && reportPinError('warning', pinErrorDetail('save', error))
        );
      })
      .catch((error) => {
        if (!cancelled) {
          // Keep the file untouched: writing here would overwrite pins we could not read.
          reportPinError('error', pinErrorDetail('load', error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [root, reportPinError]);

  useEffect(() => {
    if (!root || loadedRoot !== root || !window.api?.writePins) {
      return;
    }
    window.api
      .writePins({ favorites: vaults[root] || [], pinnedTabs: tabPins[root] || [] })
      .then(() => {
        setPinStatus((previous) => (previous?.level === 'save' ? null : previous));
        lastError.current = '';
      })
      .catch((error) => reportPinError('warning', pinErrorDetail('save', error)));
  }, [vaults, tabPins, root, loadedRoot, reportPinError]);

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
    pinStatus,
    pinsAvailable: !pinStatus || pinStatus.level !== 'error',
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
      (path) => updateTabPins((paths) => paths.filter((item) => item !== path)),
      [updateTabPins]
    ),
    toggleTabPin: useCallback(
      (path) =>
        updateTabPins((paths) =>
          paths.includes(path) ? paths.filter((item) => item !== path) : [...paths, path]
        ),
      [updateTabPins]
    ),
  };
}
