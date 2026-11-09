import { PRESET_COLORS } from '../canvasUtils.js';

export default function CanvasControls({
  addNode,
  connecting,
  connect,
  selectedNode,
  removeNode,
  edge,
  update,
  canvas,
  setSelectedEdge,
  relationType,
  setRelationType,
  zoom,
  camera,
  fit,
  connectionStart,
  node,
  updateNode,
  t,
}) {
  return (
    <>
      <div className='canvas-toolbar'>
        {['text', 'file', 'link', 'group'].map((type) => (
          <button key={type} onClick={() => addNode(type)}>
            {t('Add {type}', { type: t(type) })}
          </button>
        ))}
        <button className={connecting ? 'active' : ''} onClick={connect}>
          {connecting ? t('Cancel connection') : t('Connect nodes')}
        </button>
        {selectedNode && (
          <button onClick={() => removeNode(selectedNode)}>{t('Delete node')}</button>
        )}
        {edge && (
          <button
            onClick={() => {
              update({ ...canvas, edges: canvas.edges.filter((item) => item.id !== edge.id) });
              setSelectedEdge(null);
            }}
          >
            {t('Delete connection')}
          </button>
        )}
        <label className='canvas-mode-control'>
          {t('Relation')}
          <select
            aria-label={t('Relation')}
            value={relationType}
            onChange={(event) => setRelationType(event.target.value)}
          >
            <option value='connection'>{t('Connection')}</option>
            <option value='supports'>{t('Supports')}</option>
            <option value='answers'>{t('Answers')}</option>
            <option value='contradicts'>{t('Contradicts')}</option>
          </select>
        </label>
        <button aria-label={t('Zoom out')} onClick={() => zoom(1 / 1.2)}>
          −
        </button>
        <button aria-label={t('Reset zoom')} onClick={() => zoom(1 / camera.k)}>
          {Math.round(camera.k * 100)}%
        </button>
        <button aria-label={t('Zoom in')} onClick={() => zoom(1.2)}>
          +
        </button>
        <button onClick={fit}>{t('Fit canvas')}</button>
        {connecting && (
          <span className='canvas-hint' role='status'>
            {t(connectionStart ? 'Select the target node.' : 'Select a starting node.')}
          </span>
        )}
      </div>
      {node && (
        <div className='canvas-inspector'>
          <label>
            {t('Node color')}
            <select
              aria-label={t('Node color')}
              value={node.color || ''}
              onChange={(event) => updateNode(node.id, { color: event.target.value || undefined })}
            >
              <option value=''>{t('Default')}</option>
              {node.color?.startsWith('#') && <option value={node.color}>{node.color}</option>}
              {PRESET_COLORS.map(([value, , name]) => (
                <option key={value} value={value}>
                  {t(name)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {edge && (
        <div className='canvas-inspector'>
          <label>
            {t('Connection label')}
            <input
              aria-label={t('Connection label')}
              value={edge.label || ''}
              onChange={(event) =>
                update({
                  ...canvas,
                  edges: canvas.edges.map((item) =>
                    item.id === edge.id ? { ...item, label: event.target.value } : item
                  ),
                })
              }
            />
          </label>
          <label>
            {t('Connection color')}
            <select
              aria-label={t('Connection color')}
              value={edge.color || ''}
              onChange={(event) =>
                update({
                  ...canvas,
                  edges: canvas.edges.map((item) =>
                    item.id === edge.id ? { ...item, color: event.target.value || undefined } : item
                  ),
                })
              }
            >
              <option value=''>{t('Default')}</option>
              {edge.color?.startsWith('#') && <option value={edge.color}>{edge.color}</option>}
              {PRESET_COLORS.map(([value, , name]) => (
                <option key={value} value={value}>
                  {t(name)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Endpoint')}
            <select
              aria-label={t('Endpoint')}
              value={edge.toEnd || 'arrow'}
              onChange={(event) =>
                update({
                  ...canvas,
                  edges: canvas.edges.map((item) =>
                    item.id === edge.id ? { ...item, toEnd: event.target.value } : item
                  ),
                })
              }
            >
              <option value='arrow'>{t('Arrow')}</option>
              <option value='none'>{t('None')}</option>
            </select>
          </label>
        </div>
      )}
    </>
  );
}
