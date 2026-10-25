import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  canvasGroupMembers, createArgumentEdge, createCanvasId, createCanvasNode, moveCanvasNodes,
  parseCanvas, serializeCanvas, suggestCanvasFiles, resolveCanvasLink
} from '../lib/canvas.js';
import JsonEditor from './JsonEditor.jsx';
import JsonRecovery from './JsonRecovery.jsx';
import CanvasFilePreview from './CanvasFilePreview.jsx';
import ContextMenu from './dialogs/ContextMenu.jsx';
import { useI18n } from '../lib/i18n.js';
import { baseName, resolveLink } from '../lib/vault.js';
import Icon from './Icon.jsx';
import Preview from './Preview.jsx';
import { binding, KEYBINDINGS, matchesBinding } from '../lib/keybindings.js';

const PRESET_COLORS = [
  ['1', '#e06c75', 'Red'], ['2', '#d19a66', 'Orange'], ['3', '#e5c07b', 'Yellow'],
  ['4', '#98c379', 'Green'], ['5', '#56b6c2', 'Cyan'], ['6', '#c678dd', 'Purple'],
];

function nodeColor(color) {
  return color?.startsWith('#') ? color : PRESET_COLORS.find(([id]) => id === color)?.[1] || 'var(--border)';
}

function sidePoint(node, side) {
  if (side === 'top') return { x: node.x + node.width / 2, y: node.y };
  if (side === 'bottom') return { x: node.x + node.width / 2, y: node.y + node.height };
  if (side === 'left') return { x: node.x, y: node.y + node.height / 2 };
  return { x: node.x + node.width, y: node.y + node.height / 2 };
}

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

