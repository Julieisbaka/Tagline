import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildIndex, isMarkdown, rewriteLinks } from './vault.js';
import { folderPaths, normalizeFolders } from './folderPaths.js';

const api = window.api;
const SAVE_DELAY = 400;

export function useVault(underscoreFolders = true) {
  const [vault, setVault] = useState(null);
  const [tree, setTree] = useState([]);
  const [contents, setContents] = useState({});
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const timers = useRef({});
  const pending = useRef({});
  const contentsRef = useRef(contents);
  contentsRef.current = contents;
  const directories = folderPaths(tree);
  const normalize = (path, folder = false) => underscoreFolders ? normalizeFolders(path, folder, directories) : path;

  const report = (e) => setError(e?.message || String(e));

  const reload = useCallback(async () => {
    try {
      const [t, all] = await Promise.all([api.list(), api.readAll()]);
      setTree(t);
      // Keep edits that haven't been flushed to disk yet.
      const next = { ...all, ...pending.current };
      contentsRef.current = next;
      setContents(next);
      setReady(true);
    } catch (e) {
      report(e);
    }
  }, []);

  const open = useCallback(
    async (info) => {
      if (!info) return;
      setReady(false);
      setTree([]);
      setContents({});
      setVault(info);
      await reload();
    },
    [reload],
  );

  useEffect(() => {
    api.getLastVault().then(open).catch(report);
  }, [open]);

  const flush = useCallback(async () => {
    const entries = Object.entries(pending.current);
    pending.current = {};
    Object.values(timers.current).forEach(clearTimeout);
    timers.current = {};
    await Promise.all(entries.map(([p, c]) => api.write(p, c).catch(report)));
  }, []);

  useEffect(() => {
    const onUnload = () => {
      for (const [p, c] of Object.entries(pending.current)) api.write(p, c);
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  const updateContent = useCallback((path, text) => {
    setContents((c) => ({ ...c, [path]: text }));
    pending.current[path] = text;
    clearTimeout(timers.current[path]);
    timers.current[path] = setTimeout(() => {
      const value = pending.current[path];
      delete pending.current[path];
      delete timers.current[path];
      if (value !== undefined) api.write(path, value).catch(report);
    }, SAVE_DELAY);
  }, []);

  const createFile = useCallback(
    async (path, content = '') => {
      try {
        const finalPath = await api.create(normalize(path), content);
        await reload();
        return finalPath;
      } catch (e) {
        report(e);
        return null;
      }
    },
    [reload, underscoreFolders, tree],
  );

  const createFolder = useCallback(
    async (path) => {
      try {
        const p = await api.mkdir(normalize(path, true));
        await reload();
        return p;
      } catch (e) {
        report(e);
        return null;
      }
    },
    [reload, underscoreFolders, tree],
  );

  // Renames a file or folder and rewrites [[links]] to renamed markdown files.
  const rename = useCallback(
    async (from, to, exact = false) => {
      if (!exact) to = normalize(to, directories.includes(from));
      if (from === to) return to;
      await flush();
      try {
        const all = contentsRef.current;
        const paths = Object.keys(all);
        await api.rename(from, to);
        const moved = paths.filter((p) => p === from || p.startsWith(from + '/'));
        for (const p of paths.filter(isMarkdown)) {
          let updated = all[p];
          for (const oldPath of moved.filter(isMarkdown)) {
            updated = rewriteLinks(updated, oldPath, to + oldPath.slice(from.length), paths);
          }
          const destination = moved.includes(p) ? to + p.slice(from.length) : p;
          if (updated !== all[p]) await api.write(destination, updated);
        }
        await reload();
        return to;
      } catch (e) {
        report(e);
        return null;
      }
    },
    [flush, reload, underscoreFolders, tree],
  );

  const remove = useCallback(
    async (path) => {
      delete pending.current[path];
      try {
        await api.remove(path);
        await reload();
        return true;
      } catch (e) {
        report(e);
        return false;
      }
    },
    [reload],
  );

  const chooseVault = useCallback(async () => {
    await flush();
    open(await api.chooseVault().catch(report));
  }, [flush, open]);

  const createSample = useCallback(async () => {
    await flush();
    open(await api.createSampleVault().catch(report));
  }, [flush, open]);

  const index = useMemo(() => buildIndex(contents), [contents]);

  return {
    vault,
    ready,
    tree,
    contents,
    index,
    error,
    clearError: () => setError(null),
    reload,
    updateContent,
    createFile,
    createFolder,
    rename,
    remove,
    chooseVault,
    createSample,
    reveal: (p) => api.reveal(p),
  };
}
