import { baseName, dirName, displayName, isMarkdown } from '../../lib/vault.js';
import { binding, displayBinding } from '../../lib/keybindings.js';
import Sidebar, { renameTarget } from './Sidebar.jsx';
import TabBar from './TabBar.jsx';
import NoteView from '../NoteView.jsx';
import GraphView from '../GraphView.jsx';
import RightPanel from './RightPanel.jsx';
import SearchModal from '../dialogs/SearchModal.jsx';
import ExportDialog from '../dialogs/ExportDialog.jsx';
import ImportDialog from '../dialogs/ImportDialog.jsx';
import CitationDialog from '../dialogs/CitationDialog.jsx';
import HypothesisDialog from '../dialogs/HypothesisDialog.jsx';
import SummaryDialog from '../dialogs/SummaryDialog.jsx';
import HistoryDialog from '../dialogs/HistoryDialog.jsx';
import WebsiteView from '../dialogs/WebsiteView.jsx';
import Splitter from './Splitter.jsx';
import Welcome from '../dialogs/Welcome.jsx';
import VaultManagerDialog from '../dialogs/VaultManagerDialog.jsx';
import ExtensionSurface from '../ExtensionSurface.jsx';
import Ribbon from './Ribbon.jsx';
import { Palette, PromptDialog, SettingsDialog } from '../dialogs/Dialogs.jsx';

