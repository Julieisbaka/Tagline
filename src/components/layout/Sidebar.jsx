import { useMemo, useState } from 'react';
import { useI18n } from '../../lib/i18n.js';
import { folderPaths } from '../../lib/folderPaths.js';
import { dirName, displayName, isMarkdown, joinPath } from '../../lib/vault.js';
import { FILE_ACTIONS } from '../../lib/workspaceItems.js';
import Menu from '../dialogs/ContextMenu.jsx';
import Icon from '../Icon.jsx';
import RefreshButton from '../RefreshButton.jsx';
import ConfigurableBar from './ConfigurableBar.jsx';
import ExtensionPanelList from './ExtensionPanelList.jsx';
import FileTree from './FileTree.jsx';

function ContextMenu({ menu, onClose, actions, favorites, extensions }) {
  const { node } = menu;
  const isFolder = node.type === 'folder';
  const items = isFolder
    ? [
        ['New note', () => actions.newNote(node.path), 'new-note'],
        ['New flow', () => actions.newFlow(node.path), 'new-flow'],
        ['New canvas', () => actions.newCanvas(node.path), 'new-canvas'],
        ['New folder', () => actions.newFolder(node.path), 'new-folder'],
        ...(node.path
          ? [
              [
                favorites.paths.includes(node.path) ? 'Unpin folder' : 'Pin folder',
                () => favorites.toggle(node.path),
              ],
              ['Rename…', () => actions.rename(node)],
              ['Reveal in file explorer', () => actions.reveal(node.path)],
              ['Delete', () => actions.remove(node)],
            ]
          : []),
      ]
    : [
        ['Open in new tab', () => actions.open(node.path, true)],
        ['Copy note path', () => actions.copyNotePath(node.path)],
        ['Copy Tagline link', () => actions.copyNoteLink(node.path)],
        ...(isMarkdown(node.path)
          ? [
              [
                favorites.paths.includes(node.path) ? 'Unpin note' : 'Pin note',
                () => favorites.toggle(node.path),
              ],
            ]
          : []),
        ['Rename…', () => actions.rename(node)],
        ...(isMarkdown(node.path)
          ? [['Set as speech doc', () => actions.setSpeechDoc(node.path)]]
          : []),
        ['Reveal in file explorer', () => actions.reveal(node.path)],
        ['Delete', () => actions.remove(node)],
      ];
  const context = {
    path: isFolder ? null : node.path,
    selection: null,
    uri: isFolder ? null : `tagline://note/${encodeURIComponent(node.path)}`,
  };
  const contributed = extensions?.contextMenuItems('file-explorer', context) || [];
  return (
    <Menu
      x={menu.x}
      y={menu.y}
      onClose={onClose}
      items={[
        ...items.map(([label, run, command]) => ({
          label,
          run,
          command,
          danger: label === 'Delete',
        })),
        ...(contributed.length ? [{ separator: true }, ...contributed] : []),
      ]}
    />
  );
}

export default function Sidebar({
  vault,
  tree,
  paths,
  favorites,
  activePath,
  actions,
  settings,
  updateSettings,
  spacedFolders = false,
  hideFlowExtension = true,
  showMarkdownExtension = false,
  extensions,
  mode,
}) {
  const { t } = useI18n();
  const [menu, setMenu] = useState(null);
  const [revealPath, setRevealPath] = useState(null);
  const activeDir = activePath ? dirName(activePath) : '';
  const folders = useMemo(() => new Set(folderPaths(tree)), [tree]);
  const available = useMemo(() => new Set([...paths, ...folders]), [paths, folders]);
  const pinned = favorites.paths.filter((path) => available.has(path));
  const folderLabel = (path) => {
    const name = path.split('/').pop();
    return spacedFolders ? name.replace(/_/g, ' ') : name;
  };

  const onDropMove = (from, toDir) => {
    const name = from.split('/').pop();
    const to = joinPath(toDir, name);
    if (to === from || toDir === from || toDir.startsWith(from + '/')) {
      return;
    }
    actions.move(from, to);
  };

  return (
    <aside className='sidebar'>
      <ConfigurableBar
        className='sidebar-header'
        label='File manager actions'
        catalog={FILE_ACTIONS}
        value={settings.fileManagerItems}
        onChange={(fileManagerItems) => updateSettings({ fileManagerItems })}
        renderItem={(id) => {
          if (id === 'refresh') {
            return <RefreshButton onRefresh={actions.reload} />;
          }
          const item = FILE_ACTIONS.find((item) => item.id === id);
          return (
            <button
              className='icon-btn'
              title={t(item.title)}
              aria-label={t(item.title)}
              onClick={() => actions[id](activeDir)}
            >
              <Icon name={item.icon} />
            </button>
          );
        }}
      />
      {pinned.length > 0 && (
        <section className='pinned-notes' aria-label={t('Pinned items')}>
          <div className='pinned-notes-heading'>{t('Pinned items')}</div>
          {pinned.map((path) => {
            const isFolder = folders.has(path);
            return (
              <div className='pinned-note' key={path}>
                <button
                  type='button'
                  className={`pinned-note-open${path === activePath ? ' active' : ''}`}
                  title={isFolder ? `${path} — ${t('Show in file tree')}` : path}
                  onClick={(event) =>
                    isFolder
                      ? setRevealPath({ path })
                      : actions.open(path, event.ctrlKey || event.metaKey)
                  }
                >
                  <Icon name={isFolder ? 'folder' : 'pin'} size={12} />
                  <span>
                    {isFolder
                      ? folderLabel(path)
                      : displayName(path, hideFlowExtension, showMarkdownExtension)}
                  </span>
                </button>
                <button
                  type='button'
                  className='pinned-note-remove'
                  title={t(isFolder ? 'Unpin folder' : 'Unpin note')}
                  aria-label={t('Unpin {name}', { name: path })}
                  onClick={() => favorites.toggle(path)}
                >
                  <Icon name='x' size={12} />
                </button>
              </div>
            );
          })}
        </section>
      )}
      <FileTree
        tree={tree}
        activePath={activePath}
        onOpen={actions.open}
        onContext={(e, node) => setMenu({ x: e.clientX, y: e.clientY, node })}
        onDropMove={onDropMove}
        revealPath={revealPath}
        spaced={spacedFolders}
        hideFlowExtension={hideFlowExtension}
        showMarkdownExtension={showMarkdownExtension}
      />
      <ExtensionPanelList
        extensions={extensions}
        placement='sidebar-bottom'
        activePath={activePath}
        mode={mode}
      />
      <div className='sidebar-footer' title={vault.root}>
        <button className='vault-switch' onClick={actions.switchVault}>
          <Icon name='vault' size={14} /> {vault.name}
        </button>
      </div>
      {menu && (
        <ContextMenu
          menu={menu}
          onClose={() => setMenu(null)}
          actions={actions}
          favorites={favorites}
          extensions={extensions}
        />
      )}
    </aside>
  );
}

// Sanitize a user-supplied name for the vault. '/' is kept as a folder
// separator so 'x/y' nests under 'x'; other Windows-illegal characters become '-'.
export function sanitizeName(name) {
  return name
    .split('/')
    .map((part) => part.replace(/[\\:*?"<>|]/g, '-'))
    .join('/');
}

export function renameTarget(node, newName) {
  const ext = node.type === 'file' ? node.path.match(/\.(md|flow|canvas|json)$/i)?.[0] || '' : '';
  const clean = sanitizeName(newName).replace(new RegExp(`${ext.replace('.', '\\.')}$`, 'i'), '');
  return joinPath(dirName(node.path), clean + ext);
}
