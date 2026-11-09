import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  canvasGroupMembers,
  createArgumentEdge,
  createCanvasId,
  createCanvasNode,
  moveCanvasNodes,
  serializeCanvas,
} from '../../lib/canvas.js';
import { binding, KEYBINDINGS, matchesBinding } from '../../lib/keybindings.js';
import CanvasBoard from './CanvasEditor/CanvasBoard.jsx';
import CanvasControls from './CanvasEditor/CanvasControls.jsx';
import openCanvasContextMenu from './CanvasEditor/canvasContextMenu.js';

export default function CanvasEditor({
  canvas,
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
  const edge = canvas.edges.find((item) => item.id === selectedEdge);
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
  const layers = useMemo(
    () => [
      {
        name: 'canvas-groups',
        nodes: renderedNodes
          .filter((item) => item.type === 'group')
          .sort((a, b) => b.width * b.height - a.width * a.height),
      },
      { name: 'canvas-nodes', nodes: renderedNodes.filter((item) => item.type !== 'group') },
    ],
    [renderedNodes]
  );

  const update = useCallback((next) => onChange(serializeCanvas(next)), [onChange]);
  const updateNode = useCallback(
    (id, changes) =>
      update({
        ...canvas,
        nodes: canvas.nodes.map((item) => (item.id === id ? { ...item, ...changes } : item)),
      }),
    [canvas, update]
  );
  const removeNode = useCallback(
    (id) => {
      update({
        ...canvas,
        nodes: canvas.nodes.filter((item) => item.id !== id),
        edges: canvas.edges.filter((item) => item.fromNode !== id && item.toNode !== id),
      });
      setSelectedNode(null);
    },
    [canvas, update]
  );
  const addNode = useCallback(
    (type, position, wrapped = node) => {
      const nextNode = createCanvasNode(type, canvas.nodes.length);
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
      update({ ...canvas, nodes: [...canvas.nodes, nextNode] });
      setSelectedNode(nextNode.id);
      setSelectedEdge(null);
    },
    [canvas, node, update]
  );
  const contextMenu = useCallback(
    (event, nodeId, edgeId, position) =>
      openCanvasContextMenu(
        {
          canvas,
          paths,
          onOpenFile,
          onOpenUrl,
          update,
          addNode,
          removeNode,
          onEditSource,
          t,
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
      ),
    [canvas, paths, onOpenFile, onOpenUrl, update, addNode, removeNode, onEditSource, t]
  );
  const selectEdge = useCallback((id) => {
    setSelectedEdge(id);
    setSelectedNode(null);
  }, []);
  const selectNode = useCallback(
    (id) => {
      if (connecting) {
        if (!connectionStart) {
          setConnectionStart(id);
          return;
        }
        if (connectionStart !== id) {
          const next =
            relationType !== 'connection'
              ? createArgumentEdge(connectionStart, id, relationType)
              : {
                  id: createCanvasId(),
                  fromNode: connectionStart,
                  toNode: id,
                  fromSide: 'right',
                  toSide: 'left',
                  toEnd: 'arrow',
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
    },
    [canvas, connecting, connectionStart, relationType, update]
  );
  const startGesture = useCallback(
    (event, data) => {
      if (connecting && data.type === 'move') {
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
        ids: [id, ...canvasGroupMembers(canvas.nodes, id)],
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
    [canvas.nodes, connecting, selectNode]
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
    if (!canvas.nodes.length) {
      return setCamera({ x: viewport.clientWidth / 2, y: viewport.clientHeight / 2, k: 1 });
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
  liveActions.current = {
    ...Object.fromEntries(
      ['text', 'file', 'link', 'group'].map((type) => [`canvas-add-${type}`, () => addNode(type)])
    ),
    'canvas-connect': connect,
    'canvas-cancel': cancelConnection,
    'canvas-fit': fit,
    'canvas-zoom-in': () => zoom(1.2),
    'canvas-zoom-out': () => zoom(1 / 1.2),
    'canvas-delete': () => {
      if (selectedNode) {
        removeNode(selectedNode);
      } else if (selectedEdge) {
        update({ ...canvas, edges: canvas.edges.filter((item) => item.id !== selectedEdge) });
        setSelectedEdge(null);
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
        edge={edge}
        update={update}
        canvas={canvas}
        setSelectedEdge={setSelectedEdge}
        relationType={relationType}
        setRelationType={setRelationType}
        zoom={zoom}
        camera={camera}
        fit={fit}
        connectionStart={connectionStart}
        node={node}
        updateNode={updateNode}
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
        contents={contents}
        menu={menu}
        t={t}
      />
    </div>
  );
}
