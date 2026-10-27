import { memo } from 'react';
import { useI18n } from '../../lib/i18n.js';
import { nodeColor, sidePoint } from './canvasUtils.js';

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

export default CanvasEdges;
