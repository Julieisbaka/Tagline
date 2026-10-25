import { useState } from 'react';
import { useI18n } from '../../lib/i18n.js';
import { dirName, isMarkdown, joinPath } from '../../lib/vault.js';
import { FILE_ACTIONS } from '../../lib/workspaceItems.js';
import Menu from '../dialogs/ContextMenu.jsx';
import Icon from '../Icon.jsx';
import RefreshButton from '../RefreshButton.jsx';
import ConfigurableBar from './ConfigurableBar.jsx';
import FileTree from './FileTree.jsx';

function ContextMenu({ menu, onClose, actions }) {
  const { node } = menu;
  const isFolder = node.type === 'folder';
  const items = isFolder
    ? [
      ['New note', () => actions.newNote(node.path)],
      ['New flow', () => actions.newFlow(node.path)],
      ['New canvas', () => actions.newCanvas(node.path)],
      ['New folder', () => actions.newFolder(node.path)],
      ...(node.path
        ? [
          ['Rename…', () => actions.rename(node)],
          ['Reveal in file explorer', () => actions.reveal(node.path)],
          ['Delete', () => actions.remove(node)],
        ]
        : []),
    ]
    : [
      ['Open in new tab', () => actions.open(node.path, true)],
      ['Copy note path', () => actions.copyNotePath(node.path)],
      ['Rename…', () => actions.rename(node)],
      ...(isMarkdown(node.path) ? [['Set as speech doc', () => actions.setSpeechDoc(node.path)]] : []),
      ['Reveal in file explorer', () => actions.reveal(node.path)],
      ['Delete', () => actions.remove(node)],
    ];
  return (
    <Menu x={menu.x} y={menu.y} onClose={onClose}
      items={items.map(([label, run]) => ({ label, run, danger: label === 'Delete' }))} />
  );
}

export default function Sidebar({ vault, tree, activePath, actions, settings, updateSettings, spacedFolders = false, hideFlowExtension = true, showMarkdownExtension = false }) {
  const { t } = useI18n();
  const [menu, setMenu] = useState(null);
  const activeDir = activePath ? dirName(activePath) : '';

  const onDropMove = (from, toDir) => {
    const name = from.split('/').pop();
    const to = joinPath(toDir, name);
    if (to === from || toDir === from || toDir.startsWith(from + '/')) return;
    actions.move(from, to);
  };

  return (
    <aside className="sidebar">
      <ConfigurableBar className="sidebar-header" label="File manager actions" catalog={FILE_ACTIONS}
        value={settings.fileManagerItems} onChange={(fileManagerItems) => updateSettings({ fileManagerItems })}
        renderItem={(id) => {
          if (id === 'refresh') return <RefreshButton onRefresh={actions.reload} />;
          const item = FILE_ACTIONS.find((item) => item.id === id);
          return <button className="icon-btn" title={t(item.title)} aria-label={t(item.title)}
            onClick={() => actions[id](activeDir)}><Icon name={item.icon} /></button>;
        }} />
      <FileTree
        tree={tree}
        activePath={activePath}
        onOpen={actions.open}
        onContext={(e, node) => setMenu({ x: e.clientX, y: e.clientY, node })}
        onDropMove={onDropMove}
        spaced={spacedFolders}
        hideFlowExtension={hideFlowExtension}
        showMarkdownExtension={showMarkdownExtension}
      />
      <div className="sidebar-footer" title={vault.root}>
        <button className="vault-switch" onClick={actions.switchVault}>
          <Icon name="vault" size={14} /> {vault.name}
        </button>
      </div>
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} actions={actions} />}
    </aside>
  );
}

export function renameTarget(node, newName) {
  const ext = node.type === 'file' ? node.path.match(/\.(md|flow|canvas)$/i)?.[0] || '' : '';
  const clean = newName.replace(/[\\/:*?"<>|]/g, '-').replace(new RegExp(`${ext.replace('.', '\\.')}$`, 'i'), '');
  return joinPath(dirName(node.path), clean + ext);
}
