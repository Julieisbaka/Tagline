import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createFlow } from '../electron/flow.mjs';
import { useConfirm } from './components/dialogs/ConfirmProvider.jsx';
import AppLayout from './components/layout/AppLayout.jsx';
import { renameTarget } from './components/layout/Sidebar.jsx';
import { clampPanel, PANEL_LIMITS } from './components/layout/Splitter.jsx';
import { EMPTY_CANVAS } from './lib/canvas.js';
import { containsEvidence, getSectionAt } from './lib/card.js';
import { buildCommands, fillTemplate } from './lib/commands.js';
import { markSpeechDocument, speechDocumentPaths } from './lib/frontmatter.js';
import { useI18n } from './lib/i18n.js';
import { binding, displayBinding, KEYBINDINGS, matchesBinding } from './lib/keybindings.js';
import { slugify } from './lib/markdown.js';
import { useSettings } from './lib/settings.js';
import { useAppExtensions } from './lib/useAppExtensions.js';
import { useFavorites } from './lib/useFavorites.js';
import { useTabs } from './lib/useTabs.js';
import { useVault } from './lib/useVault.js';
import { baseName, dirName, flattenTree, isCanvas, isFlow, isMarkdown, joinPath, outline, resolveLink } from './lib/vault.js';
import { visualBlocker, visualSelection } from './lib/visualHelpers.js';

