import { memo, useCallback, useId, useState } from 'react';
import { resolveCanvasLink, suggestCanvasFiles } from '../../lib/canvas.js';
import { useI18n } from '../../lib/i18n.js';
import { resolveLink } from '../../lib/vault.js';
import CanvasFilePreview from '../CanvasFilePreview.jsx';
import Icon from '../Icon.jsx';
import Preview from '../Preview.jsx';
import { nodeColor } from './canvasUtils.js';

const CanvasNode = memo(function CanvasNode({
  node, selected, order, onSelect, onUpdate, onRemove, onOpenFile, onOpenUrl, onOpenLink,
  onStartGesture, onContextMenu, paths, contents,
}) {
  const { t } = useI18n();
  const accent = nodeColor(node.color);
  const fileListId = useId();
  const [editingText, setEditingText] = useState(node.type === 'text' && !node.text);
  const resolve = useCallback((target) => resolveLink(target, paths), [paths]);
  const link = node.type === 'link' ? resolveCanvasLink(node.url, paths) : null;
  const openLinkNode = () => {
    if (link?.type === 'file') onOpenFile(link.path, link.heading ? `#${link.heading}` : undefined);
    else if (link?.type === 'web') onOpenUrl(link.url);
  };
  return (
    <article
      className={`canvas-node canvas-node-${node.type}${selected ? ' selected' : ''}`}
      data-node-id={node.id}
      tabIndex={0} aria-label={t('Canvas node: {type}', { type: t(node.type) })}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(node.id);
          return;
        }
        if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onContextMenu({ clientX: rect.left + 16, clientY: rect.top + 16 }, node.id);
        }
      }}
      style={{
        left: node.x, top: node.y, width: node.width, height: node.height,
        zIndex: order + 2, '--canvas-node-accent': accent,
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (!event.target.closest('input, textarea, button, a, [contenteditable="true"]')) {
          event.currentTarget.focus({ preventScroll: true });
          onSelect(node.id);
        }
      }}
    >
      <header className="canvas-node-header" data-drag-handle
        onPointerDown={(event) => {
          if (event.button !== 0 || event.target.closest('button, input')) return;
          event.preventDefault();
          onStartGesture(event, { id: node.id, type: 'move' });
        }}>
        <span>{t(node.type)}</span>
        {node.type === 'text' && selected && <button className="link-btn"
          onClick={(event) => { event.stopPropagation(); setEditingText((editing) => !editing); }}>
          {editingText ? t('Preview text') : t('Edit text')}
        </button>}
        {selected && <button className="icon-btn" aria-label={t('Delete node')} title={t('Delete node')}
          onClick={(event) => { event.stopPropagation(); onRemove(node.id); }}>
          <Icon name="x" size={12} />
        </button>}
      </header>
      <div className="canvas-node-content">
        {node.type === 'text' && (editingText
          ? <textarea aria-label={t('Canvas text')} value={node.text}
            onChange={(event) => onUpdate(node.id, { text: event.target.value })} />
          : <Preview className="canvas-node-preview" content={node.text} resolve={resolve}
            onOpenLink={onOpenLink} onTagClick={() => { }} />)}
        {node.type === 'file' && <>
          <input aria-label={t('File path')} placeholder={t('Vault-relative file path')} value={node.file} list={fileListId}
            onChange={(event) => onUpdate(node.id, { file: event.target.value })} />
          <datalist id={fileListId}>{suggestCanvasFiles(paths, node.file)
            .map((path) => <option key={path} value={path} />)}</datalist>
          {node.subpath !== undefined && <input aria-label={t('File subpath')} value={node.subpath}
            onChange={(event) => onUpdate(node.id, { subpath: event.target.value })} />}
          <button className="link-btn canvas-open-file" disabled={!resolveLink(node.file, paths)}
            onClick={() => {
              const path = resolveLink(node.file, paths);
              if (path) onOpenFile(path, node.subpath);
            }}>{node.file || t('Open file')}</button>
          <CanvasFilePreview path={resolveLink(node.file, paths)} subpath={node.subpath}
            contents={contents} paths={paths} onOpenLink={onOpenLink} />
        </>}
        {node.type === 'link' && <>
          <input aria-label={t('URL')} placeholder={t('Web URL or vault file path')} value={node.url}
            onChange={(event) => onUpdate(node.id, { url: event.target.value })} />
          <button className="link-btn canvas-open-file" disabled={!link}
            onClick={openLinkNode}>{link?.label || node.url || t('Open link')}</button>
          {!!node.url && !link && <span className="error-text" role="status">{t('Link target not found or unsupported.')}</span>}
        </>}
        {node.type === 'group' && <>
          <input aria-label={t('Group label')} placeholder={t('Group label')} value={node.label || ''}
            onChange={(event) => onUpdate(node.id, { label: event.target.value })} />
          <span className="canvas-group-hint">{t('Place other nodes over this group to organize them.')}</span>
        </>}
      </div>
      {selected && <button className="canvas-resize-handle" aria-label={t('Resize node')}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          onStartGesture(event, { id: node.id, type: 'resize', width: node.width, height: node.height });
        }} />}
    </article>
  );
});

export default CanvasNode;
