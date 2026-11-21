import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  canvasGroupMembers,
  canvasInvalidLinks,
  canvasVisibleNodes,
  createArgumentEdge,
  createCanvasId,
  createCanvasNode,
  moveCanvasNodes,
  resolveCanvasLink,
  serializeCanvas,
} from '../../lib/canvas/canvas.js';
import { binding, KEYBINDINGS, matchesBinding } from '../../lib/commands/keybindings.js';
import CanvasBoard from './CanvasEditor/CanvasBoard.jsx';
import CanvasControls from './CanvasEditor/CanvasControls.jsx';
import openCanvasContextMenu from './CanvasEditor/canvasContextMenu.js';

export default function CanvasEditor({
  canvas,
  path,
  minimap,
  extensions,
  onChange,
  paths,
  contents,
  onOpenFile,
  onOpenUrl,
  onOpenLink,
  onEditSource,
  t,
  keybindings,
}) {
  const gestureRef = useRef(null);
  const gestureFrame = useRef(0);
  const viewportRef = useRef(null);
  const nudgeRef = useRef(null);
  // Refs let edit callbacks stay stable (so memoized nodes do not re-render on every edit)
  // while still reading the latest canvas, selection and volatile props.
  const canvasRef = useRef(canvas);
  canvasRef.current = canvas;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [gesture, setGesture] = useState(null);
  const [camera, setCamera] = useState(() => ({
    x: 240 - Math.min(0, ...canvas.nodes.map((item) => item.x)),
    y: 180 - Math.min(0, ...canvas.nodes.map((item) => item.y)),
    k: 1,
  }));
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const measure = () =>
      setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [connectionStart, setConnectionStart] = useState(null);
  const [relationType, setRelationType] = useState('connection');
  const [menu, setMenu] = useState(null);
  const suppressClick = useRef(false);
  const liveActions = useRef({});
  const canvasHistory = useRef({ path, undo: [], redo: [], expected: null });
  if (canvasHistory.current.path !== path) {
    canvasHistory.current = { path, undo: [], redo: [], expected: null };
  }
  const currentSnapshot = useMemo(() => serializeCanvas(canvas), [canvas]);
  const currentSnapshotRef = useRef(currentSnapshot);
  useEffect(() => {
    const action = (event) => liveActions.current[event.detail]?.();
    const key = (event) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        !event.target.closest('.canvas-editor') ||
        document.querySelector('[role="dialog"], .context-menu') ||
        event.target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }
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
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        const state = nudgeRef.current;
        if (state?.selectedNode) {
          event.preventDefault();
          const step = Math.max(1, Math.round((event.shiftKey ? 10 : 1) / state.camera.k));
          const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
          const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
          state.update(
            moveCanvasNodes(
              state.canvas,
              [state.selectedNode, ...canvasGroupMembers(state.canvas.nodes, state.selectedNode)],
              dx,
              dy
            )
          );
          return;
        }
      }
      const command = KEYBINDINGS.find(
        (item) => item.scope === 'canvas' && matchesBinding(event, binding(item.id, keybindings))
      );
      if (command) {
        event.preventDefault();
        liveActions.current[command.id]?.();
      }
    };
    window.addEventListener('workspace-action', action);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('workspace-action', action);
      window.removeEventListener('keydown', key);
    };
  }, [keybindings]);
  const node = canvas.nodes.find((item) => item.id === selectedNode);
  const nodeRef = useRef(node);
  nodeRef.current = node;
  const contextRef = useRef({});
  contextRef.current = { path, extensions, paths, onOpenFile, onOpenUrl, onEditSource, t };
  const connectionRef = useRef({});
  connectionRef.current = { connecting, connectionStart, relationType };
  const edge = canvas.edges.find((item) => item.id === selectedEdge);
  const view = useMemo(() => {
    const { x, y, k } = camera;
    const pad = 120;
    return {
      left: (-x - pad) / k,
      top: (-y - pad) / k,
      right: (viewportSize.width - x + pad) / k,
      bottom: (viewportSize.height - y + pad) / k,
    };
  }, [camera, viewportSize]);
  const centerOn = (worldX, worldY) =>
    setCamera((current) => ({
      ...current,
      x: viewportSize.width / 2 - worldX * current.k,
      y: viewportSize.height / 2 - worldY * current.k,
    }));
  const zoom = (factor, point) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const anchor = point || { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
    setCamera((current) => {
      const k = Math.min(4, Math.max(0.2, current.k * factor));
      if (k === current.k) {
        return current;
      }
      return {
        k,
        x: anchor.x - ((anchor.x - current.x) * k) / current.k,
        y: anchor.y - ((anchor.y - current.y) * k) / current.k,
      };
    });
  };
  useEffect(() => {
    const viewport = viewportRef.current;
    const wheel = (event) => {
      if (gestureRef.current || document.querySelector('.context-menu')) {
        return;
      }
      if (event.target.closest('textarea, input, .canvas-node-preview')) {
        return;
      }
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = viewport.getBoundingClientRect();
        zoom(Math.exp(-event.deltaY * 0.002), {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
      } else {
        setCamera((current) => ({
          ...current,
          x: current.x - event.deltaX,
          y: current.y - event.deltaY,
        }));
      }
    };
    viewport.addEventListener('wheel', wheel, { passive: false });
    return () => viewport.removeEventListener('wheel', wheel);
  }, []);
  useEffect(() => () => cancelAnimationFrame(gestureFrame.current), []);
  const renderedNodes = useMemo(() => {
    if (!gesture) {
      return canvas.nodes;
    }
    const moving = new Set(gesture.ids);
    return canvas.nodes.map((item) => {
      if (!moving.has(item.id)) {
        return item;
      }
      if (gesture.type === 'move') {
        return { ...item, x: item.x + gesture.dx, y: item.y + gesture.dy };
      }
      if (gesture.type === 'resize' && item.id === gesture.id) {
        return {
          ...item,
          width: Math.max(180, Math.round(gesture.width + gesture.dx)),
          height: Math.max(100, Math.round(gesture.height + gesture.dy)),
        };
      }
      return item;
    });
  }, [canvas.nodes, gesture]);
  const nodesById = useMemo(
    () => new Map(renderedNodes.map((item) => [item.id, item])),
    [renderedNodes]
  );
  const visibleNodes = useMemo(() => {
    const shown = canvasVisibleNodes(renderedNodes, view, 200);
    const pinned = new Set([selectedNode, connectionStart].filter(Boolean));
    if (!pinned.size) {
      return shown;
    }
    const ids = new Set(shown.map((item) => item.id));
    return [...shown, ...renderedNodes.filter((item) => pinned.has(item.id) && !ids.has(item.id))];
  }, [renderedNodes, view, selectedNode, connectionStart]);
  const layers = useMemo(
    () => [
      {
        name: 'canvas-groups',
        nodes: visibleNodes
          .filter((item) => item.type === 'group')
          .sort((a, b) => b.width * b.height - a.width * a.height),
      },
      { name: 'canvas-nodes', nodes: visibleNodes.filter((item) => item.type !== 'group') },
    ],
    [visibleNodes]
  );
  const invalidLinks = useMemo(
    () => canvasInvalidLinks(canvas, (value) => resolveCanvasLink(value, paths, path)),
    [canvas, paths, path]
  );
  const invalidIds = useMemo(() => new Set(invalidLinks.map((item) => item.id)), [invalidLinks]);

  // Discard history when the canvas changes outside this editor (file switch or JSON source edit).
  useEffect(() => {
    const history = canvasHistory.current;
    currentSnapshotRef.current = currentSnapshot;
    if (history.expected === currentSnapshot) {
      history.expected = null;
      return;
    }
    history.undo = [];
    history.redo = [];
    history.expected = null;
  }, [path, currentSnapshot]);
  const update = useCallback((next) => {
    const nextSnapshot = serializeCanvas(next);
    const history = canvasHistory.current;
    const previous = currentSnapshotRef.current;
    if (previous !== nextSnapshot) {
      history.undo.push(previous);
      if (history.undo.length > 100) {
        history.undo.shift();
      }
      history.redo = [];
    }
    history.expected = nextSnapshot;
    currentSnapshotRef.current = nextSnapshot;
    onChangeRef.current(nextSnapshot);
  }, []);
  nudgeRef.current = { canvas, selectedNode, camera, update };
  const restoreCanvas = (snapshot) => {
    const history = canvasHistory.current;
    history.expected = snapshot;
    currentSnapshotRef.current = snapshot;
    setSelectedNode(null);
    setSelectedEdge(null);
    setConnecting(false);
    setConnectionStart(null);
    viewportRef.current?.focus({ preventScroll: true });
    onChangeRef.current(snapshot);
  };
  const undoCanvas = () => {
    const history = canvasHistory.current;
    const previous = history.undo.pop();
    if (previous === undefined) {
      return;
    }
    history.redo.push(currentSnapshotRef.current);
    restoreCanvas(previous);
  };
  const redoCanvas = () => {
    const history = canvasHistory.current;
    const next = history.redo.pop();
    if (next === undefined) {
      return;
    }
    history.undo.push(currentSnapshotRef.current);
    if (history.undo.length > 100) {
      history.undo.shift();
    }
    restoreCanvas(next);
  };
  const updateNode = useCallback(
    (id, changes) => {
      const current = canvasRef.current;
      update({
        ...current,
        nodes: current.nodes.map((item) => (item.id === id ? { ...item, ...changes } : item)),
      });
    },
    [update]
  );
  const removeNode = useCallback(
    (id) => {
      const current = canvasRef.current;
      update({
        ...current,
        nodes: current.nodes.filter((item) => item.id !== id),
        edges: current.edges.filter((item) => item.fromNode !== id && item.toNode !== id),
      });
      setSelectedNode(null);
    },
    [update]
  );
  const removeEdge = useCallback(
    (id) => {
      const current = canvasRef.current;
      update({
        ...current,
        edges: current.edges.filter((item) => item.id !== id),
      });
      setSelectedEdge(null);
    },
    [update]
  );
  const addNode = useCallback(
    (type, position, wrapped = nodeRef.current) => {
      const current = canvasRef.current;
      const nextNode = createCanvasNode(type, current.nodes.length);
      const viewport = viewportRef.current;
      const camera = cameraRef.current;
      Object.assign(
        nextNode,
        position || {
          x: Math.round((viewport.clientWidth / 2 - camera.x) / camera.k - nextNode.width / 2),
          y: Math.round((viewport.clientHeight / 2 - camera.y) / camera.k - nextNode.height / 2),
        }
      );
      if (type === 'group' && wrapped) {
        Object.assign(nextNode, {
          x: wrapped.x - 24,
          y: wrapped.y - 40,
          width: wrapped.width + 48,
          height: wrapped.height + 64,
        });
      }
      update({ ...current, nodes: [...current.nodes, nextNode] });
      setSelectedNode(nextNode.id);
      setSelectedEdge(null);
    },
    [update]
  );
  const contextMenu = useCallback(
    (event, nodeId, edgeId, position) => {
      const volatile = contextRef.current;
      return openCanvasContextMenu(
        {
          canvas: canvasRef.current,
          path: volatile.path,
          extensions: volatile.extensions,
          paths: volatile.paths,
          onOpenFile: volatile.onOpenFile,
          onOpenUrl: volatile.onOpenUrl,
          update,
          addNode,
          removeNode,
          removeEdge,
          onEditSource: volatile.onEditSource,
          t: volatile.t,
          setConnectionStart,
          setConnecting,
          setSelectedNode,
          setSelectedEdge,
          setMenu,
        },
        event,
        nodeId,
        edgeId,
        position
      );
    },
    [update, addNode, removeNode, removeEdge]
  );
  const selectEdge = useCallback((id) => {
    setSelectedEdge(id);
    setSelectedNode(null);
  }, []);
  const selectNode = useCallback(
    (id) => {
      const {
        connecting: isConnecting,
        connectionStart: start,
        relationType: relation,
      } = connectionRef.current;
      if (isConnecting) {
        if (!start) {
          setConnectionStart(id);
          return;
        }
        if (start !== id) {
          const next =
            relation !== 'connection'
              ? createArgumentEdge(start, id, relation)
              : {
                  id: createCanvasId(),
                  fromNode: start,
                  toNode: id,
                  fromSide: 'right',
                  toSide: 'left',
                  toEnd: 'arrow',
                };
          const current = canvasRef.current;
          update({ ...current, edges: [...current.edges, next] });
          setSelectedEdge(next.id);
          setSelectedNode(null);
        }
        setConnecting(false);
        setConnectionStart(null);
        return;
      }
      setSelectedNode(id);
      setSelectedEdge(null);
    },
    [update]
  );
  const startGesture = useCallback(
    (event, data) => {
      if (connectionRef.current.connecting && data.type === 'move') {
        selectNode(data.id);
        suppressClick.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.closest('[data-node-id]')?.focus({ preventScroll: true });
        return;
      }
      const { id, type, width: nodeWidth, height: nodeHeight } = data;
      const next = {
        id,
        type,
        clientX: event.clientX,
        clientY: event.clientY,
        ids: [id, ...canvasGroupMembers(canvasRef.current.nodes, id)],
        width: nodeWidth,
        height: nodeHeight,
        dx: 0,
        dy: 0,
        camera: cameraRef.current,
      };
      gestureRef.current = next;
      event.currentTarget.setPointerCapture(event.pointerId);
      setMenu(null);
      setSelectedNode(id);
      setSelectedEdge(null);
      event.currentTarget.closest('[data-node-id]')?.focus({ preventScroll: true });
      setGesture(next);
    },
    [selectNode]
  );
  const moveGesture = (event) => {
    const current = gestureRef.current;
    if (!current) {
      return;
    }
    const dx = event.clientX - current.clientX,
      dy = event.clientY - current.clientY;
    if (current.type === 'pan') {
      setCamera({ ...current.camera, x: current.camera.x + dx, y: current.camera.y + dy });
      return;
    }
    if (Math.abs(dx) + Math.abs(dy) < 3 && !current.moved) {
      return;
    }
    const next = { ...current, moved: true, dx: dx / current.camera.k, dy: dy / current.camera.k };
    gestureRef.current = next;
    if (!gestureFrame.current) {
      gestureFrame.current = requestAnimationFrame(() => {
        gestureFrame.current = 0;
        setGesture(gestureRef.current);
      });
    }
  };
  const endGesture = () => {
    cancelAnimationFrame(gestureFrame.current);
    gestureFrame.current = 0;
    const current = gestureRef.current;
    if (current) {
      suppressClick.current = !!current.moved || current.type === 'resize';
      if (current.type === 'move' && current.moved) {
        update(
          moveCanvasNodes(canvas, current.ids, Math.round(current.dx), Math.round(current.dy))
        );
      } else if (current.type === 'resize') {
        updateNode(current.id, {
          width: Math.max(180, Math.round(current.width + current.dx)),
          height: Math.max(100, Math.round(current.height + current.dy)),
        });
      }
    }
    gestureRef.current = null;
    setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    setGesture(null);
  };
  const cancelConnection = () => {
    setConnecting(false);
    setConnectionStart(null);
    setSelectedNode(null);
    setSelectedEdge(null);
    setMenu(null);
  };
  const connect = () => {
    setConnecting(!connecting);
    setConnectionStart(connecting ? null : selectedNode);
  };
  const fit = () => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    if (!canvas.nodes.length) {
      setCamera({ x: viewport.clientWidth / 2, y: viewport.clientHeight / 2, k: 1 });
      return;
    }
    const left = Math.min(...canvas.nodes.map((item) => item.x));
    const top = Math.min(...canvas.nodes.map((item) => item.y));
    const right = Math.max(...canvas.nodes.map((item) => item.x + item.width));
    const bottom = Math.max(...canvas.nodes.map((item) => item.y + item.height));
    const k = Math.max(
      0.2,
      Math.min(
        1,
        (viewport.clientWidth - 80) / (right - left),
        (viewport.clientHeight - 80) / (bottom - top)
      )
    );
    setCamera({
      k,
      x: viewport.clientWidth / 2 - ((left + right) / 2) * k,
      y: viewport.clientHeight / 2 - ((top + bottom) / 2) * k,
    });
  };
  const cycleSelection = (direction) => {
    const items = [
      ...canvas.nodes.map((item) => ({ id: item.id, type: 'node' })),
      ...canvas.edges.map((item) => ({ id: item.id, type: 'edge' })),
    ];
    if (!items.length) {
      return;
    }
    const index = items.findIndex((item) => item.id === (selectedNode || selectedEdge));
    const next =
      index === -1
        ? items[direction > 0 ? 0 : items.length - 1]
        : items[(index + direction + items.length) % items.length];
    if (next.type === 'node') {
      selectNode(next.id);
      const target = canvas.nodes.find((item) => item.id === next.id);
      const screenX = target.x * camera.k + camera.x;
      const screenY = target.y * camera.k + camera.y;
      const offscreen =
        screenX < 0 ||
        screenY < 0 ||
        screenX + target.width * camera.k > viewportSize.width ||
        screenY + target.height * camera.k > viewportSize.height;
      if (offscreen) {
        centerOn(target.x + target.width / 2, target.y + target.height / 2);
      }
    } else {
      selectEdge(next.id);
    }
    const selector =
      next.type === 'node' ? `[data-node-id="${next.id}"]` : `[data-edge-id="${next.id}"]`;
    const element = viewportRef.current?.querySelector(selector);
    if (element) {
      element.focus({ preventScroll: true });
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  };
  liveActions.current = {
    ...Object.fromEntries(
      ['text', 'file', 'link', 'group'].map((type) => [`canvas-add-${type}`, () => addNode(type)])
    ),
    'canvas-connect': connect,
    'canvas-cancel': cancelConnection,
    'canvas-select-next': () => cycleSelection(1),
    'canvas-select-previous': () => cycleSelection(-1),
    'canvas-undo': undoCanvas,
    'canvas-redo': redoCanvas,
    'canvas-fit': fit,
    'canvas-zoom-in': () => zoom(1.2),
    'canvas-zoom-out': () => zoom(1 / 1.2),
    'canvas-delete': () => {
      if (selectedNode) {
        removeNode(selectedNode);
      } else if (selectedEdge) {
        removeEdge(selectedEdge);
      }
    },
  };

  return (
    <div
      className='canvas-editor'
      onClickCapture={(event) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <CanvasControls
        addNode={addNode}
        connecting={connecting}
        connect={connect}
        selectedNode={selectedNode}
        removeNode={removeNode}
        removeEdge={removeEdge}
        edge={edge}
        update={update}
        canvas={canvas}
        relationType={relationType}
        setRelationType={setRelationType}
        zoom={zoom}
        camera={camera}
        fit={fit}
        connectionStart={connectionStart}
        node={node}
        updateNode={updateNode}
        invalidCount={invalidLinks.length}
        t={t}
      />
      <CanvasBoard
        viewportRef={viewportRef}
        camera={camera}
        contextMenu={contextMenu}
        moveGesture={moveGesture}
        endGesture={endGesture}
        gestureFrame={gestureFrame}
        gestureRef={gestureRef}
        setGesture={setGesture}
        setSelectedNode={setSelectedNode}
        setSelectedEdge={setSelectedEdge}
        setMenu={setMenu}
        canvas={canvas}
        nodesById={nodesById}
        view={view}
        minimap={minimap}
        centerOn={centerOn}
        invalidIds={invalidIds}
        selectedEdge={selectedEdge}
        selectEdge={selectEdge}
        layers={layers}
        selectedNode={selectedNode}
        connecting={connecting}
        connectionStart={connectionStart}
        startGesture={startGesture}
        selectNode={selectNode}
        updateNode={updateNode}
        removeNode={removeNode}
        onOpenFile={onOpenFile}
        onOpenUrl={onOpenUrl}
        onOpenLink={onOpenLink}
        paths={paths}
        path={path}
        contents={contents}
        menu={menu}
        t={t}
      />
    </div>
  );
}