export default function App() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [settings, updateSettings] = useSettings();
  const v = useVault(settings.underscoreFolders, settings.autoRelink, settings.historyRetention, settings.canvasHistoryMode, settings.experimentalHistoryDeltas);
  const tabs = useTabs(v.vault?.root, settings.persistWorkspaceTabs);
  const favorites = useFavorites(v.vault?.root);
  const [modes, setModes] = useState({});
  const [highlightOnly, setHighlightOnly] = useState(false);
  const [modal, setModal] = useState(null);
  const [website, setWebsite] = useState(null);
  const [jump, setJump] = useState(null);
  const [stats, setStats] = useState(null);
  const [toast, setToast] = useState(null);
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);
  const [, setWindowWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setWindowWidth(window.innerWidth));
    };
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', onResize); };
  }, []);
  const rightWidth = clampPanel('rightPanelWidth', settings.rightPanelWidth, showLeft ? PANEL_LIMITS.sidebarWidth.min : 0);
  const sidebarWidth = clampPanel('sidebarWidth', settings.sidebarWidth, showRight ? rightWidth : 0);
  const editorRef = useRef(null);
  const visualRef = useRef(null);
  const [visualEditor, setVisualEditor] = useState(null);
  const cursorRef = useRef(0);

  const paths = useMemo(() => flattenTree(v.tree), [v.tree]);
  const noteNames = useMemo(() => paths.filter(isMarkdown).map(baseName), [paths]);
  const resolve = useCallback((t) => resolveLink(t, paths), [paths]);
  const activePath = tabs.activeTab?.kind === 'file' ? tabs.activeTab.path : null;
  const activeContent = activePath ? v.contents[activePath] : undefined;
  const speechDocuments = useMemo(() => speechDocumentPaths(v.contents), [v.contents]);
  const speechDoc = speechDocuments.includes(settings.speechDoc) ? settings.speechDoc
    : speechDocuments[0] || settings.speechDoc;
  const mode = (activePath && modes[activePath]) || settings.editorMode;
  const sourceFallback = mode === 'visual' && !(activePath && isCanvas(activePath)) && !!visualBlocker(activeContent || '');

  useEffect(() => {
    if (v.ready && settings.closeMissingTabs) tabs.prune(new Set(paths));
  }, [v.ready, paths, settings.closeMissingTabs, tabs.tabs]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeContent === undefined || (activePath && isCanvas(activePath))) {
      editorRef.current = null;
      visualRef.current = null;
      setVisualEditor(null);
      cursorRef.current = 0;
      setStats(null);
    }
  }, [activeContent, activePath]);

  const toastTimer = useRef(null);
  const notify = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);
  useEffect(() => {
    if (!tabs.error) return;
    notify(tabs.error);
    tabs.clearError();
  }, [tabs.error, tabs.clearError, notify]);
  useEffect(() => window.api.onWebsiteLink((url) => {
    if (settings.embedWebsites) setWebsite(url);
    else window.api.websiteAction('external', url).catch((e) => notify(e.message));
  }), [settings.embedWebsites, notify]);
  useEffect(() => { setWebsite(null); }, [v.vault?.root, tabs.activeId, activePath, settings.embedWebsites]);
  useEffect(() => {
    const onError = (e) => notify(e.detail);
    window.addEventListener('app-error', onError);
    return () => window.removeEventListener('app-error', onError);
  }, [notify]);

  // Remember the most recent note so the graph's local mode has a focus.
  const [lastFile, setLastFile] = useState(null);
  useEffect(() => {
    if (activePath) setLastFile(activePath);
  }, [activePath]);

  useEffect(() => {
    if (v.error) {
      notify(t('Error: {error}', { error: v.error }));
      v.clearError();
    }
  }, [v.error]); // eslint-disable-line react-hooks/exhaustive-deps
  const flowVaultRef = useRef(v);
  flowVaultRef.current = v;
  const [externalFlow, setExternalFlow] = useState(null);
  useEffect(() => {
    if (!v.initialized) return;
    let processing = false;
    let disposed = false;
    const drain = async () => {
      if (processing || disposed) return;
      processing = true;
      try {
        let file;
        while (!disposed && (file = await window.api.nextFlowFile())) {
          const result = await flowVaultRef.current.openFlowFile(file);
          if (!disposed) setExternalFlow(result);
        }
      } catch (error) { notify(error.message); }
      finally { processing = false; }
    };
    const unsubscribe = window.api.onFlowAvailable(drain);
    drain();
    return () => { disposed = true; unsubscribe(); };
  }, [v.initialized, notify]);
  useEffect(() => {
    if (externalFlow && v.ready && v.vault?.root === externalFlow.vault.root &&
      v.contents[externalFlow.path] !== undefined) {
      tabs.openPath(externalFlow.path, true);
      setExternalFlow(null);
    }
  }, [externalFlow, v.ready, v.vault, v.contents, tabs]);

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
    [tabs],
  );

  const openLink = useCallback(
    async (target, heading, newTab) => {
      let path = resolveLink(target, paths);
      if (!path) {
        path = await v.createFile(`${target.replace(/\.md$/i, '')}.md`, `# ${baseName(target)}\n\n`);
        if (!path) return;
        notify(t('Created “{name}”', { name: baseName(path) }));
      }
      tabs.openPath(path, newTab);
      if (heading) {
        const h = outline(v.contents[path] || '').find((x) => slugify(x.text) === slugify(heading));
        setJump({ path, heading, line: h?.line ?? null, n: Date.now() });
      }
    },
    [paths, v, tabs, notify],
  );

  const prompt = (title, initial, onSubmit) => setModal({ type: 'prompt', title, initial, onSubmit });

  const ensureSpeechDoc = useCallback(async (path) => {
    if (!path || !isMarkdown(path)) throw new Error(t('Speech documents must be Markdown files.'));
    let result = path;
    if (v.contents[path] !== undefined) {
      const content = markSpeechDocument(v.contents[path]);
      if (content !== v.contents[path]) {
        v.updateContent(path, content);
        if (!await v.flush()) return null;
      }
    } else {
      result = await v.createFile(path, markSpeechDocument('# Speech Document\n\n'));
      if (!result) return null;
    }
    updateSettings({ speechDoc: result });
    return result;
  }, [v, updateSettings]);

  const doRename = async (from, to) => {
    const result = await v.rename(from, to);
    if (!result) return;
    tabs.renamePath(from, result);
    favorites.rename(from, result);
    if (settings.speechDoc === from || settings.speechDoc.startsWith(from + '/')) {
      updateSettings({ speechDoc: result + settings.speechDoc.slice(from.length) });
    }
    return result;
  };

  const insertAtCursor = async (text, message = 'Open a note in an editing mode to insert text.') => {
    if (!activePath || !isMarkdown(activePath) || mode === 'read') throw new Error(t(message));
    if (mode === 'visual' && !sourceFallback && visualRef.current) {
      visualRef.current.chain().focus().insertContent(text, { contentType: 'markdown' }).run();
    } else if (editorRef.current) {
      const view = editorRef.current;
      view.dispatch(view.state.replaceSelection(text));
      view.focus();
    } else throw new Error(t('The editor is not ready.'));
  };
  const insertCitation = (text) => insertAtCursor(text + '\n\n', 'Open a note in an editing mode to insert a citation.');

  const ext = useAppExtensions({
    v, paths, activePath, activeContent, mode, sourceFallback, editorRef, visualRef,
    insertAtCursor, doRename, tabs, notify, visualEditor,
  });

  const createAndOpen = async (path, content) => {
    const p = await v.createFile(path, content);
    if (p) {
      tabs.openPath(p, false);
      setModes((s) => ({ ...s, [p]: settings.editorMode }));
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
    switchVault: () => setModal({ type: 'vaults' }),
    settings: () => setModal({ type: 'settings' }),
    newNote: (dir = activePath ? dirName(activePath) : '') => createAndOpen(joinPath(dir, 'Untitled.md'), ''),
    newFlow: (dir = activePath ? dirName(activePath) : '') => createAndOpen(joinPath(dir, 'Untitled Flow.flow'), createFlow(settings.separateNegativeBlock)),
    newFolder: (dir = activePath ? dirName(activePath) : '') =>
      prompt(t('New folder name'), t('New folder'), (name) => v.createFolder(joinPath(dir, name.replace(/[\\/:*?"<>|]/g, '-')))),
    newCanvas: (dir = activePath ? dirName(activePath) : '') => createAndOpen(joinPath(dir, 'Untitled.canvas'), EMPTY_CANVAS)
      .then((path) => path && setModes((current) => ({ ...current, [path]: 'visual' }))),
    rename: (node) => prompt(t('Rename “{name}”', { name: node.name }), node.name.replace(/\.(md|flow|canvas)$/i, ''), (name) => doRename(node.path, renameTarget(node, name))),
    move: doRename,
    remove: async (node) => {
      if (!await confirm(t('Move “{name}” to the trash?', { name: node.name }))) return;
      if (await v.remove(node.path)) {
        tabs.removePath(node.path);
        favorites.remove(node.path);
      }
    },
    setSpeechDoc: async (path) => {
      try {
        const selected = await ensureSpeechDoc(path);
        if (selected) notify(t('Speech doc set to “{name}”', { name: baseName(selected) }));
      } catch (error) { notify(error.message); }
    },
  };

  const sendCard = useCallback(
    async (offset = cursorRef.current, selection = '') => {
      if (!activePath || !isMarkdown(activePath)) return;
      if (speechDoc === activePath) return notify(t('This note is the speech doc'));
      const text = selection || (mode === 'visual' && visualRef.current
        ? visualSelection(visualRef.current) : getSectionAt(activeContent || '', offset)?.text);
      if (!text) return notify(t('Put the cursor inside a card (under a heading) first'));
      try {
        let doc = speechDoc;
        if (!isMarkdown(doc)) throw new Error(t('Speech documents must be Markdown files.'));
        if (v.contents[doc] != null) {
          if (!speechDocuments.includes(doc)) throw new Error(t('Select a marked speech document before sending cards.'));
          const destination = v.contents[doc];
          if (settings.warnDuplicateSend && containsEvidence(destination, text)
            && !await confirm(t('This evidence is already in “{name}”. Send it again?', { name: baseName(doc) }))) return;
          v.updateContent(doc, `${destination.trimEnd()}\n\n${text}\n`);
          if (!await v.flush()) return;
        } else {
          doc = await v.createFile(doc, markSpeechDocument(`# Speech Document\n\n${text}\n`));
          if (!doc) return;
        }
        updateSettings({ speechDoc: doc });
        notify(t('Sent to {name}', { name: baseName(doc) }));
      } catch (error) { notify(error.message); }
      return undefined;
    },
    [activePath, activeContent, mode, speechDoc, speechDocuments, v, notify, updateSettings, settings.warnDuplicateSend, confirm],
  );

  const templates = paths.filter((p) => p.toLowerCase().startsWith('templates/') && isMarkdown(p));
  const pickTemplate = (onPick) => {
    if (!templates.length) return notify(t('Add markdown files to a “Templates” folder to use templates'));
    return setModal({
      type: 'palette',
      placeholder: t('Choose a template…'),
      items: templates.map((p) => ({ id: p, label: baseName(p), path: p })),
      onSelect: (it) => onPick(it.path),
    });
  };

  const ctx = {
    createCitation: () => setModal({ type: 'citation' }),
    hasNote: !!activePath && activeContent !== undefined,
    isMarkdown: !!activePath && isMarkdown(activePath),
    canCanvas: !!activePath && isCanvas(activePath) && mode !== 'edit',
    canFlow: !!activePath && isFlow(activePath) && mode !== 'edit',
    workspaceAction: (action) => window.dispatchEvent(new CustomEvent('workspace-action', { detail: action })),
    readMode: () => setMode('read'),
    openHistory: async () => {
      try { if (activePath && await v.flush()) setModal({ type: 'history', path: activePath }); }
      catch (error) { notify(error.message); }
    },
    summarizeCurrent: () => ctx.summarize(activePath, activeContent),
    previousTab: () => {
      const i = tabs.tabs.findIndex((tab) => tab.id === tabs.activeId);
      const previous = tabs.tabs[(i - 1 + tabs.tabs.length) % tabs.tabs.length];
      if (previous) tabs.setActiveId(previous.id);
    },
    nextTab: () => {
      const i = tabs.tabs.findIndex((tab) => tab.id === tabs.activeId);
      const next = tabs.tabs[(i + 1) % tabs.tabs.length];
      if (next) tabs.setActiveId(next.id);
    },
    openSwitcher: () => setModal({ type: 'switcher' }),
    openSearch: () => setModal({ type: 'search' }),
    newNote: () => actions.newNote(),
    newFlow: () => actions.newFlow(),
    newCanvas: () => actions.newCanvas(),
    newFolder: () => actions.newFolder(),
    newFromTemplate: () =>
      pickTemplate((tp) =>
        prompt(t('Name for the new note'), baseName(tp), (name) => {
          const path = `${name.replace(/[\\/:*?"<>|]/g, '-')}.md`;
          return createAndOpen(path, fillTemplate(v.contents[tp] || '', name, { path }));
        }),
      ),
    insertTemplate: () => {
      if (!activePath || !isMarkdown(activePath) || mode === 'read') {
        return notify(t('Switch to an editing mode to insert a template'));
      }
      return pickTemplate((tp) => {
        const template = fillTemplate(v.contents[tp] || '', baseName(activePath),
          { path: activePath, content: activeContent || '' });
        if (mode === 'visual' && !sourceFallback && visualRef.current) {
          visualRef.current.chain().focus().insertContent(template, { contentType: 'markdown' }).run();
          return;
        }
        const view = editorRef.current;
        if (mode === 'read' || !view) return notify(t('Switch to an editing mode to insert a template'));
        view.dispatch(view.state.replaceSelection(template));
        view.focus();
        return undefined;
      });
    },
    openGraph: tabs.openGraph,
    openSettings: actions.settings,
    toggleLeft: () => setShowLeft((s) => !s),
    toggleRight: () => setShowRight((s) => !s),
    openSpeechDoc: async () => {
      try {
        if (v.contents[speechDoc] !== undefined && !speechDocuments.includes(speechDoc)) {
          throw new Error(t('Select a marked speech document before sending cards.'));
        }
        const path = await ensureSpeechDoc(speechDoc);
        if (path) open(path, true);
      } catch (error) { notify(error.message); }
    },
    newSpeechDoc: async () => {
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
      const p = await createAndOpen(`Speech Docs/Speech ${stamp}.md`, markSpeechDocument(`# Speech – ${stamp}\n\n`));
      if (p) updateSettings({ speechDoc: p });
    },
    switchVault: v.chooseVault,
    createSample: v.createSample,
    reload: v.reload,
    toggleMode: () => setMode(isCanvas(activePath) ? (mode === 'edit' ? 'visual' : 'edit')
      : mode !== 'read' ? 'read' : settings.editorMode),
    sourceMode: () => setMode('edit'),
    visualMode: () => setMode('visual'),
    exportNote: () => activePath && isMarkdown(activePath) ? setModal({ type: 'export' })
      : notify(t('Export is available for Markdown notes and speech documents.')),
    testHypothesis: () => {
      if (!activePath || !isMarkdown(activePath)) return notify(t('Open a Markdown note to test a hypothesis.'));
      const view = editorRef.current;
      const source = (mode === 'edit' || sourceFallback) && view;
      const sources = {
        selection: source ? view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) : '',
        card: source ? getSectionAt(activeContent || '', cursorRef.current)?.text
          : mode === 'visual' && visualRef.current ? visualSelection(visualRef.current) : '',
        note: activeContent || '',
      };
      return setModal({ type: 'hypothesis', sources });
    },
    summarize: (path, content) => {
      if (!path || !isMarkdown(path)) return notify(t('Open a Markdown document to summarize it.'));
      return setModal({ type: 'summary', title: baseName(path), content: content || '' });
    },
    importDocument: () => setModal({ type: 'import' }),
    openCaselist: () => setModal({ type: 'opencaselist' }),
    openTabroom: () => setModal({ type: 'tabroom' }),
    toggleHighlightOnly: () => {
      setMode('read');
      setHighlightOnly((h) => !h);
    },
    sendCard: () => {
      if (mode === 'read') return notify(t('Switch to an editing mode and place the cursor in a card'));
      const view = editorRef.current;
      if ((mode === 'edit' || sourceFallback) && view) {
        const { from, to, head } = view.state.selection.main;
        return sendCard(head, view.state.sliceDoc(from, to));
      }
      return sendCard();
    },
    setCurrentAsSpeechDoc: () => actions.setSpeechDoc(activePath),
    renameCurrent: () => activePath && actions.rename({ type: 'file', path: activePath, name: activePath.split('/').pop() }),
    deleteCurrent: () => activePath && actions.remove({ type: 'file', path: activePath, name: activePath.split('/').pop() }),
    revealCurrent: () => activePath && v.reveal(activePath),
    closeTab: () => tabs.activeId && tabs.close(tabs.activeId),
  };
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const vaultRef = useRef(v.vault);
  vaultRef.current = v.vault;
  const extRef = useRef(ext);
  extRef.current = ext;
  useEffect(() => window.api.onMenuCommand((command) => {
    const vaultless = ['switchVault', 'openSettings', 'createCitation'];
    if (vaultRef.current || vaultless.includes(command)) ctxRef.current[command]?.();
  }), []);
  useEffect(() => {
    window.api.setKeybindings(settings.keybindings).catch((error) => notify(error.message));
  }, [settings.keybindings, notify]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.isComposing || modal) return;
      const c = ctxRef.current;
      const command = KEYBINDINGS.find((item) => item.scope === 'app' &&
        matchesBinding(e, binding(item.id, settings.keybindings)));
      if (command && (!command.note || c.hasNote) && (!command.markdown || c.isMarkdown) &&
        (v.vault || ['settings', 'citation', 'vault-open'].includes(command.id))) {
        e.preventDefault();
        c[command.action]?.();
        return;
      }
      if (command) return;
      // Built-in shortcuts win over extension defaults that happen to collide.
      const contributed = v.vault && extRef.current.commands.find((item) =>
        matchesBinding(e, binding(item.id, settings.keybindings, extRef.current.commands)));
      if (contributed) {
        e.preventDefault();
        extRef.current.run(contributed);
      }
    };
    // App navigation takes precedence over editor-specific shortcuts (e.g. Tiptap's Ctrl+E).
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [v.vault, settings.keybindings, modal]);

  const commands = [...buildCommands(ctx, settings.keybindings), ...ext.commands.map((item) => ({
    id: item.id, label: item.label, run: () => ext.run(item),
    hotkey: displayBinding(binding(item.id, settings.keybindings, ext.commands)),
  }))];
  ctx.openCommands = () => setModal({ type: 'palette', placeholder: t('Type a command…'), items: commands, onSelect: (cmd) => cmd.run() });
  return <AppLayout app={{
    t, settings, updateSettings, v, tabs, paths, noteNames, resolve, activePath, activeContent, mode,
    sourceFallback, stats, setStats, showLeft, showRight, sidebarWidth, rightWidth, lastFile, website,
    setWebsite, modal, setModal, jump, setJump, highlightOnly, setHighlightOnly, toast, ext, ctx, actions,
    open, openLink, sendCard, setMode, editorRef, visualRef, cursorRef, createAndOpen, doRename, notify,
    insertCitation, setVisualEditor, speechDoc, speechDocuments, favorites,
  }} />;
}
