import { useCallback, useEffect, useRef, useState } from 'react';

let nextId = 1;
/** Generate a unique tab identifier for the current renderer session. @returns {string} */
const newId = () => `t${Date.now()}-${nextId++}`;

/**
 * Validate and normalize a saved tab snapshot.
 * @param {*} saved - Parsed local storage data.
 * @returns {{tabs: Array, activeId: string|null, warning: string|null}}
 */
export function restoreTabs(saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved) || !Array.isArray(saved.tabs)) {
    throw new Error('Saved tabs must be an object containing a tab list.');
  }
  if (saved.activeId != null && typeof saved.activeId !== 'string') {
    throw new Error('Saved active tab ID is invalid.');
  }
  const ids = new Set();
  const paths = new Set();
  let graphCount = 0;
  const tabs = saved.tabs.map((tab) => {
    if (!tab || typeof tab !== 'object' || Array.isArray(tab) ||
      typeof tab.id !== 'string' || !tab.id || ids.has(tab.id)) {
      throw new Error('Saved tab IDs must be unique non-empty strings.');
    }
    ids.add(tab.id);
    if (tab.kind === 'graph') {
      if (++graphCount > 1) throw new Error('Only one graph tab can be restored.');
      return { id: tab.id, kind: 'graph' };
    }
    if (tab.kind !== 'file' || typeof tab.path !== 'string' || !tab.path.trim() ||
      /^[\\/]|^[a-z]:/i.test(tab.path) || tab.path.split(/[\\/]/).includes('..') || paths.has(tab.path)) {
      throw new Error('Saved file tabs must have unique vault-relative paths.');
    }
    paths.add(tab.path);
    return { id: tab.id, kind: 'file', path: tab.path };
  });
  const hasSavedActive = typeof saved.activeId === 'string' && tabs.some((tab) => tab.id === saved.activeId);
  const activeId = hasSavedActive ? saved.activeId : tabs[0]?.id || null;
  return {
    tabs,
    activeId,
    warning: saved.activeId != null && !hasSavedActive
      ? 'The saved active tab was unavailable; the first open tab was selected.' : null,
  };
}

/**
 * Move a tab to an index without mutating the input list.
 * @param {Array} tabs - Current ordered tabs.
 * @param {string} id - ID of the tab to move.
 * @param {number} targetIndex - Destination index.
 * @returns {Array} Reordered tabs, or the original list when the ID or index is invalid.
 */
export function reorderTabs(tabs, id, targetIndex) {
  const sourceIndex = tabs.findIndex((tab) => tab.id === id);
  if (!Number.isInteger(targetIndex) || sourceIndex < 0) return tabs;
  const next = [...tabs];
  const [moved] = next.splice(sourceIndex, 1);
  const destination = Math.max(0, Math.min(targetIndex, next.length));
  if (sourceIndex === destination) return tabs;
  next.splice(destination, 0, moved);
  return next;
}

// Workspace tabs, persisted per vault.
/** 
 * React hook for open-tab state, persistence, and vault-backed tab operations.
 * @param {string} vaultRoot - The root path of the vault to associate tabs with.
 * @param {boolean} [persist=true] - Whether to persist tabs in localStorage.
 * @returns {object} - An object containing the current tabs, active tab, and tab management functions.
 */
export function useTabs(vaultRoot, persist = true) {
  const storageKey = vaultRoot ? `tabs:${vaultRoot}` : null;
  const loadKey = `${storageKey}:${persist}`;
  const previousVault = useRef(null);
  const [tabs, setTabs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loadedKey, setLoadedKey] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!persist || !storageKey) {
      if (previousVault.current !== storageKey) {
        setTabs([]);
        setActiveId(null);
      }
      previousVault.current = storageKey;
      setLoadedKey(loadKey);
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved) {
        const restored = restoreTabs(saved);
        setTabs(restored.tabs);
        setActiveId(restored.activeId);
        if (restored.warning) setError(restored.warning);
      } else if (previousVault.current !== storageKey) {
        setTabs([]);
        setActiveId(null);
      }
    } catch (failure) {
      setTabs([]);
      setActiveId(null);
      setError(`Could not restore workspace tabs: ${failure.message}`);
    }
    previousVault.current = storageKey;
    setLoadedKey(loadKey);
  }, [storageKey, persist, loadKey]);

  useEffect(() => {
    if (persist && storageKey && loadedKey === loadKey) {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ tabs, activeId }));
      } catch (failure) {
        setError(`Could not save workspace tabs: ${failure.message}`);
      }
    }
  }, [tabs, activeId, storageKey, loadedKey, loadKey, persist]);

  useEffect(() => {
    if (activeId && !tabs.some((tab) => tab.id === activeId)) setActiveId(tabs[0]?.id || null);
  }, [tabs, activeId]);

  const activeTab = tabs.find((t) => t.id === activeId) || null;

  const openPath = useCallback(
    (path, newTab = false) => {
      const existing = tabs.find((t) => t.path === path);
      if (existing) return setActiveId(existing.id);
      const current = tabs.find((t) => t.id === activeId);
      if (!newTab && current && current.kind === 'file') {
        setTabs(tabs.map((t) => (t.id === current.id ? { ...t, path } : t)));
        return undefined;
      }
      const tab = { id: newId(), kind: 'file', path };
      setTabs([...tabs, tab]);
      setActiveId(tab.id);
      return undefined;
    },
    [tabs, activeId],
  );

  const openGraph = useCallback(() => {
    const existing = tabs.find((t) => t.kind === 'graph');
    if (existing) return setActiveId(existing.id);
    const tab = { id: newId(), kind: 'graph' };
    setTabs([...tabs, tab]);
    setActiveId(tab.id);
    return undefined;
  }, [tabs]);

  const close = useCallback(
    (id) => {
      const i = tabs.findIndex((t) => t.id === id);
      const next = tabs.filter((t) => t.id !== id);
      setTabs(next);
      if (id === activeId) setActiveId(next[Math.min(i, next.length - 1)]?.id || null);
    },
    [tabs, activeId],
  );

  const renamePath = useCallback((from, to) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.path && (t.path === from || t.path.startsWith(from + '/')) ? { ...t, path: to + t.path.slice(from.length) } : t,
      ),
    );
  }, []);

  const removePath = useCallback((path) => {
    setTabs((prev) => prev.filter((t) => !(t.path && (t.path === path || t.path.startsWith(path + '/')))));
  }, []);

  // Drop tabs whose files vanished (e.g. deleted outside the app).
  const prune = useCallback((existing) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.kind !== 'file' || existing.has(t.path));
      return next.length === prev.length ? prev : next;
    });
  }, []);

  /** 
   * Keep the selected tab open and close all other tabs.
   * @param {string} id - The ID of the tab to keep open.
   * @returns {void}
   */
  const closeOthers = (id) => {
    setTabs((prev) => prev.filter((t) => t.id === id));
    setActiveId(id);
  };
  const reorder = useCallback((id, targetIndex) => {
    setTabs((previous) => reorderTabs(previous, id, targetIndex));
  }, []);
  const clearError = useCallback(() => setError(null), []);
  return {
    tabs, activeTab, activeId, setActiveId, openPath, openGraph, close, closeOthers,
    renamePath, removePath, prune, reorder, error, clearError,
  };
}
