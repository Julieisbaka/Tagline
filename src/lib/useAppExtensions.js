import { useEffect, useRef } from 'react';
import { useExtensions } from './extensions.js';

export function useAppExtensions({
  v, paths, activePath, activeContent, mode, sourceFallback, editorRef, visualRef,
  insertAtCursor, doRename, tabs, notify,
}) {
  const operations = useRef(Promise.resolve());
  const bridgeRef = useRef(null);
  const activeNoteListeners = useRef(new Set());
  const activeNotePath = activeContent === undefined ? null : activePath;

  useEffect(() => {
    activeNoteListeners.current.forEach((listener) => listener({ path: activeNotePath }));
  }, [activeNotePath, v.vault?.root]);

  const enqueueVault = (operation) => {
    const root = v.vault?.root;
    const task = operations.current.then(() => {
      if (!root || bridgeRef.current.root !== root) throw new Error('The active vault changed. Retry the operation.');
      return operation();
    });
    operations.current = task.catch(() => {});
    return task;
  };
  const requireNote = (path) => {
    if (!/\.(md|flow)$/i.test(path)) throw new Error('Extensions can only modify .md and .flow files.');
    const content = v.getContent(path);
    if (content === undefined) throw new Error(`Note not found: ${path}`);
    return content;
  };

  bridgeRef.current = {
    root: v.vault?.root,
    getActiveNote: () => {
      if (!activePath || activeContent === undefined) return null;
      let selection = '';
      if (mode === 'visual' && !sourceFallback && visualRef.current) {
        const { from, to } = visualRef.current.state.selection;
        selection = visualRef.current.state.doc.textBetween(from, to, '\n');
      } else if (mode !== 'read' && editorRef.current) {
        const { from, to } = editorRef.current.state.selection.main;
        selection = editorRef.current.state.sliceDoc(from, to);
      }
      return { path: activePath, content: activeContent ?? '', selection, mode };
    },
    insertText: (text) => insertAtCursor(text),
    list: () => paths,
    read: (path) => {
      const content = v.getContent(path);
      if (content === undefined) throw new Error(`Note not found: ${path}`);
      return content;
    },
    write: (path, content) => enqueueVault(async () => {
      if (!/\.(md|flow)$/i.test(path)) throw new Error('Extensions can only write .md and .flow files.');
      if (v.getContent(path) !== undefined) { v.updateContent(path, content); return path; }
      const created = await v.createFile(path, content);
      if (!created) throw new Error(`Could not create ${path}.`);
      return created;
    }),
    append: (path, text) => enqueueVault(() => {
      const content = requireNote(path) + text;
      if (content.length > 5_000_000) throw new Error('Content must be text up to 5000000 characters.');
      v.updateContent(path, content);
      return path;
    }),
    compareAndSwap: (path, expected, content) => enqueueVault(() => {
      if (requireNote(path) !== expected) return false;
      v.updateContent(path, content);
      return true;
    }),
    delete: (path) => enqueueVault(async () => {
      requireNote(path);
      if (!await v.remove(path)) throw new Error(`Could not delete ${path}.`);
      tabs.removePath(path);
      return true;
    }),
    rename: (from, to) => enqueueVault(async () => {
      requireNote(from);
      if (!/\.(md|flow)$/i.test(to)) throw new Error('Extensions can only rename to .md and .flow paths.');
      const result = await doRename(from, to);
      if (!result) throw new Error(`Could not rename ${from}.`);
      return result;
    }),
    flush: () => enqueueVault(async () => {
      if (!await v.flush()) throw new Error('Could not save pending vault edits.');
      return true;
    }),
    watch: v.watch,
    watchActiveNote: (listener) => {
      activeNoteListeners.current.add(listener);
      return () => activeNoteListeners.current.delete(listener);
    },
  };
  return useExtensions({ bridgeRef, notify });
}
