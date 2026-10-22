import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildIndex, isMarkdown, rewriteLinks } from './vault.js';
import { folderPaths, normalizeFolders } from './folderPaths.js';

const api = window.api;
const SAVE_DELAY = 400;

export function useVault(underscoreFolders = true, autoRelink = true) {
  const [vault, setVault] = useState(null);
  const [tree, setTree] = useState([]);
  const [contents, setContents] = useState({});
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const timers = useRef({});
  const pending = useRef({});
  const writes = useRef(new Map());
  const watchers = useRef(new Set());
  const observed = useRef({ root: null, contents: {} });
  const contentsRef = useRef(contents);
  contentsRef.current = contents;
  const directories = folderPaths(tree);
  const normalize = (path, folder = false) => underscoreFolders ? normalizeFolders(path, folder, directories) : path;

  const report = (e) => setError(e?.message || String(e));

  const writeDisk = useCallback((path, text) => {
    const previous = writes.current.get(path) || Promise.resolve();
    const task = previous.catch(() => {}).then(() => api.write(path, text));
    writes.current.set(path, task);
    const cleanup = () => {
      if (writes.current.get(path) === task) writes.current.delete(path);
    };
    task.then(cleanup, cleanup);
    return task;
  }, []);

  useEffect(() => {
    const previous = observed.current;
    observed.current = { root: vault?.root, contents };
    const events = previous.root !== vault?.root ? [{ type: 'reset' }] :
      [...new Set([...Object.keys(previous.contents), ...Object.keys(contents)])]
        .filter((path) => previous.contents[path] !== contents[path])
        .map((path) => ({ type: contents[path] === undefined ? 'delete' :
          previous.contents[path] === undefined ? 'create' : 'change', path }));
    for (const event of events) {
      for (const listener of watchers.current) listener(event);
    }
  }, [vault?.root, contents]);

  const watch = useCallback((listener) => {
    watchers.current.add(listener);
    return () => watchers.current.delete(listener);
  }, []);

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
    api.getLastVault().then(open).catch(report).finally(() => setInitialized(true));
  }, [open]);

  const flush = useCallback(async () => {
    const inflight = Promise.allSettled([...writes.current.values()]);
    const entries = Object.entries(pending.current);
    pending.current = {};
    Object.values(timers.current).forEach(clearTimeout);
    timers.current = {};
    const saved = await Promise.all(entries.map(async ([p, c]) => {
      try { await writeDisk(p, c); return true; }
      catch (error) {
        if (pending.current[p] === undefined && contentsRef.current[p] === c) pending.current[p] = c;
        report(error);
        return false;
      }
    }));
    const completed = await inflight;
    return saved.every(Boolean) && completed.every((result) => result.status === 'fulfilled');
  }, [writeDisk]);

  useEffect(() => {
    const onUnload = () => {
      for (const [p, c] of Object.entries(pending.current)) api.write(p, c);
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  const updateContent = useCallback((path, text) => {
    contentsRef.current = { ...contentsRef.current, [path]: text };
    setContents((c) => ({ ...c, [path]: text }));
    pending.current[path] = text;
    clearTimeout(timers.current[path]);
    timers.current[path] = setTimeout(() => {
      const value = pending.current[path];
      delete pending.current[path];
      delete timers.current[path];
      if (value !== undefined) writeDisk(path, value).catch((error) => {
        if (pending.current[path] === undefined && contentsRef.current[path] === value) pending.current[path] = value;
        report(error);
      });
    }, SAVE_DELAY);
  }, [writeDisk]);

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
        const p = await api.mkdir(normalize(path, true), underscoreFolders);
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
    async (from, to) => {
      to = normalize(to, directories.includes(from));
      if (from === to) return to;
      if (!await flush()) return null;
      try {
        const all = contentsRef.current;
        const paths = Object.keys(all);
        await api.rename(from, to);
        const moved = paths.filter((p) => p === from || p.startsWith(from + '/'));
        for (const p of autoRelink ? paths.filter(isMarkdown) : []) {
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
    [flush, reload, underscoreFolders, tree, autoRelink],
  );

  const remove = useCallback(
    async (path) => {
      if (!await flush()) return false;
      try {
        await api.remove(path);
        await reload();
        return true;
      } catch (e) {
        report(e);
        return false;
      }
    },
    [flush, reload],
  );

  const chooseVault = useCallback(async () => {
    if (!await flush()) return;
    open(await api.chooseVault().catch(report));
  }, [flush, open]);

  const createSample = useCallback(async () => {
    if (!await flush()) return;
    open(await api.createSampleVault().catch(report));
  }, [flush, open]);
  const openFlowFile = useCallback(async (file) => {
    if (!await flush()) throw new Error('Could not save current edits. The flow file was not opened.');
    const result = await api.openFlowFile(file);
    await open(result.vault);
    return result;
  }, [flush, open]);

  const index = useMemo(() => buildIndex(contents), [contents]);

  return {
    vault,
    ready,
    initialized,
    openFlowFile,
    tree,
    contents,
    index,
    error,
    clearError: () => setError(null),
    reload,
    updateContent,
    getContent: (path) => contentsRef.current[path],
    flush,
    watch,
    createFile,
    createFolder,
    rename,
    remove,
    chooseVault,
    createSample,
    reveal: (p) => api.reveal(p),
  };
}
