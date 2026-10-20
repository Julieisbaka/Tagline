import { useCallback, useEffect, useState } from 'react';

let nextId = 1;
const newId = () => `t${Date.now()}-${nextId++}`;

// Workspace tabs, persisted per vault.
export function useTabs(vaultRoot) {
  const storageKey = vaultRoot ? `tabs:${vaultRoot}` : null;
  const [tabs, setTabs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loadedKey, setLoadedKey] = useState(null);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      setTabs(saved?.tabs || []);
      setActiveId(saved?.activeId || null);
    } catch {
      setTabs([]);
      setActiveId(null);
    }
    setLoadedKey(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (storageKey && loadedKey === storageKey) {
      localStorage.setItem(storageKey, JSON.stringify({ tabs, activeId }));
    }
  }, [tabs, activeId, storageKey, loadedKey]);

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

  const closeOthers = (id) => {
    setTabs((prev) => prev.filter((t) => t.id === id));
    setActiveId(id);
  };
  return { tabs, activeTab, activeId, setActiveId, openPath, openGraph, close, closeOthers, renamePath, removePath, prune };
}
