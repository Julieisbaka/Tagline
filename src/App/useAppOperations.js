import { useCallback } from 'react';
import { createFlow } from '../../electron/flow.mjs';
import { renameTarget, sanitizeName } from '../components/layout/Sidebar.jsx';
import { EMPTY_CANVAS } from '../lib/canvas.js';
import { defaultEditorMode } from '../lib/editorModes.js';
import { markSpeechDocument } from '../lib/frontmatter.js';
import { slugify } from '../lib/markdown.js';
import { useAppExtensions } from '../lib/useAppExtensions.js';
import { baseName, dirName, isMarkdown, joinPath, outline, resolveLink } from '../lib/vault.js';

export function useAppOperations({
  settings,
  updateSettings,
  v,
  tabs,
  favorites,
  activePath,
  activeContent,
  mode,
  sourceFallback,
  editorRef,
  visualRef,
  visualEditor,
  paths,
  setModes,
  setModal,
  setWebsite,
  setJump,
  notify,
  confirm,
  t,
}) {
  const setMode = (m) => activePath && setModes((s) => ({ ...s, [activePath]: m }));

  const open = useCallback(
    (path, newTab = false, line = null) => {
      setWebsite(null);
      tabs.openPath(path, newTab);
      if (line != null) {
        setModes((s) => ({ ...s, [path]: 'edit' }));
        setJump({ path, line, n: Date.now() });
      }
    },
    [tabs, setWebsite, setModes, setJump]
  );

  const openLink = useCallback(
    async (target, heading, newTab) => {
      let path = resolveLink(target, paths);
      if (!path) {
        path = await v.createFile(
          `${target.replace(/\.md$/i, '')}.md`,
          `# ${baseName(target)}\n\n`
        );
        if (!path) {
          return;
        }
        notify(t('Created “{name}”', { name: baseName(path) }));
      }
      tabs.openPath(path, newTab);
      if (heading) {
        const h = outline(v.contents[path] || '').find((x) => slugify(x.text) === slugify(heading));
        setJump({ path, heading, line: h?.line ?? null, n: Date.now() });
      }
    },
    [paths, v, tabs, notify, t, setJump]
  );

  const prompt = (title, initial, onSubmit) =>
    setModal({ type: 'prompt', title, initial, onSubmit });

  const ensureSpeechDoc = useCallback(
    async (path) => {
      if (!path || !isMarkdown(path)) {
        throw new Error(t('Speech documents must be Markdown files.'));
      }
      let result = path;
      if (v.contents[path] !== undefined) {
        const content = markSpeechDocument(v.contents[path]);
        if (content !== v.contents[path]) {
          v.updateContent(path, content);
          if (!(await v.flush())) {
            return null;
          }
        }
      } else {
        result = await v.createFile(path, markSpeechDocument('# Speech Document\n\n'));
        if (!result) {
          return null;
        }
      }
      updateSettings({ speechDoc: result });
      return result;
    },
    [v, updateSettings, t]
  );

  const doRename = async (from, to) => {
    const result = await v.rename(from, to);
    if (!result) {
      return;
    }
    tabs.renamePath(from, result);
    favorites.rename(from, result);
    if (settings.speechDoc === from || settings.speechDoc.startsWith(from + '/')) {
      updateSettings({ speechDoc: result + settings.speechDoc.slice(from.length) });
    }
    return result;
  };

  const insertAtCursor = async (
    text,
    message = 'Open a note in an editing mode to insert text.'
  ) => {
    if (!activePath || !isMarkdown(activePath) || mode === 'read') {
      throw new Error(t(message));
    }
    if (mode === 'visual' && !sourceFallback && visualRef.current) {
      visualRef.current.chain().focus().insertContent(text, { contentType: 'markdown' }).run();
    } else if (editorRef.current) {
      const view = editorRef.current;
      view.dispatch(view.state.replaceSelection(text));
      view.focus();
    } else {
      throw new Error(t('The editor is not ready.'));
    }
  };
  const insertCitation = (text) =>
    insertAtCursor(text + '\n\n', 'Open a note in an editing mode to insert a citation.');

  const ext = useAppExtensions({
    v,
    paths,
    activePath,
    activeContent,
    mode,
    sourceFallback,
    editorRef,
    visualRef,
    insertAtCursor,
    doRename,
    tabs,
    notify,
    visualEditor,
  });

  const createAndOpen = async (path, content) => {
    const p = await v.createFile(path, content);
    if (p) {
      tabs.openPath(p, false);
      setModes((s) => ({ ...s, [p]: defaultEditorMode(settings, p) }));
    }
    return p;
  };

  const actions = {
    open,
    reload: v.reload,
    reveal: v.reveal,
    copyNotePath: async (path) => {
      try {
        await navigator.clipboard.writeText(path);
        notify(t('Copied note path'));
      } catch (error) {
        notify(t('Could not copy note path: {error}', { error: error.message }));
      }
    },
    copyNoteLink: async (path) => {
      const encoded = path.split('/').map(encodeURIComponent).join('/');
      try {
        await navigator.clipboard.writeText(`tagline://note/${encoded}`);
        notify(t('Copied Tagline link'));
      } catch (error) {
        notify(t('Could not copy Tagline link: {error}', { error: error.message }));
      }
    },
    switchVault: () => setModal({ type: 'vaults' }),
    settings: () => setModal({ type: 'settings' }),
    newNote: (dir = activePath ? dirName(activePath) : '') =>
      createAndOpen(joinPath(dir, 'Untitled.md'), ''),
    newFlow: (dir = activePath ? dirName(activePath) : '') =>
      createAndOpen(
        joinPath(dir, 'Untitled Flow.flow'),
        createFlow(settings.separateNegativeBlock)
      ),
    newFolder: (dir = activePath ? dirName(activePath) : '') =>
      prompt(t('New folder name'), t('New folder'), (name) =>
        v.createFolder(joinPath(dir, sanitizeName(name)))
      ),
    newCanvas: (dir = activePath ? dirName(activePath) : '') =>
      createAndOpen(joinPath(dir, 'Untitled.canvas'), EMPTY_CANVAS).then(
        (path) => path && setModes((current) => ({ ...current, [path]: 'visual' }))
      ),
    rename: (node) =>
      prompt(
        t('Rename “{name}”', { name: node.name }),
        node.name.replace(/\.(md|flow|canvas)$/i, ''),
        (name) => doRename(node.path, renameTarget(node, name))
      ),
    move: doRename,
    remove: async (node) => {
      if (!(await confirm(t('Move “{name}” to the trash?', { name: node.name })))) {
        return;
      }
      if (await v.remove(node.path)) {
        tabs.removePath(node.path);
        favorites.remove(node.path);
      }
    },
    setSpeechDoc: async (path) => {
      try {
        const selected = await ensureSpeechDoc(path);
        if (selected) {
          notify(t('Speech doc set to “{name}”', { name: baseName(selected) }));
        }
      } catch (error) {
        notify(error.message);
      }
    },
  };

  return {
    setMode,
    open,
    openLink,
    prompt,
    ensureSpeechDoc,
    doRename,
    insertCitation,
    ext,
    createAndOpen,
    actions,
  };
}