const CanvasEdges = memo(function CanvasEdges({ edges, nodes, selectedEdge, onSelect, onContextMenu }) {
  const { t } = useI18n();
  return <svg className="canvas-edges" width="100%" height="100%" aria-label={t('Canvas connections')}>
    <defs>{edges.map((item, index) => <marker key={item.id} id={`canvas-arrow-${index}`}
      markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"
      markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 z" fill={nodeColor(item.color)} /></marker>)}</defs>
    {edges.map((item, index) => {
      const from = nodes.get(item.fromNode), to = nodes.get(item.toNode);
      if (!from || !to) return null;
      const a = sidePoint(from, item.fromSide || 'right');
      const b = sidePoint(to, item.toSide || 'left');
      return <g key={item.id} data-edge-id={item.id} className={item.id === selectedEdge ? 'selected' : ''}
        tabIndex={0} role="button" aria-label={item.label || t('Canvas connection')}
        onKeyDown={(event) => {
          if (['ContextMenu', 'Enter', ' '].includes(event.key) || (event.key === 'F10' && event.shiftKey)) {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            onContextMenu({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }, null, item.id);
          }
        }}
        onClick={(event) => { event.stopPropagation(); onSelect(item.id); }}>
        <line className="canvas-edge-hit" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        <line className="canvas-edge-line" x1={a.x} y1={a.y} x2={b.x} y2={b.y}
          stroke={nodeColor(item.color)}
          markerStart={item.fromEnd === 'arrow' ? `url(#canvas-arrow-${index})` : undefined}
          markerEnd={(item.toEnd || 'arrow') === 'arrow' ? `url(#canvas-arrow-${index})` : undefined} />
        {item.label && <text className="canvas-edge-label" x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 6}>{item.label}</text>}
      </g>;
    })}
  </svg>;
});

function CanvasBoard({ canvas, onChange, paths, contents, onOpenFile, onOpenUrl, onOpenLink, onEditSource, t, keybindings }) {
  const gestureRef = useRef(null);
  const gestureFrame = useRef(0);
  const viewportRef = useRef(null);
  const [gesture, setGesture] = useState(null);
  const [camera, setCamera] = useState(() => ({
    x: 240 - Math.min(0, ...canvas.nodes.map((item) => item.x)),
    y: 180 - Math.min(0, ...canvas.nodes.map((item) => item.y)),
    k: 1,
  }));
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [connectionStart, setConnectionStart] = useState(null);
  const [relationType, setRelationType] = useState('connection');
  const [menu, setMenu] = useState(null);
  const suppressClick = useRef(false);
  const liveActions = useRef({});
  useEffect(() => {
    const action = (event) => liveActions.current[event.detail]?.();
    const key = (event) => {
      if (event.defaultPrevented || event.isComposing ||
          !event.target.closest('.canvas-editor') ||
          document.querySelector('[role="dialog"], .context-menu') ||
          event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        liveActions.current['canvas-cancel']();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        liveActions.current['canvas-delete']();
        return;
      }
      const command = KEYBINDINGS.find((item) => item.scope === 'canvas' &&
        matchesBinding(event, binding(item.id, keybindings)));
      if (command) { event.preventDefault(); liveActions.current[command.id]?.(); }
    };
    window.addEventListener('workspace-action', action);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('workspace-action', action);
      window.removeEventListener('keydown', key);
    };
  }, [keybindings]);
  const node = canvas.nodes.find((item) => item.id === selectedNode);
  const edge = canvas.edges.find((item) => item.id === selectedEdge);
  const zoom = (factor, point) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const anchor = point || { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
    setCamera((current) => {
      const k = Math.min(4, Math.max(0.2, current.k * factor));
      if (k === current.k) return current;
      return {
        k, x: anchor.x - (anchor.x - current.x) * k / current.k,
        y: anchor.y - (anchor.y - current.y) * k / current.k
      };
    });
  };
  useEffect(() => {
    const viewport = viewportRef.current;
    const wheel = (event) => {
      if (gestureRef.current || document.querySelector('.context-menu')) return;
      if (event.target.closest('textarea, input, .canvas-node-preview')) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = viewport.getBoundingClientRect();
        zoom(Math.exp(-event.deltaY * 0.002), { x: event.clientX - rect.left, y: event.clientY - rect.top });
      } else setCamera((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
    };
    viewport.addEventListener('wheel', wheel, { passive: false });
    return () => viewport.removeEventListener('wheel', wheel);
  }, []);
  useEffect(() => () => cancelAnimationFrame(gestureFrame.current), []);
  const renderedNodes = useMemo(() => {
    if (!gesture) return canvas.nodes;
    const moving = new Set(gesture.ids);
    return canvas.nodes.map((item) => {
      if (!moving.has(item.id)) return item;
      if (gesture.type === 'move') return { ...item, x: item.x + gesture.dx, y: item.y + gesture.dy };
      if (gesture.type === 'resize' && item.id === gesture.id) return {
        ...item, width: Math.max(180, Math.round(gesture.width + gesture.dx)),
        height: Math.max(100, Math.round(gesture.height + gesture.dy)),
      };
      return item;
    });
  }, [canvas.nodes, gesture]);
  const nodesById = useMemo(() => new Map(renderedNodes.map((item) => [item.id, item])), [renderedNodes]);
  const layers = useMemo(() => [
    {
      name: 'canvas-groups', nodes: renderedNodes.filter((item) => item.type === 'group')
        .sort((a, b) => b.width * b.height - a.width * a.height)
    },
    { name: 'canvas-nodes', nodes: renderedNodes.filter((item) => item.type !== 'group') },
  ], [renderedNodes]);

  const update = useCallback((next) => onChange(serializeCanvas(next)), [onChange]);
  const updateNode = useCallback((id, changes) => update({
    ...canvas,
    nodes: canvas.nodes.map((item) => item.id === id ? { ...item, ...changes } : item),
  }), [canvas, update]);
  const removeNode = useCallback((id) => {
    update({
      ...canvas, nodes: canvas.nodes.filter((item) => item.id !== id),
      edges: canvas.edges.filter((item) => item.fromNode !== id && item.toNode !== id)
    });
    setSelectedNode(null);
  }, [canvas, update]);
  const addNode = useCallback((type, position, wrapped = node) => {
    const nextNode = createCanvasNode(type, canvas.nodes.length);
    const viewport = viewportRef.current;
    const camera = cameraRef.current;
    Object.assign(nextNode, position || {
      x: Math.round((viewport.clientWidth / 2 - camera.x) / camera.k - nextNode.width / 2),
      y: Math.round((viewport.clientHeight / 2 - camera.y) / camera.k - nextNode.height / 2),
    });
    if (type === 'group' && wrapped) Object.assign(nextNode, {
      x: wrapped.x - 24, y: wrapped.y - 40, width: wrapped.width + 48, height: wrapped.height + 64,
    });
    update({ ...canvas, nodes: [...canvas.nodes, nextNode] });
    setSelectedNode(nextNode.id);
    setSelectedEdge(null);
  }, [canvas, node, update]);
  const contextMenu = useCallback((event, nodeId, edgeId, position) => {
    event.preventDefault?.();
    event.stopPropagation?.();
    const targetNode = canvas.nodes.find((item) => item.id === nodeId);
    const targetEdge = canvas.edges.find((item) => item.id === edgeId);
    const items = targetNode ? [
      ...(targetNode.type === 'file' ? [{
        label: 'Open file', disabled: !resolveLink(targetNode.file, paths),
        run: () => onOpenFile(resolveLink(targetNode.file, paths), targetNode.subpath)
      }] : []),
      ...(targetNode.type === 'link' ? [{
        label: 'Open link', disabled: !resolveCanvasLink(targetNode.url, paths),
        run: () => {
          const link = resolveCanvasLink(targetNode.url, paths);
          if (link.type === 'file') onOpenFile(link.path, link.heading ? `#${link.heading}` : undefined);
          else onOpenUrl(link.url);
        }
      }] : []),
      ...(targetNode.type !== 'group' ? [
        {
          label: 'Duplicate node', run: () => {
            const copy = { ...targetNode, id: createCanvasId(), x: targetNode.x + 32, y: targetNode.y + 32 };
            update({ ...canvas, nodes: [...canvas.nodes, copy] });
            setSelectedNode(copy.id);
          }
        },
        { label: 'Group node', run: () => addNode('group', undefined, targetNode) },
      ] : []),
      { label: 'Connect nodes', run: () => { setConnectionStart(targetNode.id); setConnecting(true); } },
      { label: 'Delete node', danger: true, run: () => removeNode(targetNode.id) },
    ] : targetEdge ? [
      {
        label: 'Reverse connection', run: () => update({
          ...canvas, edges: canvas.edges.map((item) =>
            item.id === targetEdge.id ? {
              ...item, fromNode: item.toNode, toNode: item.fromNode,
              fromSide: item.toSide || 'left', toSide: item.fromSide || 'right',
              fromEnd: item.toEnd || 'arrow', toEnd: item.fromEnd || 'none'
            } : item)
        })
      },
      {
        label: 'Delete connection', danger: true, run: () => {
          update({ ...canvas, edges: canvas.edges.filter((item) => item.id !== targetEdge.id) });
          setSelectedEdge(null);
        }
      },
    ] : ['text', 'file', 'link', 'group'].map((type) => ({
      label: t('Add {type}', { type: t(type) }), run: () => addNode(type, position, null),
    }));
    setSelectedNode(targetNode?.id || null);
    setSelectedEdge(targetEdge?.id || null);
    setMenu({ x: event.clientX, y: event.clientY, items: [...items, { label: 'Open JSON source', run: onEditSource }] });
  }, [canvas, paths, onOpenFile, onOpenUrl, update, addNode, removeNode, onEditSource, t]);
  const selectEdge = useCallback((id) => { setSelectedEdge(id); setSelectedNode(null); }, []);
  const selectNode = useCallback((id) => {
    if (connecting) {
      if (!connectionStart) {
        setConnectionStart(id);
        return;
      }
      if (connectionStart !== id) {
        const next = relationType !== 'connection'
          ? createArgumentEdge(connectionStart, id, relationType)
          : {
            id: createCanvasId(), fromNode: connectionStart, toNode: id,
            fromSide: 'right', toSide: 'left', toEnd: 'arrow'
          };
        update({ ...canvas, edges: [...canvas.edges, next] });
        setSelectedEdge(next.id);
        setSelectedNode(null);
      }
      setConnecting(false);
      setConnectionStart(null);
      return;
    }
    setSelectedNode(id);
    setSelectedEdge(null);
  }, [canvas, connecting, connectionStart, relationType, update]);
  const startGesture = useCallback((event, data) => {
    if (connecting && data.type === 'move') {
      selectNode(data.id);
      suppressClick.current = true;
      event.currentTarget.focus({ preventScroll: true });
      return;
    }
    const { id, type, width: nodeWidth, height: nodeHeight } = data;
    const next = {
      id, type, clientX: event.clientX, clientY: event.clientY,
      ids: [id, ...canvasGroupMembers(canvas.nodes, id)],
      width: nodeWidth, height: nodeHeight, dx: 0, dy: 0, camera: cameraRef.current,
    };
    gestureRef.current = next;
    event.currentTarget.setPointerCapture(event.pointerId);
    setMenu(null);
    setSelectedNode(id);
    setSelectedEdge(null);
    event.currentTarget.closest('[data-node-id]')?.focus({ preventScroll: true });
    setGesture(next);
  }, [canvas.nodes, connecting, selectNode]);
  const moveGesture = (event) => {
    const current = gestureRef.current;
    if (!current) return;
    const dx = event.clientX - current.clientX, dy = event.clientY - current.clientY;
    if (current.type === 'pan') {
      setCamera({ ...current.camera, x: current.camera.x + dx, y: current.camera.y + dy });
      return;
    }
    if (Math.abs(dx) + Math.abs(dy) < 3 && !current.moved) return;
    const next = { ...current, moved: true, dx: dx / current.camera.k, dy: dy / current.camera.k };
    gestureRef.current = next;
    if (!gestureFrame.current) gestureFrame.current = requestAnimationFrame(() => {
      gestureFrame.current = 0;
      setGesture(gestureRef.current);
    });
  };
  const endGesture = () => {
    cancelAnimationFrame(gestureFrame.current);
    gestureFrame.current = 0;
    const current = gestureRef.current;
    if (current) {
      suppressClick.current = !!current.moved || current.type === 'resize';
      setTimeout(() => { suppressClick.current = false; }, 0);
      if (current.type === 'move' && current.moved) update(moveCanvasNodes(canvas, current.ids,
        Math.round(current.dx), Math.round(current.dy)));
      else if (current.type === 'resize') updateNode(current.id, {
        width: Math.max(180, Math.round(current.width + current.dx)),
        height: Math.max(100, Math.round(current.height + current.dy)),
      });
    }
    gestureRef.current = null;
    setGesture(null);
  };
  const cancelConnection = () => {
    setConnecting(false); setConnectionStart(null); setSelectedNode(null); setSelectedEdge(null); setMenu(null);
  };
  const connect = () => {
    setConnecting(!connecting);
    setConnectionStart(connecting ? null : selectedNode);
  };
  const fit = () => {
    const viewport = viewportRef.current;
    if (!canvas.nodes.length) return setCamera({ x: viewport.clientWidth / 2, y: viewport.clientHeight / 2, k: 1 });
    const left = Math.min(...canvas.nodes.map((item) => item.x));
    const top = Math.min(...canvas.nodes.map((item) => item.y));
    const right = Math.max(...canvas.nodes.map((item) => item.x + item.width));
    const bottom = Math.max(...canvas.nodes.map((item) => item.y + item.height));
    const k = Math.max(0.2, Math.min(1, (viewport.clientWidth - 80) / (right - left), (viewport.clientHeight - 80) / (bottom - top)));
    setCamera({ k, x: viewport.clientWidth / 2 - (left + right) / 2 * k, y: viewport.clientHeight / 2 - (top + bottom) / 2 * k });
  };
  liveActions.current = {
    ...Object.fromEntries(['text', 'file', 'link', 'group'].map((type) => [`canvas-add-${type}`, () => addNode(type)])),
    'canvas-connect': connect, 'canvas-cancel': cancelConnection, 'canvas-fit': fit,
    'canvas-zoom-in': () => zoom(1.2), 'canvas-zoom-out': () => zoom(1 / 1.2),
    'canvas-delete': () => {
      if (selectedNode) removeNode(selectedNode);
      else if (selectedEdge) { update({ ...canvas, edges: canvas.edges.filter((item) => item.id !== selectedEdge) }); setSelectedEdge(null); }
    },
  };

  return (
    <div className="canvas-editor" onClickCapture={(event) => {
      if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); }
    }}>
      <div className="canvas-toolbar">
        {['text', 'file', 'link', 'group'].map((type) => <button key={type} onClick={() => addNode(type)}>
          {t('Add {type}', { type: t(type) })}
        </button>)}
        <button className={connecting ? 'active' : ''} onClick={connect}>{connecting ? t('Cancel connection') : t('Connect nodes')}</button>
        {selectedNode && <button onClick={() => removeNode(selectedNode)}>{t('Delete node')}</button>}
        {edge && <button onClick={() => {
          update({ ...canvas, edges: canvas.edges.filter((item) => item.id !== edge.id) });
          setSelectedEdge(null);
        }}>{t('Delete connection')}</button>}
        <label className="canvas-mode-control">{t('Relation')}
          <select aria-label={t('Relation')} value={relationType} onChange={(event) => setRelationType(event.target.value)}>
            <option value="connection">{t('Connection')}</option>
            <option value="supports">{t('Supports')}</option>
            <option value="answers">{t('Answers')}</option>
            <option value="contradicts">{t('Contradicts')}</option>
          </select>
        </label>
        <button aria-label={t('Zoom out')} onClick={() => zoom(1 / 1.2)}>−</button>
        <button aria-label={t('Reset zoom')} onClick={() => zoom(1 / camera.k)}>{Math.round(camera.k * 100)}%</button>
        <button aria-label={t('Zoom in')} onClick={() => zoom(1.2)}>+</button>
        <button onClick={fit}>{t('Fit canvas')}</button>
        {connecting && <span className="canvas-hint" role="status">
          {t(connectionStart ? 'Select the target node.' : 'Select a starting node.')}
        </span>}
      </div>
      {node && <div className="canvas-inspector">
        <label>{t('Node color')}
          <select aria-label={t('Node color')} value={node.color || ''}
            onChange={(event) => updateNode(node.id, { color: event.target.value || undefined })}>
            <option value="">{t('Default')}</option>
            {node.color?.startsWith('#') && <option value={node.color}>{node.color}</option>}
            {PRESET_COLORS.map(([value, , name]) => <option key={value} value={value}>{t(name)}</option>)}
          </select>
        </label>
      </div>}
      {edge && <div className="canvas-inspector">
        <label>{t('Connection label')}<input aria-label={t('Connection label')} value={edge.label || ''}
          onChange={(event) => update({
            ...canvas, edges: canvas.edges.map((item) =>
              item.id === edge.id ? { ...item, label: event.target.value } : item)
          })} /></label>
        <label>{t('Connection color')}<select aria-label={t('Connection color')} value={edge.color || ''}
          onChange={(event) => update({
            ...canvas, edges: canvas.edges.map((item) =>
              item.id === edge.id ? { ...item, color: event.target.value || undefined } : item)
          })}>
          <option value="">{t('Default')}</option>
          {edge.color?.startsWith('#') && <option value={edge.color}>{edge.color}</option>}
          {PRESET_COLORS.map(([value, , name]) => <option key={value} value={value}>{t(name)}</option>)}
        </select></label>
        <label>{t('Endpoint')}<select aria-label={t('Endpoint')} value={edge.toEnd || 'arrow'}
          onChange={(event) => update({
            ...canvas, edges: canvas.edges.map((item) =>
              item.id === edge.id ? { ...item, toEnd: event.target.value } : item)
          })}>
          <option value="arrow">{t('Arrow')}</option><option value="none">{t('None')}</option>
        </select></label>
      </div>}
      <div className="canvas-board-wrap" ref={viewportRef} style={{
        backgroundPosition: `${camera.x}px ${camera.y}px`, backgroundSize: `${22 * camera.k}px ${22 * camera.k}px`,
      }}
        onContextMenu={(event) => {
          if (event.target.closest('input, textarea, button, .context-menu, [contenteditable="true"]')) return;
          const rect = event.currentTarget.getBoundingClientRect();
          contextMenu(event, event.target.closest('[data-node-id]')?.dataset.nodeId,
            event.target.closest('[data-edge-id]')?.dataset.edgeId,
            {
              x: Math.round((event.clientX - rect.left - camera.x) / camera.k),
              y: Math.round((event.clientY - rect.top - camera.y) / camera.k)
            });
        }}
        onPointerMove={moveGesture} onPointerUp={endGesture}
        onPointerCancel={() => {
          cancelAnimationFrame(gestureFrame.current);
          gestureFrame.current = 0;
          gestureRef.current = null;
          setGesture(null);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || event.target.closest('.canvas-node, [data-edge-id], .context-menu, input, textarea, button')) return;
          event.preventDefault();
          setSelectedNode(null);
          setSelectedEdge(null);
          setMenu(null);
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          gestureRef.current = { type: 'pan', clientX: event.clientX, clientY: event.clientY, camera };
        }} tabIndex={0} aria-label={t('Canvas workspace')}>
        <div className="canvas-board" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.k})` }}
          tabIndex={0} aria-label={t('Canvas')}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget || !(event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))) return;
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            const wrap = event.currentTarget.parentElement.getBoundingClientRect();
            const x = Math.max(rect.left, wrap.left) + 32, y = Math.max(rect.top, wrap.top) + 32;
            contextMenu({ clientX: x, clientY: y }, null, null,
              { x: Math.round((x - rect.left) / camera.k), y: Math.round((y - rect.top) / camera.k) });
          }}
          onClick={() => { setSelectedNode(null); setSelectedEdge(null); }}>
          <CanvasEdges edges={canvas.edges} nodes={nodesById} selectedEdge={selectedEdge}
            onSelect={selectEdge} onContextMenu={contextMenu} />
          {layers.map((layer) => <div key={layer.name} className={layer.name}>
            {layer.nodes.map((item, index) => <CanvasNode key={item.id} node={item}
              selected={item.id === selectedNode || (connecting && item.id === connectionStart)} order={index}
              onStartGesture={startGesture}
              onContextMenu={contextMenu}
              onSelect={selectNode} onUpdate={updateNode} onRemove={removeNode}
              onOpenFile={onOpenFile} onOpenUrl={onOpenUrl} onOpenLink={onOpenLink} paths={paths} contents={contents} />)}
          </div>)}
        </div>
        {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      </div>
    </div>
  );
}

export default function CanvasView({
  path, content, mode, setMode, onChange, onRestore, onRename, onOpenHistory, paths, contents, onOpenFile, onOpenUrl, onOpenLink, settings,
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(baseName(path));
  const parsed = useMemo(() => {
    try { return { canvas: parseCanvas(content), error: null }; }
    catch (error) { return { canvas: null, error: error.message }; }
  }, [content]);
  const editorMode = mode === 'edit' ? 'source' : 'visual';
  const commitTitle = () => {
    const next = title.trim();
    if (next && next !== baseName(path)) onRename(path, next);
    else setTitle(baseName(path));
  };

  return (
    <div className="note-view canvas-view">
      <div className="note-header">
        <input className="note-title" value={title} onChange={(event) => setTitle(event.target.value)}
          onBlur={commitTitle} onKeyDown={(event) => event.key === 'Enter' && event.target.blur()} />
        <div className="note-actions">
          <button onClick={onOpenHistory}>{t('History')}</button>
          <select aria-label={t('Canvas mode')} value={editorMode}
            onChange={(event) => setMode(event.target.value === 'source' ? 'edit' : 'visual')}>
            <option value="visual">{t('Visual')}</option>
            <option value="source">{t('JSON source')}</option>
          </select>
        </div>
      </div>
      {editorMode === 'source' ? <>
        {parsed.error && <div className="editor-notice source-fallback" role="alert">{parsed.error}
          <JsonRecovery path={path} content={content} onRestore={onRestore} />
        </div>}
        <JsonEditor className="canvas-json-editor" label={t('Canvas JSON')} value={content} onChange={onChange}
          height="100%" autoFocus settings={settings} />
      </> : parsed.error ? <div className="canvas-invalid" role="alert">
        <h2>{t('Invalid Canvas JSON')}</h2><p>{parsed.error}</p>
        <button onClick={() => setMode('edit')}>{t('Open JSON source')}</button>
        <JsonRecovery path={path} content={content} onRestore={onRestore} />
      </div> : <CanvasBoard canvas={parsed.canvas} onChange={onChange} paths={paths} onEditSource={() => setMode('edit')}
        contents={contents}
        onOpenFile={onOpenFile} onOpenUrl={onOpenUrl} onOpenLink={onOpenLink} t={t} keybindings={settings.keybindings} />}
    </div>
  );
}
