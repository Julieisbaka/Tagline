import { useState } from 'react';
import FileTree from './FileTree.jsx';
import Icon from './Icon.jsx';
import { dirName, joinPath } from '../lib/vault.js';
import Menu from './ContextMenu.jsx';
import { useI18n } from '../lib/i18n.js';

function ContextMenu({ menu, onClose, actions }) {
  const { node } = menu;
  const isFolder = node.type === 'folder';
  const items = isFolder
    ? [
        ['New note', () => actions.newNote(node.path)],
        ['New flow', () => actions.newFlow(node.path)],
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
        ['Rename…', () => actions.rename(node)],
        ...(node.path.endsWith('.md') ? [['Set as speech doc', () => actions.setSpeechDoc(node.path)]] : []),
        ['Reveal in file explorer', () => actions.reveal(node.path)],
        ['Delete', () => actions.remove(node)],
      ];
  return (
    <Menu x={menu.x} y={menu.y} onClose={onClose}
      items={items.map(([label, run]) => ({ label, run, danger: label === 'Delete' }))} />
  );
}

export default function Sidebar({ vault, tree, activePath, actions }) {
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
      <div className="sidebar-header">
        <button className="icon-btn" title={t('New note')} onClick={() => actions.newNote(activeDir)}>
          <Icon name="file-plus" />
        </button>
        <button className="icon-btn" title={t('New flow')} onClick={() => actions.newFlow(activeDir)}>
          <Icon name="flow" />
        </button>
        <button className="icon-btn" title={t('New folder')} onClick={() => actions.newFolder(activeDir)}>
          <Icon name="folder-plus" />
        </button>
        <button className="icon-btn" title={t('Refresh')} onClick={actions.reload}>
          <Icon name="refresh" />
        </button>
      </div>
      <FileTree
        tree={tree}
        activePath={activePath}
        onOpen={actions.open}
        onContext={(e, node) => setMenu({ x: e.clientX, y: e.clientY, node })}
        onDropMove={onDropMove}
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
  const ext = node.type === 'file' ? node.path.match(/\.(md|flow)$/i)?.[0] || '' : '';
  const clean = newName.replace(/[\\/:*?"<>|]/g, '-').replace(new RegExp(`${ext.replace('.', '\\.')}$`, 'i'), '');
  return joinPath(dirName(node.path), clean + ext);
}
