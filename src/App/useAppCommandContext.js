import { useEffect, useMemo, useRef } from 'react';
import { EditorSelection } from '@codemirror/state';
import { buildCommands, fillTemplate } from '../lib/commands.js';
import { templateBody } from '../lib/template.js';
import { getSectionAt } from '../lib/card.js';
import { defaultEditorMode } from '../lib/editorModes.js';
import { markSpeechDocument } from '../lib/frontmatter.js';
import { binding, displayBinding, KEYBINDINGS, matchesBinding } from '../lib/keybindings.js';
import { slugify } from '../lib/markdown.js';
import { standardizeAll } from '../lib/standardizeFormatting.js';
import { baseName, isCanvas, isFlow, isMarkdown, outline } from '../lib/vault.js';
import { visualSelection } from '../lib/visualHelpers.js';

export function useAppCommandContext({
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
  modal,
  setHighlightOnly,
}) {
  const ctx = {
    createCitation: () => setModal({ type: 'citation' }),
    evidenceCheckup: () => setModal({ type: 'evidence' }),
    quoteVerification: () => setModal({ type: 'quote-verification' }),
    deliveryAnalytics: () => setModal({ type: 'delivery-analytics' }),
    hasNote: !!activePath && activeContent !== undefined,
    isMarkdown: !!activePath && isMarkdown(activePath),
    canCanvas: !!activePath && isCanvas(activePath) && mode !== 'edit',
    canFlow: !!activePath && isFlow(activePath) && mode !== 'edit',
    workspaceAction: (action) =>
      window.dispatchEvent(new CustomEvent('workspace-action', { detail: action })),
    readMode: () => setMode('read'),
    openHistory: async () => {
      try {
        if (activePath && (await v.flush())) {
          setModal({ type: 'history', path: activePath });
        }
      } catch (error) {
        notify(error.message);
      }
    },
    summarizeCurrent: () => ctx.summarize(activePath, activeContent),
    previousTab: () => {
      const i = tabs.tabs.findIndex((tab) => tab.id === tabs.activeId);
      const previous = tabs.tabs[(i - 1 + tabs.tabs.length) % tabs.tabs.length];
      if (previous) {
        tabs.setActiveId(previous.id);
      }
    },
    nextTab: () => {
      const i = tabs.tabs.findIndex((tab) => tab.id === tabs.activeId);
      const next = tabs.tabs[(i + 1) % tabs.tabs.length];
      if (next) {
        tabs.setActiveId(next.id);
      }
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
        })
      ),
    insertTemplate: () => {
      if (!activePath || !isMarkdown(activePath) || mode === 'read') {
        return notify(t('Switch to an editing mode to insert a template'));
      }
      return pickTemplate((tp) => {
        const { hasFrontmatter, body } = templateBody(v.contents[tp] || '');
        if (hasFrontmatter) {
          notify(
            t(
              'Template properties (YAML frontmatter) were not inserted. Use “Create new note from template” to keep them.'
            )
          );
        }
        const template = fillTemplate(body, baseName(activePath), {
          path: activePath,
          content: activeContent || '',
        });
        if (mode === 'visual' && !sourceFallback && visualRef.current) {
          visualRef.current
            .chain()
            .focus()
            .insertContent(template, { contentType: 'markdown' })
            .run();
          return;
        }
        const view = editorRef.current;
        if (mode === 'read' || !view) {
          return notify(t('Switch to an editing mode to insert a template'));
        }
        view.dispatch(view.state.replaceSelection(template));
        view.focus();
        return undefined;
      });
    },
    formatMarkup: () => {
      if (!activePath || !isMarkdown(activePath)) {
        return notify(t('Open a Markdown note to format markup.'));
      }
      if (mode === 'read') {
        return notify(t('Switch to an editing mode to format markup.'));
      }
      if (mode === 'visual' && !sourceFallback && visualRef.current) {
        const editor = visualRef.current;
        if (editor.state.selection.empty) {
          return notify(t('Select text to format markup.'));
        }
        const selected = visualSelection(editor);
        editor
          .chain()
          .focus()
          .insertContent(standardizeAll(selected), { contentType: 'markdown' })
          .run();
        return;
      }
      const view = editorRef.current;
      if ((mode === 'edit' || sourceFallback) && view) {
        const { state } = view;
        if (!state.selection.ranges.some((range) => !range.empty)) {
          return notify(t('Select text to format markup.'));
        }
        const transaction = state.changeByRange((range) => {
          if (range.empty) {
            return { range };
          }
          const text = state.sliceDoc(range.from, range.to);
          const formatted = standardizeAll(text);
          return formatted === text
            ? { range }
            : {
                changes: { from: range.from, to: range.to, insert: formatted },
                range: EditorSelection.range(range.from, range.from + formatted.length),
              };
        });
        view.dispatch(transaction);
        view.focus();
        return;
      }
      return notify(t('Switch to an editing mode to format markup.'));
    },
    openGraph: tabs.openGraph,
    openSettings: actions.settings,
    openWorkspaceSettings: () => setModal({ type: 'settings', section: 'workspace' }),
    openExtensionsSettings: () => setModal({ type: 'settings', section: 'extensions' }),
    toggleLeft: () => setShowLeft((s) => !s),
    toggleRight: () => setShowRight((s) => !s),
    openSpeechDoc: async () => {
      try {
        if (v.contents[speechDoc] !== undefined && !speechDocuments.includes(speechDoc)) {
          throw new Error(t('Select a marked speech document before sending cards.'));
        }
        const path = await ensureSpeechDoc(speechDoc);
        if (path) {
          open(path, true);
        }
      } catch (error) {
        notify(error.message);
      }
    },
    newSpeechDoc: async () => {
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
      const p = await createAndOpen(
        `Speech Docs/Speech ${stamp}.md`,
        markSpeechDocument(`# Speech – ${stamp}\n\n`)
      );
      if (p) {
        updateSettings({ speechDoc: p });
      }
    },
    switchVault: v.chooseVault,
    createSample: v.createSample,
    reload: v.reload,
    toggleMode: () =>
      setMode(
        activePath && (isCanvas(activePath) || isFlow(activePath))
          ? mode === 'edit'
            ? 'visual'
            : 'edit'
          : mode !== 'read'
            ? 'read'
            : defaultEditorMode(settings, activePath)
      ),
    sourceMode: () => setMode('edit'),
    visualMode: () => setMode('visual'),
    exportNote: () =>
      activePath && isMarkdown(activePath)
        ? setModal({ type: 'export' })
        : notify(t('Export is available for Markdown notes and speech documents.')),
    testHypothesis: () => {
      if (!activePath || !isMarkdown(activePath)) {
        return notify(t('Open a Markdown note to test a hypothesis.'));
      }
      const view = editorRef.current;
      const source = (mode === 'edit' || sourceFallback) && view;
      const sources = {
        selection: source
          ? view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)
          : '',
        card: source
          ? getSectionAt(activeContent || '', cursorRef.current)?.text
          : mode === 'visual' && visualRef.current
            ? visualSelection(visualRef.current)
            : '',
        note: activeContent || '',
      };
      return setModal({ type: 'hypothesis', sources });
    },
    summarize: (path, content) => {
      if (!path || !isMarkdown(path)) {
        return notify(t('Open a Markdown document to summarize it.'));
      }
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
      if (mode === 'read') {
        return notify(t('Switch to an editing mode and place the cursor in a card'));
      }
      const view = editorRef.current;
      if ((mode === 'edit' || sourceFallback) && view) {
        const { from, to, head } = view.state.selection.main;
        return sendCard(head, view.state.sliceDoc(from, to));
      }
      return sendCard();
    },
    setCurrentAsSpeechDoc: () => actions.setSpeechDoc(activePath),
    renameCurrent: () =>
      activePath &&
      actions.rename({ type: 'file', path: activePath, name: activePath.split('/').pop() }),
    deleteCurrent: () =>
      activePath &&
      actions.remove({ type: 'file', path: activePath, name: activePath.split('/').pop() }),
    revealCurrent: () => activePath && v.reveal(activePath),
    closeTab: () => tabs.activeId && tabs.close(tabs.activeId),
  };
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const vaultRef = useRef(v.vault);
  vaultRef.current = v.vault;
  const extRef = useRef(ext);
  extRef.current = ext;
  useEffect(
    () =>
      window.api.onMenuCommand((command) => {
        const vaultless = [
          'switchVault',
          'openSettings',
          'createCitation',
          'openExtensionsSettings',
        ];
        if (vaultRef.current || vaultless.includes(command)) {
          ctxRef.current[command]?.();
        }
      }),
    []
  );
  useEffect(() => {
    window.api.setKeybindings(settings.keybindings).catch((error) => notify(error.message));
  }, [settings.keybindings, notify]);
  const uriRef = useRef({});
  uriRef.current = { paths, contents: v.contents, open, notify };
  useEffect(() => {
    if (!v.initialized) {
      return;
    }
    let draining = false;
    let disposed = false;
    const drain = async () => {
      if (draining || disposed) {
        return;
      }
      draining = true;
      try {
        let link;
        while (!disposed && (link = await window.api.nextUri())) {
          const { paths: known, contents, open: openNote, notify: say } = uriRef.current;
          if (!known.includes(link.path)) {
            say(t('Link target not found in this vault: {path}', { path: link.path }));
            continue;
          }
          openNote(link.path);
          if (link.heading) {
            const h = outline(contents[link.path] || '').find(
              (x) => slugify(x.text) === slugify(link.heading)
            );
            setJump({
              path: link.path,
              heading: link.heading,
              line: h?.line ?? null,
              n: Date.now(),
            });
          }
        }
      } catch (error) {
        notify(error.message);
      } finally {
        draining = false;
      }
    };
    const unsubscribe = window.api.onUriAvailable(drain);
    drain();
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [v.initialized, notify, t, setJump]);
  const mcpRef = useRef({});
  mcpRef.current = { reload: v.reload, open };
  useEffect(() => {
    const offChanged = window.api.onVaultChanged(() => mcpRef.current.reload());
    const offOpen = window.api.onMcpOpen(async (path) => {
      await mcpRef.current.reload();
      mcpRef.current.open(path);
    });
    return () => {
      offChanged();
      offOpen();
    };
  }, []);
  const keybindingContext = useMemo(
    () => ({ overrides: settings.keybindings, extra: ext.commands }),
    [settings.keybindings, ext.commands]
  );

  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.isComposing || modal) {
        return;
      }
      const c = ctxRef.current;
      const command = KEYBINDINGS.find(
        (item) => item.scope === 'app' && matchesBinding(e, binding(item.id, settings.keybindings))
      );
      if (
        command &&
        (!command.note || c.hasNote) &&
        (!command.markdown || c.isMarkdown) &&
        (v.vault || ['settings', 'citation', 'vault-open'].includes(command.id))
      ) {
        e.preventDefault();
        c[command.action]?.();
        return;
      }
      if (command) {
        return;
      }
      // Built-in shortcuts win over extension defaults that happen to collide.
      const contributed =
        v.vault &&
        extRef.current.commands.find((item) =>
          matchesBinding(e, binding(item.id, settings.keybindings, extRef.current.commands))
        );
      if (contributed) {
        e.preventDefault();
        extRef.current.run(contributed);
      }
    };
    // App navigation takes precedence over editor-specific shortcuts (e.g. Tiptap's Ctrl+E).
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [v.vault, settings.keybindings, modal]);

  const commands = [
    ...buildCommands(ctx, settings.keybindings),
    ...ext.commands.map((item) => ({
      id: item.id,
      label: item.label,
      run: () => ext.run(item),
      hotkey: displayBinding(binding(item.id, settings.keybindings, ext.commands)),
    })),
  ];
  ctx.openCommands = () =>
    setModal({
      type: 'palette',
      placeholder: t('Type a command…'),
      items: commands,
      onSelect: (cmd) => cmd.run(),
    });
  return { ctx, keybindingContext };
}