export default function AppLayout({ app }) {
  const {
    t, settings, updateSettings, v, tabs, paths, noteNames, resolve, activePath, activeContent,
    mode, sourceFallback, stats, setStats, showLeft, showRight, sidebarWidth, rightWidth, lastFile,
    website, setWebsite, modal, setModal, jump, setJump, highlightOnly, setHighlightOnly, toast, ext, ctx, actions,
    open, openLink, sendCard, setMode, editorRef, visualRef, cursorRef, createAndOpen, doRename,
    notify, insertCitation, setVisualEditor,
  } = app;
  const settingsDialog = <SettingsDialog settings={settings} update={updateSettings} extensions={ext}
    onClose={() => setModal(null)} />;
  const websiteView = website && !modal &&
    <WebsiteView key={website} url={website} onClose={() => setWebsite(null)} />;
  const extensionWebviews = ext.surfaces.filter((surface) => surface.kind === 'webviews' && surface.visible)
    .map((surface) => <div className="modal-backdrop" key={`${surface.host.manifest.id}:${surface.id}`}>
      <div className="modal dialog extension-webview-dialog" role="dialog" aria-modal="true" aria-label={surface.title}
        onKeyDown={(event) => { if (event.key === 'Escape') ext.closeSurface(surface); }}>
        <header><h3>{surface.title}</h3><button onClick={() => ext.closeSurface(surface)}>{t('Close')}</button></header>
        <ExtensionSurface surface={surface} onClose={ext.closeSurface} />
      </div>
    </div>);

  if (!v.vault) return <>
    {window.api.platform === 'darwin' && <div className="mac-titlebar">Tagline</div>}
    <Welcome onOpen={v.chooseVault} onSample={v.createSample} onManage={() => setModal({ type: 'vaults' })} error={v.error} />
    {modal?.type === 'settings' && settingsDialog}
    {modal?.type === 'vaults' && <VaultManagerDialog onOpen={v.openRecentVault} onChoose={v.chooseVault} onSample={v.createSample}
      onClose={() => setModal(null)} />}
    {modal?.type === 'citation' && <CitationDialog onClose={() => setModal(null)} />}
    {websiteView && <div className="welcome-website">{websiteView}</div>}
    {extensionWebviews}
    {toast && <div className="toast">{toast}</div>}
  </>;

  const renderWorkspace = () => {
    const tab = tabs.activeTab;
    if (!tab) {
      return (
        <div className="empty-workspace">
          <h2>{t('No file is open')}</h2>
          <button className="link-btn" onClick={ctx.newNote}>{t('Create new note')} {displayBinding(binding('new-note', settings.keybindings))}</button>
          <button className="link-btn" onClick={ctx.openSwitcher}>{t('Go to file')} {displayBinding(binding('switcher', settings.keybindings))}</button>
          <button className="link-btn" onClick={ctx.openGraph}>{t('Open graph view')} {displayBinding(binding('graph', settings.keybindings))}</button>
          <button className="link-btn" onClick={ctx.openCommands}>{t('Command palette')} {displayBinding(binding('commands', settings.keybindings))}</button>
          <button className="link-btn" onClick={ctx.importDocument}>{t('Import document with Pandoc')}</button>
        </div>
      );
    }
    if (tab.kind === 'graph') return <GraphView index={v.index} contents={v.contents} activePath={lastFile} onOpen={open}
      onUpdateContent={v.updateContent}
      showMarkdownExtension={settings.showMarkdownExtension} />;
    if (activeContent === undefined) return <div className="empty-workspace" role="status">
      {v.ready ? <>
        <p>{t('This file is no longer in the vault: {path}', { path: activePath })}</p>
        <button onClick={v.reload}>{t('Reload vault')}</button>
        <button onClick={() => tabs.close(tab.id)}>{t('Close tab')}</button>
      </> : t('Loading…')}
    </div>;
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
        onTagClick={(tag) => setModal({ type: 'search', query: `tag:${tag} ` })}
        onSendCard={sendCard}
        onCursor={(pos) => (cursorRef.current = pos)}
        onCursorStats={setStats}
        onRename={(path, title) => doRename(path, renameTarget({ type: 'file', path }, title))}
        editorRef={editorRef}
        visualRef={visualRef}
        onVisualEditorReady={setVisualEditor}
        onExport={ctx.exportNote}
        onTestHypothesis={ctx.testHypothesis}
        onSummarize={() => ctx.summarize(activePath, activeContent)}
        onCreateCitation={ctx.createCitation}
        onOpenHistory={() => setModal({ type: 'history', path: tab.path })}
        settings={settings}
        onDismissVisualNotice={() => updateSettings({
          internalFlags: { ...settings.internalFlags, visualNoticeDismissed: true },
        })}
      />
    );
  };

  return (
    <div className={`app${window.api.platform === 'darwin' ? ' mac-app' : ''}`}
      style={{ '--sidebar-width': `${sidebarWidth}px`, '--right-panel-width': `${rightWidth}px` }}>
      {window.api.platform === 'darwin' && <div className="mac-titlebar">Tagline</div>}
      <Ribbon ctx={ctx} showLeft={showLeft} keybindings={settings.keybindings}
        settings={settings} updateSettings={updateSettings} />
      {showLeft && <Sidebar vault={v.vault} tree={v.tree} activePath={activePath} actions={actions}
        spacedFolders={settings.underscoreFolders} hideFlowExtension={settings.hideFlowExtension}
        showMarkdownExtension={settings.showMarkdownExtension} />}
      {showLeft && <Splitter panel="sidebarWidth" side="left" width={sidebarWidth} otherWidth={showRight ? rightWidth : 0}
        label="Resize file explorer" onChange={(value) => updateSettings({ sidebarWidth: value })} />}
      <main className="main">
        <TabBar tabs={tabs.tabs} activeId={tabs.activeId} onActivate={tabs.setActiveId} onClose={tabs.close}
          onCloseOthers={tabs.closeOthers} hideFlowExtension={settings.hideFlowExtension}
          showMarkdownExtension={settings.showMarkdownExtension} onFileAction={(action, path) => action === 'rename'
            ? actions.rename({ type: 'file', path, name: path.split('/').pop() }) : v.reveal(path)} />
        <div className="workspace">{renderWorkspace()}{websiteView}</div>
        <footer className="status-bar">
          {activePath && stats?.map((stat, i) => <span key={i}>{stat}</span>)}
          <span className="spacer" />
          <span title={t('Current speech document')} className="clickable" onClick={ctx.openSpeechDoc}>
            {t('Speech doc')}: {baseName(settings.speechDoc)}
          </span>
          {activePath && <span>{t(mode === 'edit' || sourceFallback ? 'Source editing' : mode === 'visual' ? 'Visual editing'
            : highlightOnly ? 'Reading (highlights)' : 'Reading')}</span>}
        </footer>
      </main>
      <div style={{ display: showRight ? 'contents' : 'none' }}>
        <Splitter panel="rightPanelWidth" side="right" width={rightWidth} otherWidth={showLeft ? sidebarWidth : 0}
          label="Resize side panel" onChange={(value) => updateSettings({ rightPanelWidth: value })} />
        <RightPanel
          extensions={ext}
          activePath={activePath}
          content={activeContent}
          index={v.index}
          contents={v.contents}
          onOpen={open}
          onJump={(heading) =>
            setJump({ path: activePath, line: heading.line, heading: heading.text, n: Date.now() })
          }
          onTagClick={(tag) => setModal({ type: 'search', query: `tag:${tag} ` })}
          settings={settings}
          updateSettings={updateSettings}
        />
      </div>

      {modal?.type === 'switcher' && (
        <Palette
          placeholder={t('Find or create a note…')}
          items={paths.map((path) => ({ id: path, label: displayName(path, settings.hideFlowExtension, settings.showMarkdownExtension), detail: dirName(path), path }))}
          onSelect={(item, event) => open(item.path, event?.ctrlKey || event?.metaKey)}
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
          showMarkdownExtension={settings.showMarkdownExtension}
          onOpen={open} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'prompt' && (
        <PromptDialog title={modal.title} initial={modal.initial} onSubmit={modal.onSubmit} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'settings' && settingsDialog}
      {modal?.type === 'vaults' && <VaultManagerDialog onOpen={v.openRecentVault} onChoose={v.chooseVault} onSample={v.createSample}
        onClose={() => setModal(null)} />}
      {modal?.type === 'export' && activePath && (
        <ExportDialog title={baseName(activePath)} content={activeContent || ''} resolve={resolve} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'import' && <ImportDialog onImport={createAndOpen} onClose={() => setModal(null)} />}
      {modal?.type === 'hypothesis' && <HypothesisDialog sources={modal.sources} onClose={() => setModal(null)} />}
      {modal?.type === 'summary' && <SummaryDialog title={modal.title} content={modal.content} onClose={() => setModal(null)} />}
      {modal?.type === 'history' && <HistoryDialog path={modal.path}
        onRestore={(content) => {
          v.updateContent(modal.path, content);
          setModal(null);
          notify(t('Revision restored; saving…'));
        }}
        onClose={() => setModal(null)} />}
      {modal?.type === 'citation' && <CitationDialog onInsert={activePath && isMarkdown(activePath) && mode !== 'read'
        ? insertCitation : null} onClose={() => setModal(null)} />}
      {toast && <div className="toast">{toast}</div>}
      {extensionWebviews}
    </div>
  );
}
