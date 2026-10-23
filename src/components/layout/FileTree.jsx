import { useState } from 'react';
import { useI18n } from '../../lib/i18n.js';
import { displayName, isCanvas, isFlow } from '../../lib/vault.js';
import Icon from '../Icon.jsx';

function TreeNode({ node, depth, activePath, expanded, toggle, onOpen, onContext, onDropMove, spaced, hideFlowExtension, showMarkdownExtension }) {
  // Folder underscores are an on-disk detail; show them as spaces only when the setting creates them.
  const show = (name) => (spaced ? name.replace(/_/g, ' ') : name);
  const isFolder = node.type === 'folder';
  const open = expanded.has(node.path);
  const [dragOver, setDragOver] = useState(false);

  const dropProps = isFolder
    ? {
      onDragOver: (e) => {
        e.preventDefault();
        setDragOver(true);
      },
      onDragLeave: () => setDragOver(false),
      onDrop: (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        const from = e.dataTransfer.getData('text/vault-path');
        if (from) onDropMove(from, node.path);
      },
    }
    : {};

  return (
    <div>
      <div
        className={`tree-item${activePath === node.path ? ' active' : ''}${dragOver ? ' drag-over' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable
        onDragStart={(e) => e.dataTransfer.setData('text/vault-path', node.path)}
        onClick={(e) => (isFolder ? toggle(node.path) : onOpen(node.path, e.ctrlKey || e.metaKey))}
        onContextMenu={(e) => {
          e.preventDefault();
          onContext(e, node);
        }}
        title={node.path.split('/').map((s, i, a) => isFolder || i < a.length - 1 ? show(s) : s).join('/')}
        {...dropProps}
      >
        {isFolder ? (
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        ) : (
          <Icon name={isFlow(node.path) ? 'flow' : isCanvas(node.path) ? 'canvas' : 'file'} size={12} />
        )}
        <span className="tree-label">{isFolder ? show(node.name) : displayName(node.path, hideFlowExtension, showMarkdownExtension)}</span>
      </div>
      {isFolder &&
        open &&
        node.children.map((c) => (
          <TreeNode
            key={c.path}
            node={c}
            depth={depth + 1}
            activePath={activePath}
            expanded={expanded}
            toggle={toggle}
            onOpen={onOpen}
            onContext={onContext}
            onDropMove={onDropMove}
            spaced={spaced}
            hideFlowExtension={hideFlowExtension}
            showMarkdownExtension={showMarkdownExtension}
          />
        ))}
    </div>
  );
}

export default function FileTree({ tree, activePath, onOpen, onContext, onDropMove, spaced = false, hideFlowExtension = true, showMarkdownExtension = false }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(() => new Set(JSON.parse(localStorage.getItem('expanded') || '[]')));
  const toggle = (p) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      localStorage.setItem('expanded', JSON.stringify([...next]));
      return next;
    });
  };

  return (
    <div
      className="file-tree"
      onContextMenu={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          onContext(e, { type: 'folder', path: '', name: 'root' });
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const from = e.dataTransfer.getData('text/vault-path');
        if (from) onDropMove(from, '');
      }}
    >
      {tree.map((n) => (
        <TreeNode
          key={n.path}
          node={n}
          depth={0}
          activePath={activePath}
          expanded={expanded}
          toggle={toggle}
          onOpen={onOpen}
          onContext={onContext}
          onDropMove={onDropMove}
          spaced={spaced}
          hideFlowExtension={hideFlowExtension}
          showMarkdownExtension={showMarkdownExtension}
        />
      ))}
      {tree.length === 0 && <div className="empty-hint">{t('No notes yet. Create one with the buttons above.')}</div>}
    </div>
  );
}
