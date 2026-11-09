import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppLayout from './components/layout/AppLayout.jsx';
import { useConfirm } from './components/dialogs/ConfirmProvider.jsx';
import { clampPanel, PANEL_LIMITS } from './components/layout/Splitter.jsx';
import { useAppCommandContext } from './App/useAppCommandContext.js';
import { useAppOperations } from './App/useAppOperations.js';
import { containsEvidence, getSectionAt } from './lib/card.js';
import { defaultEditorMode } from './lib/editorModes.js';
import { markSpeechDocument, speechDocumentPaths } from './lib/frontmatter.js';
import { useI18n } from './lib/i18n.js';
import { KeybindingsContext } from './lib/keybindingContext.js';
import { setUiSoundSettings, playUiSound } from './lib/uiSounds.js';
import { useSettings } from './lib/settings.js';
import { useFavorites } from './lib/useFavorites.js';
import { useTabs } from './lib/useTabs.js';
import { useVault } from './lib/useVault.js';
import { baseName, flattenTree, isCanvas, isMarkdown, resolveLink } from './lib/vault.js';
import { visualBlocker, visualSelection } from './lib/visualHelpers.js';

export default function App() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [settings, updateSettings] = useSettings();
  const v = useVault(
    settings.underscoreFolders,
    settings.autoRelink,
    settings.historyRetention,
    settings.canvasHistoryMode,
    settings.experimentalHistoryDeltas
  );
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
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  const rightWidth = clampPanel(
    'rightPanelWidth',
    settings.rightPanelWidth,
    showLeft ? PANEL_LIMITS.sidebarWidth.min : 0
  );
  const sidebarWidth = clampPanel(
    'sidebarWidth',
    settings.sidebarWidth,
    showRight ? rightWidth : 0
  );
  const normalizedWidthVault = useRef(null);
  useEffect(() => {
    const root = v.vault?.root;
    if (!v.ready || !root) {
      normalizedWidthVault.current = null;
      return;
    }
    if (normalizedWidthVault.current === root) {
      return;
    }
    normalizedWidthVault.current = root;
    if (settings.sidebarWidth !== sidebarWidth || settings.rightPanelWidth !== rightWidth) {
      updateSettings({ sidebarWidth, rightPanelWidth: rightWidth });
    }
  }, [
    v.ready,
    v.vault?.root,
    settings.sidebarWidth,
    settings.rightPanelWidth,
    sidebarWidth,
    rightWidth,
    updateSettings,
  ]);
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
  const speechDoc = speechDocuments.includes(settings.speechDoc)
    ? settings.speechDoc
    : speechDocuments[0] || settings.speechDoc;
  const mode = (activePath && modes[activePath]) || defaultEditorMode(settings, activePath);
  const sourceFallback =
    mode === 'visual' &&
    !(activePath && isCanvas(activePath)) &&
    !!visualBlocker(activeContent || '');

  useEffect(() => {
    if (v.ready && settings.closeMissingTabs) {
      tabs.prune(new Set(paths));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tabs.prune is stable
  }, [v.ready, paths, settings.closeMissingTabs, tabs.prune]);

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
    if (!tabs.error) {
      return;
    }
    notify(tabs.error);
    tabs.clearError();
  }, [tabs, notify]);
  useEffect(
    () =>
      window.api.onWebsiteLink((url) => {
        if (settings.embedWebsites) {
          setWebsite(url);
        } else {
          window.api.websiteAction('external', url).catch((e) => notify(e.message));
        }
      }),
    [settings.embedWebsites, notify]
  );
  useEffect(() => {
    setWebsite(null);
  }, [v.vault?.root, tabs.activeId, activePath, settings.embedWebsites]);
  useEffect(() => {
    setUiSoundSettings(settings.interactionSounds);
  }, [settings.interactionSounds]);
  useEffect(() => {
    const onError = (e) => {
      playUiSound('error');
      notify(e.detail);
    };
    window.addEventListener('app-error', onError);
    return () => window.removeEventListener('app-error', onError);
  }, [notify]);

  // Remember the most recent note so the graph's local mode has a focus.
  const [lastFile, setLastFile] = useState(null);
  useEffect(() => {
    if (activePath) {
      setLastFile(activePath);
    }
  }, [activePath]);

  useEffect(() => {
    if (v.error) {
      notify(t('Error: {error}', { error: v.error }));
      v.clearError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- v.clearError stable; avoid v object identity churn
  }, [v.error, v.clearError, notify, t]);
  const flowVaultRef = useRef(v);
  flowVaultRef.current = v;
  const [externalFlow, setExternalFlow] = useState(null);
  useEffect(() => {
    if (!v.initialized) {
      return;
    }
    let processing = false;
    let disposed = false;
    const drain = async () => {
      if (processing || disposed) {
        return;
      }
      processing = true;
      try {
        let file;
        while (!disposed && (file = await window.api.nextFlowFile())) {
          const result = await flowVaultRef.current.openFlowFile(file);
          if (!disposed) {
            setExternalFlow(result);
          }
        }
      } catch (error) {
        notify(error.message);
      } finally {
        processing = false;
      }
    };
    const unsubscribe = window.api.onFlowAvailable(drain);
    drain();
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [v.initialized, notify]);
  useEffect(() => {
    if (
      externalFlow &&
      v.ready &&
      v.vault?.root === externalFlow.vault.root &&
      v.contents[externalFlow.path] !== undefined
    ) {
      tabs.openPath(externalFlow.path, true);
      setExternalFlow(null);
    }
  }, [externalFlow, v.ready, v.vault, v.contents, tabs]);

  const {
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
  } = useAppOperations({
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
  });

  const sendCard = useCallback(
    async (offset = cursorRef.current, selection = '') => {
      if (!activePath || !isMarkdown(activePath)) {
        return;
      }
      if (speechDoc === activePath) {
        return notify(t('This note is the speech doc'));
      }
      const text =
        selection ||
        (mode === 'visual' && visualRef.current
          ? visualSelection(visualRef.current)
          : getSectionAt(activeContent || '', offset)?.text);
      if (!text) {
        return notify(t('Put the cursor inside a card (under a heading) first'));
      }
      try {
        let doc = speechDoc;
        if (!isMarkdown(doc)) {
          throw new Error(t('Speech documents must be Markdown files.'));
        }
        if (v.contents[doc] != null) {
          if (!speechDocuments.includes(doc)) {
            throw new Error(t('Select a marked speech document before sending cards.'));
          }
          const destination = v.contents[doc];
          if (
            settings.warnDuplicateSend &&
            containsEvidence(destination, text) &&
            !(await confirm(
              t('This evidence is already in “{name}”. Send it again?', { name: baseName(doc) })
            ))
          ) {
            return;
          }
          v.updateContent(doc, `${destination.trimEnd()}\n\n${text}\n`);
          if (!(await v.flush())) {
            return;
          }
        } else {
          doc = await v.createFile(doc, markSpeechDocument(`# Speech Document\n\n${text}\n`));
          if (!doc) {
            return;
          }
        }
        updateSettings({ speechDoc: doc });
        notify(t('Sent to {name}', { name: baseName(doc) }));
      } catch (error) {
        notify(error.message);
      }
      return undefined;
    },
    [
      activePath,
      activeContent,
      mode,
      speechDoc,
      speechDocuments,
      v,
      notify,
      updateSettings,
      settings.warnDuplicateSend,
      confirm,
      t,
    ]
  );

  const templates = paths.filter((p) => p.toLowerCase().startsWith('templates/') && isMarkdown(p));
  const pickTemplate = (onPick) => {
    if (!templates.length) {
      return notify(t('Add markdown files to a “Templates” folder to use templates'));
    }
    return setModal({
      type: 'palette',
      placeholder: t('Choose a template…'),
      items: templates.map((p) => ({ id: p, label: baseName(p), path: p })),
      onSelect: (it) => onPick(it.path),
    });
  };

  const { ctx, keybindingContext } = useAppCommandContext({
    t,
    settings,
    ext,
    activePath,
    activeContent,
    mode,
    sourceFallback,
    setModal,
    setMode,
    v,
    tabs,
    actions,
    pickTemplate,
    prompt,
    createAndOpen,
    paths,
    editorRef,
    visualRef,
    cursorRef,
    sendCard,
    notify,
    ensureSpeechDoc,
    open,
    speechDoc,
    speechDocuments,
    setJump,
    setShowLeft,
    setShowRight,
    updateSettings,
    setHighlightOnly,
    modal,
  });
  return (
    <KeybindingsContext.Provider value={keybindingContext}>
      <AppLayout
        app={{
          t,
          settings,
          updateSettings,
          v,
          tabs,
          paths,
          noteNames,
          resolve,
          activePath,
          activeContent,
          mode,
          sourceFallback,
          stats,
          setStats,
          showLeft,
          showRight,
          sidebarWidth,
          rightWidth,
          lastFile,
          website,
          setWebsite,
          modal,
          setModal,
          jump,
          setJump,
          highlightOnly,
          setHighlightOnly,
          toast,
          ext,
          ctx,
          actions,
          open,
          openLink,
          sendCard,
          setMode,
          editorRef,
          visualRef,
          cursorRef,
          createAndOpen,
          doRename,
          notify,
          insertCitation,
          setVisualEditor,
          speechDoc,
          speechDocuments,
          favorites,
        }}
      />
    </KeybindingsContext.Provider>
  );
}
