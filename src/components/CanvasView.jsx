import { json } from '@codemirror/lang-json';
import CodeMirror from '@uiw/react-codemirror';
import { useMemo, useRef, useState } from 'react';
import { createArgumentEdge, createCanvasId, createCanvasNode, parseCanvas, serializeCanvas } from '../lib/canvas.js';
import { useI18n } from '../lib/i18n.js';
import { baseName, resolveLink } from '../lib/vault.js';
import Icon from './Icon.jsx';
import Preview from './Preview.jsx';

const PRESET_COLORS = [
  ['1', '#e06c75'], ['2', '#d19a66'], ['3', '#e5c07b'],
  ['4', '#98c379'], ['5', '#56b6c2'], ['6', '#c678dd'],
];

function nodeColor(color) {
  return color?.startsWith('#') ? color : PRESET_COLORS.find(([id]) => id === color)?.[1] || 'var(--border)';
}

function sidePoint(node, side, xOffset, yOffset) {
  if (side === 'top') return { x: xOffset + node.x + node.width / 2, y: yOffset + node.y };
  if (side === 'bottom') return { x: xOffset + node.x + node.width / 2, y: yOffset + node.y + node.height };
  if (side === 'left') return { x: xOffset + node.x, y: yOffset + node.y + node.height / 2 };
  return { x: xOffset + node.x + node.width, y: yOffset + node.y + node.height / 2 };
}

