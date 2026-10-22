import { useEffect, useRef } from 'react';
import { useExtensions } from './extensions.js';
import { applicationEvents, requireSelection } from './extensionCapabilities.js';
import { EditorSelection } from '@codemirror/state';

export function useAppExtensions({
  v, paths, activePath, activeContent, mode, sourceFallback, editorRef, visualRef,
  insertAtCursor, doRename, tabs, notify, visualEditor,
}) {
  const operations = useRef(Promise.resolve());
  const bridgeRef = useRef(null);
  const activeNoteListeners = useRef(new Set());
  const activeNotePath = activeContent === undefined ? null : activePath;

  useEffect(() => {
    activeNoteListeners.current.forEach((listener) => listener({ path: activeNotePath }));
    applicationEvents.emit('note.changed', { path: activeNotePath });
  }, [activeNotePath, v.vault?.root]);
  useEffect(() => {
    applicationEvents.emit('vault.changed', { open: !!v.vault });
  }, [v.vault?.root]);
  useEffect(() => v.watch((event) => applicationEvents.emit('vault.fileChanged', event)), [v.watch]);
  useEffect(() => {
    applicationEvents.emit('editor.updated', { path: activeNotePath, mode });
  }, [activeNotePath, activeContent, mode]);
  useEffect(() => {
    if (!visualEditor || visualEditor.isDestroyed || mode !== 'visual' || sourceFallback) return;
    const selection = () => applicationEvents.emit('editor.selectionChanged', {
      path: activeNotePath, mode: 'visual',
      selection: { from: visualEditor.state.selection.from, to: visualEditor.state.selection.to },
    });
    visualEditor.on('selectionUpdate', selection);
    applicationEvents.emit('editor.ready', { path: activeNotePath, mode: 'visual' });
    return () => visualEditor.off('selectionUpdate', selection);
  }, [visualEditor, mode, sourceFallback, activeNotePath]);

  const requireVisualEditor = () => {
    if (!activePath || !/\.md$/i.test(activePath) || mode !== 'visual' || sourceFallback ||
      !visualRef.current || visualRef.current.isDestroyed) throw new Error('Open a Markdown note in the visual editor first.');
    return visualRef.current;
  };

  const enqueueVault = (operation) => {
    const root = v.vault?.root;
    const task = operations.current.then(() => {
      if (!root || bridgeRef.current.root !== root) throw new Error('The active vault changed. Retry the operation.');
      return operation();
    });
    operations.current = task.catch(() => { });
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
    setSelection: (value) => {
      const { from, to } = requireSelection(value);
      if (!activePath || !/\.md$/i.test(activePath) || mode === 'read') throw new Error('Open a Markdown note in an editing mode first.');
      if (mode === 'visual' && !sourceFallback) {
        const editor = requireVisualEditor();
        if (from < 1 || to > editor.state.doc.content.size) throw new Error('Selection is outside the Tiptap document.');
        if (!editor.chain().setTextSelection({ from, to }).focus().run()) throw new Error('Could not set the editor selection.');
      } else {
        const view = editorRef.current;
        if (!view) throw new Error('The editor is not ready.');
        if (to > view.state.doc.length) throw new Error('Selection is outside the source document.');
        view.dispatch({ selection: EditorSelection.range(from, to), scrollIntoView: true });
        view.focus();
      }
      return true;
    },
    getTiptapSnapshot: () => {
      const editor = requireVisualEditor();
      const { from, to } = editor.state.selection;
      return {
        path: activePath, doc: editor.getJSON(), text: editor.getText(), selection: { from, to },
        size: editor.state.doc.content.size
      };
    },
    runTiptapCommand: (command, options) => {
      const editor = requireVisualEditor();
      const chain = editor.chain().focus();
      const success = options === undefined ? chain[command]().run() : chain[command](options).run();
      if (!success) throw new Error(`Tiptap command could not run: ${command}`);
      return true;
    },
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
