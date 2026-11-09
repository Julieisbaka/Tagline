import ContextMenu from '../../dialogs/ContextMenu.jsx';
import CanvasEdges from '../CanvasEdges.jsx';
import CanvasNode from '../CanvasNode.jsx';

export default function CanvasBoard({
  viewportRef,
  camera,
  contextMenu,
  moveGesture,
  endGesture,
  gestureFrame,
  gestureRef,
  setGesture,
  setSelectedNode,
  setSelectedEdge,
  setMenu,
  canvas,
  nodesById,
  selectedEdge,
  selectEdge,
  layers,
  selectedNode,
  connecting,
  connectionStart,
  startGesture,
  selectNode,
  updateNode,
  removeNode,
  onOpenFile,
  onOpenUrl,
  onOpenLink,
  paths,
  contents,
  menu,
  t,
}) {
  return (
    <div
      className='canvas-board-wrap'
      ref={viewportRef}
      style={{
        backgroundPosition: `${camera.x}px ${camera.y}px`,
        backgroundSize: `${22 * camera.k}px ${22 * camera.k}px`,
      }}
      onContextMenu={(event) => {
        if (
          event.target.closest('input, textarea, button, .context-menu, [contenteditable="true"]')
        ) {
          return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        contextMenu(
          event,
          event.target.closest('[data-node-id]')?.dataset.nodeId,
          event.target.closest('[data-edge-id]')?.dataset.edgeId,
          {
            x: Math.round((event.clientX - rect.left - camera.x) / camera.k),
            y: Math.round((event.clientY - rect.top - camera.y) / camera.k),
          }
        );
      }}
      onPointerMove={moveGesture}
      onPointerUp={endGesture}
      onPointerCancel={() => {
        cancelAnimationFrame(gestureFrame.current);
        gestureFrame.current = 0;
        gestureRef.current = null;
        setGesture(null);
      }}
      onPointerDown={(event) => {
        if (
          event.button !== 0 ||
          event.target.closest(
            '.canvas-node, [data-edge-id], .context-menu, input, textarea, button'
          )
        ) {
          return;
        }
        event.preventDefault();
        setSelectedNode(null);
        setSelectedEdge(null);
        setMenu(null);
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        gestureRef.current = {
          type: 'pan',
          clientX: event.clientX,
          clientY: event.clientY,
          camera,
        };
      }}
      tabIndex={0}
      aria-label={t('Canvas workspace')}
    >
      <div
        className='canvas-board'
        style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.k})` }}
        tabIndex={0}
        aria-label={t('Canvas')}
        onKeyDown={(event) => {
          if (
            event.target !== event.currentTarget ||
            !(event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))
          ) {
            return;
          }
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          const wrap = event.currentTarget.parentElement.getBoundingClientRect();
          const x = Math.max(rect.left, wrap.left) + 32,
            y = Math.max(rect.top, wrap.top) + 32;
          contextMenu({ clientX: x, clientY: y }, null, null, {
            x: Math.round((x - rect.left) / camera.k),
            y: Math.round((y - rect.top) / camera.k),
          });
        }}
        onClick={() => {
          setSelectedNode(null);
          setSelectedEdge(null);
        }}
      >
        <CanvasEdges
          edges={canvas.edges}
          nodes={nodesById}
          selectedEdge={selectedEdge}
          onSelect={selectEdge}
          onContextMenu={contextMenu}
        />
        {layers.map((layer) => (
          <div key={layer.name} className={layer.name}>
            {layer.nodes.map((item, index) => (
              <CanvasNode
                key={item.id}
                node={item}
                selected={item.id === selectedNode || (connecting && item.id === connectionStart)}
                order={index}
                onStartGesture={startGesture}
                onContextMenu={contextMenu}
                onSelect={selectNode}
                onUpdate={updateNode}
                onRemove={removeNode}
                onOpenFile={onOpenFile}
                onOpenUrl={onOpenUrl}
                onOpenLink={onOpenLink}
                paths={paths}
                contents={contents}
              />
            ))}
          </div>
        ))}
      </div>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
