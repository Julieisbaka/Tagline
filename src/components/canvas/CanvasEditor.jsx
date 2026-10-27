import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  canvasGroupMembers, createArgumentEdge, createCanvasId, createCanvasNode, moveCanvasNodes,
  resolveCanvasLink, serializeCanvas,
} from '../../lib/canvas.js';
import { binding, KEYBINDINGS, matchesBinding } from '../../lib/keybindings.js';
import ContextMenu from '../dialogs/ContextMenu.jsx';
import CanvasEdges from './CanvasEdges.jsx';
import CanvasNode from './CanvasNode.jsx';
import { PRESET_COLORS } from './canvasUtils.js';

export default function CanvasEditor({ canvas, onChange, paths, contents, onOpenFile, onOpenUrl, onOpenLink, onEditSource, t, keybindings }) {
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
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.closest('[data-node-id]')?.focus({ preventScroll: true });
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
      if (current.type === 'move' && current.moved) update(moveCanvasNodes(canvas, current.ids,
        Math.round(current.dx), Math.round(current.dy)));
      else if (current.type === 'resize') updateNode(current.id, {
        width: Math.max(180, Math.round(current.width + current.dx)),
        height: Math.max(100, Math.round(current.height + current.dy)),
      });
    }
    gestureRef.current = null;
    setTimeout(() => { suppressClick.current = false; }, 0);
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