function CanvasNode({
  node, selected, order, xOffset, yOffset, onSelect, onUpdate, onRemove, onOpenFile, onOpenUrl, onOpenLink,
  onStartGesture, paths, t,
}) {
  const accent = nodeColor(node.color);
  const [editingText, setEditingText] = useState(node.type === 'text' && !node.text);
  return (
    <article
      className={`canvas-node canvas-node-${node.type}${selected ? ' selected' : ''}`}
      data-node-id={node.id}
      style={{
        left: node.x, top: node.y, width: node.width, height: node.height,
        zIndex: order + 2, '--canvas-node-accent': accent,
      }}
      onClick={(event) => { event.stopPropagation(); onSelect(node.id); }}
    >
      <header className="canvas-node-header" data-drag-handle
        onPointerDown={(event) => {
          if (event.button !== 0 || event.target.closest('button, input')) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          onStartGesture(event, {
            id: node.id, type: 'move', x: node.x - xOffset, y: node.y - yOffset,
          });
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
          : <Preview className="canvas-node-preview" content={node.text} resolve={(target) => resolveLink(target, paths)}
            onOpenLink={onOpenLink} onTagClick={() => {}} />)}
        {node.type === 'file' && <>
          <input aria-label={t('File path')} placeholder={t('Vault-relative file path')} value={node.file}
            onChange={(event) => onUpdate(node.id, { file: event.target.value })} />
          {node.subpath !== undefined && <input aria-label={t('File subpath')} value={node.subpath}
            onChange={(event) => onUpdate(node.id, { subpath: event.target.value })} />}
          <button className="link-btn canvas-open-file" disabled={!resolveLink(node.file, paths)}
            onClick={() => {
              const path = resolveLink(node.file, paths);
              if (path) onOpenFile(path, node.subpath);
            }}>{node.file || t('Open file')}</button>
        </>}
        {node.type === 'link' && <>
          <input aria-label={t('URL')} placeholder="https://" value={node.url}
            onChange={(event) => onUpdate(node.id, { url: event.target.value })} />
          <button className="link-btn canvas-open-file" disabled={!/^https?:\/\//i.test(node.url)}
            onClick={() => onOpenUrl(node.url)}>{node.url || t('Open link')}</button>
        </>}
        {node.type === 'group' && <>
          <input aria-label={t('Group label')} placeholder={t('Group label')} value={node.label || ''}
            onChange={(event) => onUpdate(node.id, { label: event.target.value })} />
          <span className="canvas-group-hint">{t('Place other nodes over this group to organize them.')}</span>
        </>}
      </div>
      {selected && <button className="canvas-resize-handle" aria-label={t('Resize node')}
        onPointerDown={(event) => {
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          onStartGesture(event, { id: node.id, type: 'resize', width: node.width, height: node.height });
        }} />}
    </article>
  );
}

function CanvasBoard({ canvas, onChange, paths, onOpenFile, onOpenUrl, onOpenLink, t }) {
  const gestureRef = useRef(null);
  const [gesture, setGesture] = useState(null);
  const [mode, setMode] = useState('canvas');
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [connectionStart, setConnectionStart] = useState(null);
  const [relationType, setRelationType] = useState('supports');
  const node = canvas.nodes.find((item) => item.id === selectedNode);
  const edge = canvas.edges.find((item) => item.id === selectedEdge);
  const minX = Math.min(0, ...canvas.nodes.map((item) => item.x)) - 240;
  const minY = Math.min(0, ...canvas.nodes.map((item) => item.y)) - 180;
  const width = Math.max(1400, ...canvas.nodes.map((item) => item.x + item.width - minX + 240));
  const height = Math.max(900, ...canvas.nodes.map((item) => item.y + item.height - minY + 180));
  const xOffset = -minX;
  const yOffset = -minY;
  const renderedNodes = canvas.nodes.map((item) => {
    if (!gesture || gesture.type !== 'move' || gesture.id !== item.id) return item;
    return { ...item, x: gesture.x + gesture.dx, y: gesture.y + gesture.dy };
  });

  const update = (next) => onChange(serializeCanvas(next));
  const updateNode = (id, changes) => update({
    ...canvas,
    nodes: canvas.nodes.map((item) => item.id === id ? { ...item, ...changes } : item),
  });
  const removeNode = (id) => {
    update({ ...canvas, nodes: canvas.nodes.filter((item) => item.id !== id),
      edges: canvas.edges.filter((item) => item.fromNode !== id && item.toNode !== id) });
    setSelectedNode(null);
  };
  const addNode = (type) => {
    const nextNode = createCanvasNode(type, canvas.nodes.length);
    update({ ...canvas, nodes: [...canvas.nodes, nextNode] });
    setSelectedNode(nextNode.id);
    setSelectedEdge(null);
  };
  const selectNode = (id) => {
    if (connecting) {
      if (!connectionStart) {
        setConnectionStart(id);
        return;
      }
      if (connectionStart !== id) {
        const next = mode === 'arguments'
          ? createArgumentEdge(connectionStart, id, relationType)
          : { id: createCanvasId(), fromNode: connectionStart, toNode: id,
            fromSide: 'right', toSide: 'left', toEnd: 'arrow' };
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
  };
  const startGesture = (event, data) => {
    const { id, type, x, y, width: nodeWidth, height: nodeHeight } = data;
    const next = {
      id, type, clientX: event.clientX, clientY: event.clientY,
      x, y, width: nodeWidth, height: nodeHeight, dx: 0, dy: 0,
    };
    gestureRef.current = next;
    setGesture(next);
  };
  const moveGesture = (event) => {
    const current = gestureRef.current;
    if (!current) return;
    const next = { ...current, dx: event.clientX - current.clientX, dy: event.clientY - current.clientY };
    gestureRef.current = next;
    setGesture(next);
  };
  const endGesture = () => {
    const current = gestureRef.current;
    if (current) {
      if (current.type === 'move') updateNode(current.id, {
        x: Math.round(current.x + current.dx), y: Math.round(current.y + current.dy),
      });
      else updateNode(current.id, {
        width: Math.max(180, Math.round(current.width + current.dx)),
        height: Math.max(100, Math.round(current.height + current.dy)),
      });
    }
    gestureRef.current = null;
    setGesture(null);
  };

  return (
    <div className="canvas-editor">
      <div className="canvas-toolbar">
        <label className="canvas-mode-control">{t('Canvas mode')}
          <select aria-label={t('Canvas mode')} value={mode} onChange={(event) => {
            setMode(event.target.value);
            setConnecting(false);
            setConnectionStart(null);
            setSelectedEdge(null);
          }}>
            <option value="canvas">{t('Canvas')}</option>
            <option value="arguments">{t('Argument map')}</option>
          </select>
        </label>
        {mode === 'canvas'
          ? ['text', 'file', 'link', 'group'].map((type) => <button key={type} onClick={() => addNode(type)}>
            {t('Add {type}', { type: t(type) })}
          </button>)
          : <button onClick={() => addNode('text')}>{t('Add argument')}</button>}
        <button className={connecting ? 'active' : ''} onClick={() => {
          setConnecting((value) => !value);
          setConnectionStart(null);
        }}>{connecting ? t('Cancel connection') : t('Connect nodes')}</button>
        {selectedNode && <button onClick={() => removeNode(selectedNode)}>{t('Delete node')}</button>}
        {edge && <button onClick={() => {
          update({ ...canvas, edges: canvas.edges.filter((item) => item.id !== edge.id) });
          setSelectedEdge(null);
        }}>{t('Delete connection')}</button>}
        {mode === 'arguments' && <label className="canvas-mode-control">{t('Relation')}
          <select aria-label={t('Relation')} value={relationType} onChange={(event) => setRelationType(event.target.value)}>
            <option value="supports">{t('Supports')}</option>
            <option value="answers">{t('Answers')}</option>
            <option value="contradicts">{t('Contradicts')}</option>
          </select>
        </label>}
        {connecting && <span className="canvas-hint" role="status">
          {t(connectionStart ? 'Select the target node.' : 'Select a starting node.')}
        </span>}
      </div>
      {node && <div className="canvas-inspector">
        <label>{t('Node color')}
          <select aria-label={t('Node color')} value={node.color || ''}
            onChange={(event) => updateNode(node.id, { color: event.target.value || undefined })}>
            <option value="">{t('Default')}</option>
            {PRESET_COLORS.map(([value]) => <option key={value} value={value}>{t('Color {number}', { number: value })}</option>)}
          </select>
        </label>
      </div>}
      {edge && <div className="canvas-inspector">
        <label>{t('Connection label')}<input aria-label={t('Connection label')} value={edge.label || ''}
          onChange={(event) => update({ ...canvas, edges: canvas.edges.map((item) =>
            item.id === edge.id ? { ...item, label: event.target.value } : item) })} /></label>
        <label>{t('Connection color')}<select aria-label={t('Connection color')} value={edge.color || ''}
          onChange={(event) => update({ ...canvas, edges: canvas.edges.map((item) =>
            item.id === edge.id ? { ...item, color: event.target.value || undefined } : item) })}>
          <option value="">{t('Default')}</option>
          {PRESET_COLORS.map(([value]) => <option key={value} value={value}>{t('Color {number}', { number: value })}</option>)}
        </select></label>
        <label>{t('Endpoint')}<select aria-label={t('Endpoint')} value={edge.toEnd || 'arrow'}
          onChange={(event) => update({ ...canvas, edges: canvas.edges.map((item) =>
            item.id === edge.id ? { ...item, toEnd: event.target.value } : item) })}>
          <option value="arrow">{t('Arrow')}</option><option value="none">{t('None')}</option>
        </select></label>
      </div>}
      <div className="canvas-board-wrap">
        <div className="canvas-board" style={{ width, height }}
          onPointerMove={moveGesture} onPointerUp={endGesture} onPointerCancel={endGesture}
          onClick={() => { setSelectedNode(null); setSelectedEdge(null); }}>
          <svg className="canvas-edges" width={width} height={height} aria-label={t('Canvas connections')}>
            <defs>{canvas.edges.map((item, index) => <marker key={item.id} id={`canvas-arrow-${index}`}
            markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"
            markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 z" fill={nodeColor(item.color)} /></marker>)}</defs>
            {canvas.edges.map((item, index) => {
              const from = renderedNodes.find((candidate) => candidate.id === item.fromNode);
              const to = renderedNodes.find((candidate) => candidate.id === item.toNode);
              if (!from || !to) return null;
              const a = sidePoint(from, item.fromSide || 'right', xOffset, yOffset);
              const b = sidePoint(to, item.toSide || 'left', xOffset, yOffset);
              const selected = item.id === selectedEdge;
              return <g key={item.id} className={selected ? 'selected' : ''}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedEdge(item.id);
                  setSelectedNode(null);
                }}>
                <line className="canvas-edge-hit" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                <line className="canvas-edge-line" x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={nodeColor(item.color)}
                  markerStart={item.fromEnd === 'arrow' ? `url(#canvas-arrow-${index})` : undefined}
                  markerEnd={(item.toEnd || 'arrow') === 'arrow' ? `url(#canvas-arrow-${index})` : undefined} />
                {item.label && <text className="canvas-edge-label" x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 6}>{item.label}</text>}
              </g>;
            })}
          </svg>
          <div className="canvas-nodes">
            {renderedNodes.map((item, index) => <CanvasNode key={item.id} node={{ ...item, x: item.x + xOffset, y: item.y + yOffset }}
              selected={item.id === selectedNode || (connecting && item.id === connectionStart)} order={index}
              xOffset={xOffset} yOffset={yOffset} onStartGesture={startGesture}
              onSelect={selectNode} onUpdate={updateNode} onRemove={removeNode}
              onOpenFile={onOpenFile} onOpenUrl={onOpenUrl} onOpenLink={onOpenLink} paths={paths} t={t} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CanvasView({
  path, content, mode, setMode, onChange, onRename, onOpenHistory, paths, onOpenFile, onOpenUrl, onOpenLink,
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
        {parsed.error && <div className="editor-notice source-fallback" role="alert">{parsed.error}</div>}
        <CodeMirror className="canvas-json-editor" value={content} onChange={onChange} extensions={[json()]}
          theme="none" height="100%" autoFocus />
      </> : parsed.error ? <div className="canvas-invalid" role="alert">
        <h2>{t('Invalid Canvas JSON')}</h2><p>{parsed.error}</p>
        <button onClick={() => setMode('edit')}>{t('Open JSON source')}</button>
      </div> : <CanvasBoard canvas={parsed.canvas} onChange={onChange} paths={paths}
        onOpenFile={onOpenFile} onOpenUrl={onOpenUrl} onOpenLink={onOpenLink} t={t} />}
    </div>
  );
}
