import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVault } from './lib/useVault.js';
import { useTabs } from './lib/useTabs.js';
import { useSettings } from './lib/settings.js';
import { buildCommands, fillTemplate } from './lib/commands.js';
import { getSectionAt } from './lib/card.js';
import { slugify } from './lib/markdown.js';
import { baseName, dirName, flattenTree, isMarkdown, joinPath, outline, resolveLink } from './lib/vault.js';
import Sidebar, { renameTarget } from './components/Sidebar.jsx';
import TabBar from './components/TabBar.jsx';
import NoteView from './components/NoteView.jsx';
import GraphView from './components/GraphView.jsx';
import RightPanel from './components/RightPanel.jsx';
import SearchModal from './components/SearchModal.jsx';
import ExportDialog from './components/ExportDialog.jsx';
import ImportDialog from './components/ImportDialog.jsx';
import CitationDialog from './components/CitationDialog.jsx';
import { useI18n } from './lib/i18n.js';
import { visualBlocker, visualSelection } from './lib/visualExtensions.js';
import Welcome from './components/Welcome.jsx';
import Ribbon from './components/Ribbon.jsx';
import { EMPTY_FLOW } from './components/FlowEditor.jsx';
import { Palette, PromptDialog, SettingsDialog } from './components/Dialogs.jsx';

