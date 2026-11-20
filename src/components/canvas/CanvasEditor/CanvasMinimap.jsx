import { useMemo } from 'react';
import { useI18n } from '../../../lib/i18n.js';
import { nodeColor } from '../canvasUtils.js';

const WIDTH = 160;
const HEIGHT = 104;
const PAD = 6;

export default function CanvasMinimap({ canvas, camera, view, onNavigate }) {
  const { t } = useI18n();
  const map = useMemo(() => {
    const left = canvas.nodes.length ? Math.min(...canvas.nodes.map((n) => n.x)) : 0;
    const top = canvas.nodes.length ? Math.min(...canvas.nodes.map((n) => n.y)) : 0;
    const right = canvas.nodes.length ? Math.max(...canvas.nodes.map((n) => n.x + n.width)) : 800;
    const bottom = canvas.nodes.length ? Math.max(...canvas.nodes.map((n) => n.y + n.height)) : 600;
    const scale = Math.min((WIDTH - PAD * 2) / (right - left), (HEIGHT - PAD * 2) / (bottom - top));
    return {
      scale,
      ox: PAD + (WIDTH - PAD * 2 - (right - left) * scale) / 2 - left * scale,
      oy: PAD + (HEIGHT - PAD * 2 - (bottom - top) * scale) / 2 - top * scale,
    };
  }, [canvas.nodes]);
  const navigate = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * HEIGHT;
    onNavigate((x - map.ox) / map.scale, (y - map.oy) / map.scale);
  };
  return (
    <div
      className='canvas-minimap'
      tabIndex={0}
      role='button'
      aria-label={t('Canvas minimap')}
      title={t('Click to pan the canvas')}
      onPointerDown={(event) => {
        // Keep minimap drags from starting a pan on the enclosing board.
        event.stopPropagation();
        if (event.button !== 0) {
          return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        navigate(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) {
          event.stopPropagation();
          navigate(event);
        }
      }}
      onKeyDown={(event) => {
        const step = 120;
        const cx = (view.left + view.right) / 2;
        const cy = (view.top + view.bottom) / 2;
        const moves = {
          ArrowLeft: [cx - step, cy],
          ArrowRight: [cx + step, cy],
          ArrowUp: [cx, cy - step],
          ArrowDown: [cx, cy + step],
        };
        if (moves[event.key]) {
          event.preventDefault();
          onNavigate(...moves[event.key]);
        }
      }}
    >
      <svg width={WIDTH} height={HEIGHT} aria-hidden='true'>
        {canvas.nodes.map((node) => (
          <rect
            key={node.id}
            x={node.x * map.scale + map.ox}
            y={node.y * map.scale + map.oy}
            width={Math.max(2, node.width * map.scale)}
            height={Math.max(2, node.height * map.scale)}
            rx={1}
            fill={nodeColor(node.color)}
            opacity={node.type === 'group' ? 0.35 : 0.8}
          />
        ))}
        <rect
          className='canvas-minimap-viewport'
          x={view.left * map.scale + map.ox}
          y={view.top * map.scale + map.oy}
          width={(view.right - view.left) * map.scale}
          height={(view.bottom - view.top) * map.scale}
        />
      </svg>
      <span className='canvas-minimap-label'>{Math.round(camera.k * 100)}%</span>
    </div>
  );
}
