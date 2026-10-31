import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { folderPaths, normalizeFolders } from './folderPaths.js';
import { translate } from './i18n.js';
import { buildIndex, isMarkdown, rewriteLinks } from './vault.js';

const api = window.api;
const SAVE_DELAY = 400;

/** 
 * React hook that loads a vault and provides indexed, persisted vault operations.
 * @param {boolean} [underscoreFolders] - Indicates whether folder names should be prefixed with underscores.
 * @param {boolean} [autoRelink] - Enables automatic relinking of references within the vault.
 * @param {number} [historyRetention] - The number of historical versions to retain for each file.
 * @param {string} [canvasHistoryMode] - The mode for handling canvas history, e.g., 'complete'.
 * @param {boolean} [experimentalHistoryDeltas] - Enables experimental handling of history deltas.
 * @returns {object} - An object containing the vault state, tree structure, contents, error state, readiness, initialization status, save statuses, and various vault operations.
 */
export function useVault(underscoreFolders = true, autoRelink = true, historyRetention = 50, canvasHistoryMode = 'complete', experimentalHistoryDeltas = false) {
  const [vault, setVault] = useState(null);
  const [tree, setTree] = useState([]);
  const [contents, setContents] = useState({});
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [saveStatuses, setSaveStatuses] = useState({});
  const timers = useRef({});
  const pending = useRef({});
  const writes = useRef(new Map());
  const watchers = useRef(new Set());
  const observed = useRef({ root: null, contents: {} });
  const contentsRef = useRef(contents);
  contentsRef.current = contents;
  const historyRetentionRef = useRef(historyRetention);
  historyRetentionRef.current = historyRetention;
  const canvasHistoryModeRef = useRef(canvasHistoryMode);
  canvasHistoryModeRef.current = canvasHistoryMode;
  const experimentalHistoryDeltasRef = useRef(experimentalHistoryDeltas);
  experimentalHistoryDeltasRef.current = experimentalHistoryDeltas;
  const directories = folderPaths(tree);

  /** 
   * Normalize a new vault path according to the folder underscore preference.
   * @param {string} path - The vault path to normalize.
   * @param {boolean} [folder=false] - Indicates whether the path represents a folder.
   * @returns {string} - The normalized vault path.
   */
  const normalize = (path, folder = false) => underscoreFolders ? normalizeFolders(path, folder, directories) : path;

  /** 
   * Store a vault operation error in hook state.
   * @param {*} error - The error object or message to report.
   * @returns {void} 
   */
  const report = (e) => setError(e?.message || String(e));

  const setSaveStatus = useCallback((path, status) => setSaveStatuses((previous) => {
    if (!status) {
      if (!(path in previous)) return previous;
      const next = { ...previous };
      delete next[path];
      return next;
    }
    return previous[path] === status ? previous : { ...previous, [path]: status };
  }), []);

  const writeDisk = useCallback((path, text) => {
    const previous = writes.current.get(path)?.task || Promise.resolve();
    const task = previous.catch(() => { }).then(() =>
      api.write(path, text, historyRetentionRef.current, canvasHistoryModeRef.current, experimentalHistoryDeltasRef.current));
    writes.current.set(path, { task, text });
    /** 
     * Remove this completed write only if no newer write replaced it.
     * @param {boolean} [failed=false] - Indicates whether the write operation failed.
     * @returns {void} 
     */
    const cleanup = (failed = false) => {
      if (writes.current.get(path)?.task !== task) return;
      writes.current.delete(path);
      if (failed) {
        if (pending.current[path] === undefined && contentsRef.current[path] === text) {
          setSaveStatus(path, 'error');
        }
      } else if (pending.current[path] === undefined && contentsRef.current[path] === text) {
        setSaveStatus(path, null);
      }
    };
    task.then(() => cleanup(), () => cleanup(true));
    return task;
  }, [setSaveStatus]);

  useEffect(() => {
    const previous = observed.current;
    observed.current = { root: vault?.root, contents };
    const events = previous.root !== vault?.root ? [{ type: 'reset' }] :
      [...new Set([...Object.keys(previous.contents), ...Object.keys(contents)])]
        .filter((path) => previous.contents[path] !== contents[path])
        .map((path) => ({
          type: contents[path] === undefined ? 'delete' :
            previous.contents[path] === undefined ? 'create' : 'change', path
        }));
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
      const { tree, contents: all } = await api.readSnapshot();
      setTree(tree);
      // Keep edits that haven't been flushed to disk yet.
      const saving = Object.fromEntries([...writes.current].map(([path, entry]) => [path, entry.text]));
      const next = { ...all, ...saving, ...pending.current };
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
      setSaveStatuses({});
      setVault(info);
      await reload();
    },
    [reload],
  );

  useEffect(() => {
    api.getLastVault().then(open).catch(report).finally(() => setInitialized(true));
  }, [open]);

  const flush = useCallback(async () => {
    const inflight = Promise.allSettled([...writes.current.values()].map((entry) => entry.task));
    const entries = Object.entries(pending.current);
    pending.current = {};
    Object.values(timers.current).forEach(clearTimeout);
    timers.current = {};
    const saved = await Promise.all(entries.map(async ([p, c]) => {
      try {
        setSaveStatus(p, 'saving');
        await writeDisk(p, c);
        return true;
      }
      catch (error) {
        if (pending.current[p] === undefined && contentsRef.current[p] === c) pending.current[p] = c;
        report(error);
        return false;
      }
    }));
    const completed = await inflight;
    return saved.every(Boolean) && completed.every((result) => result.status === 'fulfilled');
  }, [writeDisk, setSaveStatus]);

  useEffect(() => {
    /** 
     * Prevent closing the window until pending edits have been flushed.
     * @param {BeforeUnloadEvent} event - The beforeunload event triggered by the browser.
     * @returns {void} 
     */
    const onUnload = (event) => {
      if (!Object.keys(pending.current).length && !writes.current.size) return;
      event.preventDefault();
      event.returnValue = false;
      flush().then((saved) => {
        if (saved) window.dispatchEvent(new CustomEvent('app-error', {
          detail: 'Pending edits have been saved. Retry closing or reloading.',
        }));
      }).catch(report);
    };
    const unsubscribe = api.onPrepareClose(async () => {
      try {
        let saved;
        do { saved = await flush(); }
        while (saved && (Object.keys(pending.current).length || writes.current.size));
        api.closeReady(saved);
      }
      catch (error) { report(error); api.closeReady(false); }
    });
    window.addEventListener('beforeunload', onUnload);
    return () => { unsubscribe(); window.removeEventListener('beforeunload', onUnload); };
  }, [flush]);

  const updateContent = useCallback((path, text) => {
    contentsRef.current = { ...contentsRef.current, [path]: text };
    setContents((c) => ({ ...c, [path]: text }));
    pending.current[path] = text;
    setSaveStatus(path, 'unsaved');
    clearTimeout(timers.current[path]);
    timers.current[path] = setTimeout(() => {
      const value = pending.current[path];
      delete pending.current[path];
      delete timers.current[path];
      if (value !== undefined) {
        setSaveStatus(path, 'saving');
        writeDisk(path, value).catch((error) => {
          if (pending.current[path] === undefined && contentsRef.current[path] === value) {
            pending.current[path] = value;
            setSaveStatus(path, 'error');
          }
          report(error);
        });
      }
    }, SAVE_DELAY);
  }, [writeDisk, setSaveStatus]);

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
        const result = await api.rename(from, to);
        if (result?.ok === false && result.code === 'destination-exists') {
          report(new Error(translate('A file or folder with that name already exists. Choose a different name.')));
          return null;
        }
        if (result?.ok !== true || typeof result.path !== 'string') {
          throw new Error('The rename operation returned an invalid result.');
        }
        to = result.path;
        const moved = paths.filter((p) => p === from || p.startsWith(from + '/'));
        for (const p of autoRelink ? paths.filter(isMarkdown) : []) {
          let updated = all[p];
          for (const oldPath of moved.filter(isMarkdown)) {
            updated = rewriteLinks(updated, oldPath, to + oldPath.slice(from.length), paths);
          }
          const destination = moved.includes(p) ? to + p.slice(from.length) : p;
          if (updated !== all[p]) await api.write(destination, updated, historyRetentionRef.current, canvasHistoryModeRef.current, experimentalHistoryDeltasRef.current);
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
    if (!await flush()) return false;
    const info = await api.chooseVault().catch((error) => { report(error); return null; });
    if (!info) return false;
    await open(info);
    return true;
  }, [flush, open]);

  const createSample = useCallback(async () => {
    if (!await flush()) return false;
    const info = await api.createSampleVault().catch((error) => { report(error); return null; });
    if (!info) return false;
    await open(info);
    return true;
  }, [flush, open]);
  const openRecentVault = useCallback(async (root) => {
    if (!await flush()) return false;
    const info = await api.openRecentVault(root).catch((error) => { report(error); return null; });
    if (!info) return false;
    await open(info);
    return true;
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
    saveStatuses,
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
    openRecentVault,
    createSample,
    reveal: (p) => api.reveal(p),
  };
}