export default function App() {
  const { t } = useI18n();
  const [settings, updateSettings] = useSettings();
  const v = useVault(settings.underscoreFolders);
  const tabs = useTabs(v.vault?.root);
  const [modes, setModes] = useState({});
  const [highlightOnly, setHighlightOnly] = useState(false);
  const [modal, setModal] = useState(null);
  const [jump, setJump] = useState(null);
  const [stats, setStats] = useState(null);
  const [toast, setToast] = useState(null);
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);
  const editorRef = useRef(null);
  const visualRef = useRef(null);
  const cursorRef = useRef(0);

  const paths = useMemo(() => flattenTree(v.tree), [v.tree]);
  const noteNames = useMemo(() => paths.filter(isMarkdown).map(baseName), [paths]);
  const resolve = useCallback((t) => resolveLink(t, paths), [paths]);
  const activePath = tabs.activeTab?.kind === 'file' ? tabs.activeTab.path : null;
  const activeContent = activePath ? v.contents[activePath] : undefined;
  const mode = (activePath && modes[activePath]) || settings.editorMode;
  const sourceFallback = mode === 'visual' && !!visualBlocker(activeContent || '');

  useEffect(() => {
    if (v.ready) tabs.prune(new Set(paths));
  }, [v.ready, paths]); // eslint-disable-line react-hooks/exhaustive-deps

  const toastTimer = useRef(null);
  const notify = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);
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

  const setMode = (m) => activePath && setModes((s) => ({ ...s, [activePath]: m }));

  const open = useCallback(
    (path, newTab = false, line = null) => {
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

  const doRename = async (from, to) => {
    const result = await v.rename(from, to);
    if (!result) return;
    tabs.renamePath(from, result);
    if (settings.speechDoc === from || settings.speechDoc.startsWith(from + '/')) {
      updateSettings({ speechDoc: result + settings.speechDoc.slice(from.length) });
    }
  };

  const insertCitation = async (text) => {
    if (!activePath || !isMarkdown(activePath) || mode === 'read') {
      throw new Error(t('Open a note in an editing mode to insert a citation.'));
    }
    if (mode === 'visual' && !sourceFallback && visualRef.current) {
      visualRef.current.chain().focus().insertContent(text + '\n\n', { contentType: 'markdown' }).run();
    } else if (editorRef.current) {
      const view = editorRef.current;
      view.dispatch(view.state.replaceSelection(text + '\n\n'));
      view.focus();
    } else throw new Error(t('The editor is not ready.'));
  };

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
    switchVault: v.chooseVault,
    settings: () => setModal({ type: 'settings' }),
    newNote: (dir = activePath ? dirName(activePath) : '') => createAndOpen(joinPath(dir, 'Untitled.md'), ''),
    newFlow: (dir = activePath ? dirName(activePath) : '') => createAndOpen(joinPath(dir, 'Untitled Flow.flow'), EMPTY_FLOW),
    newFolder: (dir = activePath ? dirName(activePath) : '') =>
      prompt(t('New folder name'), t('New folder'), (name) => v.createFolder(joinPath(dir, name.replace(/[\\/:*?"<>|]/g, '-')))),
    rename: (node) => prompt(t('Rename “{name}”', { name: node.name }), node.name.replace(/\.(md|flow)$/i, ''), (name) => doRename(node.path, renameTarget(node, name))),
    move: doRename,
    remove: async (node) => {
      if (!window.confirm(t('Move “{name}” to the trash?', { name: node.name }))) return;
      if (await v.remove(node.path)) tabs.removePath(node.path);
    },
    setSpeechDoc: (path) => {
      updateSettings({ speechDoc: path });
      notify(t('Speech doc set to “{name}”', { name: baseName(path) }));
    },
  };

  const sendCard = useCallback(
    async (offset = cursorRef.current, selection = '') => {
      if (!activePath || !isMarkdown(activePath)) return;
      const doc = settings.speechDoc;
      if (doc === activePath) return notify(t('This note is the speech doc'));
      const text = selection || (mode === 'visual' && visualRef.current
        ? visualSelection(visualRef.current) : getSectionAt(activeContent || '', offset)?.text);
      if (!text) return notify(t('Put the cursor inside a card (under a heading) first'));
      if (v.contents[doc] != null) {
        v.updateContent(doc, `${v.contents[doc].trimEnd()}\n\n${text}\n`);
      } else {
        const created = await v.createFile(doc, `# Speech Document\n\n${text}\n`);
        if (created && created !== doc) updateSettings({ speechDoc: created });
      }
      notify(t('Sent to {name}', { name: baseName(doc) }));
      return undefined;
    },
    [activePath, activeContent, mode, settings.speechDoc, v, notify, updateSettings],
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
    hasNote: !!activePath,
    openSwitcher: () => setModal({ type: 'switcher' }),
    openSearch: () => setModal({ type: 'search' }),
    newNote: () => actions.newNote(),
    newFlow: () => actions.newFlow(),
    newFolder: () => actions.newFolder(),
    newFromTemplate: () =>
      pickTemplate((tp) =>
        prompt(t('Name for the new note'), baseName(tp), (name) =>
          createAndOpen(`${name.replace(/[\\/:*?"<>|]/g, '-')}.md`, fillTemplate(v.contents[tp] || '', name)),
        ),
      ),
    insertTemplate: () =>
      pickTemplate((tp) => {
        const template = fillTemplate(v.contents[tp] || '', baseName(activePath));
        if (mode === 'visual' && visualRef.current) {
          visualRef.current.chain().focus().insertContent(template, { contentType: 'markdown' }).run();
          return;
        }
        const view = editorRef.current;
        if (mode === 'read' || !view) return notify(t('Switch to an editing mode to insert a template'));
        view.dispatch(view.state.replaceSelection(template));
        view.focus();
        return undefined;
      }),
    openGraph: tabs.openGraph,
    openSettings: actions.settings,
    toggleLeft: () => setShowLeft((s) => !s),
    toggleRight: () => setShowRight((s) => !s),
    openSpeechDoc: () =>
      v.contents[settings.speechDoc] != null
        ? open(settings.speechDoc, true)
        : createAndOpen(settings.speechDoc, '# Speech Document\n\n').then((p) => p && updateSettings({ speechDoc: p })),
    newSpeechDoc: async () => {
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
      const p = await createAndOpen(`Speech Docs/Speech ${stamp}.md`, `# Speech – ${stamp}\n\n`);
      if (p) actions.setSpeechDoc(p);
    },
    switchVault: v.chooseVault,
    createSample: v.createSample,
    reload: v.reload,
    toggleMode: () => setMode(mode !== 'read' ? 'read' : settings.editorMode),
    sourceMode: () => setMode('edit'),
    visualMode: () => setMode('visual'),
    exportNote: () => activePath && isMarkdown(activePath) ? setModal({ type: 'export' })
      : notify(t('Export is available for Markdown notes and speech documents.')),
    importDocument: () => setModal({ type: 'import' }),
    toggleHighlightOnly: () => {
      setMode('read');
      setHighlightOnly((h) => !h);
    },
    sendCard: () => (mode !== 'read' ? sendCard() : notify(t('Switch to an editing mode and place the cursor in a card'))),
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
  useEffect(() => window.api.onMenuCommand((command) => {
    const vaultless = ['switchVault', 'openSettings', 'createCitation'];
    if (vaultRef.current || vaultless.includes(command)) ctxRef.current[command]?.();
  }), []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || !v.vault) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (e.shiftKey && k === 's' && e.target.closest?.('.cm-editor, .visual-editor')) return;
      const c = ctxRef.current;
      const map = {
        o: c.openSwitcher,
        p: c.openCommands,
        n: c.newNote,
        g: c.openGraph,
        e: c.hasNote && c.toggleMode,
        w: c.closeTab,
        ',': c.openSettings,
      };
      const shiftMap = { f: c.openSearch, h: c.hasNote && c.toggleHighlightOnly, s: c.hasNote && c.sendCard };
      const fn = e.shiftKey ? shiftMap[k] : k === 'tab' ? c.nextTab : map[k];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    // App navigation takes precedence over editor-specific shortcuts (e.g. Tiptap's Ctrl+E).
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [v.vault]);

  const commands = buildCommands(ctx);
  ctx.openCommands = () => setModal({ type: 'palette', placeholder: t('Type a command…'), items: commands, onSelect: (cmd) => cmd.run() });
  ctx.nextTab = () => {
    const i = tabs.tabs.findIndex((t) => t.id === tabs.activeId);
    const next = tabs.tabs[(i + 1) % tabs.tabs.length];
    if (next) tabs.setActiveId(next.id);
  };

  const settingsDialog = <SettingsDialog settings={settings} update={updateSettings} onClose={() => setModal(null)} />;
  if (!v.vault) return <>
    {window.api.platform === 'darwin' && <div className="mac-titlebar">Tagline</div>}
    <Welcome onOpen={v.chooseVault} onSample={v.createSample} error={v.error} />
    {modal?.type === 'settings' && settingsDialog}
    {modal?.type === 'citation' && <CitationDialog onClose={() => setModal(null)} />}
    {toast && <div className="toast">{toast}</div>}
  </>;

  const renderWorkspace = () => {
    const tab = tabs.activeTab;
    if (!tab) {
      return (
        <div className="empty-workspace">
          <h2>{t('No file is open')}</h2>
          <button className="link-btn" onClick={ctx.newNote}>{t('Create new note')} (Ctrl+N)</button>
          <button className="link-btn" onClick={ctx.openSwitcher}>{t('Go to file')} (Ctrl+O)</button>
          <button className="link-btn" onClick={ctx.openGraph}>{t('Open graph view')} (Ctrl+G)</button>
          <button className="link-btn" onClick={ctx.openCommands}>{t('Command palette')} (Ctrl+P)</button>
          <button className="link-btn" onClick={ctx.importDocument}>{t('Import document with Pandoc')}</button>
        </div>
      );
    }
    if (tab.kind === 'graph') return <GraphView index={v.index} activePath={lastFile} onOpen={open} />;
    if (activeContent === undefined) return <div className="empty-workspace">{t('Loading…')}</div>;
    return (
      <NoteView
        key={tab.path}
        path={tab.path}
        content={activeContent}
        mode={mode}
        setMode={setMode}
        highlightOnly={highlightOnly}
        setHighlightOnly={setHighlightOnly}
        jump={jump}
        noteNames={noteNames}
        resolve={resolve}
        onChange={(text) => v.updateContent(tab.path, text)}
        onOpenLink={openLink}
        onTagClick={(t) => setModal({ type: 'search', query: `tag:${t} ` })}
        onSendCard={sendCard}
        onCursor={(pos) => (cursorRef.current = pos)}
        onCursorStats={setStats}
        onRename={(path, title) => doRename(path, renameTarget({ type: 'file', path }, title))}
        editorRef={editorRef}
        visualRef={visualRef}
        onExport={ctx.exportNote}
        onCreateCitation={ctx.createCitation}
        settings={settings}
      />
    );
  };

  return (
    <div className={`app${window.api.platform === 'darwin' ? ' mac-app' : ''}`}>
      {window.api.platform === 'darwin' && <div className="mac-titlebar">Tagline</div>}
      <Ribbon ctx={ctx} showLeft={showLeft} />
      {showLeft && <Sidebar vault={v.vault} tree={v.tree} activePath={activePath} actions={actions}
        spacedFolders={settings.underscoreFolders} />}
      <main className="main">
        <TabBar tabs={tabs.tabs} activeId={tabs.activeId} onActivate={tabs.setActiveId} onClose={tabs.close}
          onCloseOthers={tabs.closeOthers} onFileAction={(action, path) => action === 'rename'
            ? actions.rename({ type: 'file', path, name: path.split('/').pop() }) : v.reveal(path)} />
        <div className="workspace">{renderWorkspace()}</div>
        <footer className="status-bar">
          {activePath && stats?.map((s, i) => <span key={i}>{s}</span>)}
          <span className="spacer" />
          <span title={t('Current speech document')} className="clickable" onClick={ctx.openSpeechDoc}>
            {t('Speech doc')}: {baseName(settings.speechDoc)}
          </span>
          {activePath && <span>{t(mode === 'edit' || sourceFallback ? 'Source editing' : mode === 'visual' ? 'Visual editing'
            : highlightOnly ? 'Reading (highlights)' : 'Reading')}</span>}
        </footer>
      </main>
      <div style={{ display: showRight ? 'contents' : 'none' }}>
        <RightPanel
          activePath={activePath}
          content={activeContent}
          index={v.index}
          contents={v.contents}
          onOpen={open}
          onJump={(h) =>
            setJump({ path: activePath, line: h.line, heading: h.text, n: Date.now() })
          }
          onTagClick={(t) => setModal({ type: 'search', query: `tag:${t} ` })}
          settings={settings}
          updateSettings={updateSettings}
        />
      </div>

      {modal?.type === 'switcher' && (
        <Palette
          placeholder={t('Find or create a note…')}
          items={paths.map((p) => ({ id: p, label: baseName(p), detail: dirName(p), path: p }))}
          onSelect={(it, e) => open(it.path, e?.ctrlKey || e?.metaKey)}
          onCreate={(name) => createAndOpen(`${name.replace(/[\\:*?"<>|]/g, '-')}.md`, `# ${baseName(name)}\n\n`)}
          createLabel={t('Create note')}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'palette' && (
        <Palette placeholder={modal.placeholder} items={modal.items} onSelect={modal.onSelect} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'search' && (
        <SearchModal contents={v.contents} index={v.index} initialQuery={modal.query} maxResults={settings.searchMaxResults}
          onOpen={open} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'prompt' && (
        <PromptDialog title={modal.title} initial={modal.initial} onSubmit={modal.onSubmit} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'settings' && (
        settingsDialog
      )}
      {modal?.type === 'export' && activePath && (
        <ExportDialog title={baseName(activePath)} content={activeContent || ''} resolve={resolve} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'import' && <ImportDialog onImport={createAndOpen} onClose={() => setModal(null)} />}
      {modal?.type === 'citation' && <CitationDialog onInsert={activePath && isMarkdown(activePath) && mode !== 'read'
        ? insertCitation : null} onClose={() => setModal(null)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
