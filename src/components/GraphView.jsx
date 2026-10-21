import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.js';
import { displayName } from '../lib/vault.js';

function nodeColor(tags) {
  if (tags.includes('aff')) return '--aff';
  if (tags.includes('neg')) return '--neg';
  if (tags.includes('opponent')) return '--warning';
  return '--text-muted';
}

function buildGraph(index, activePath, local, showOrphans, showMarkdownExtension) {
  const md = index.paths.filter((p) => p.endsWith('.md'));
  const tagsOf = {};
  for (const [tag, ps] of Object.entries(index.tags)) for (const p of ps) (tagsOf[p] ||= []).push(tag);
  let edges = [];
  for (const [src, targets] of Object.entries(index.links)) for (const t of targets) if (t !== src) edges.push([src, t]);
  let include = new Set(md);
  if (local && activePath) {
    include = new Set([activePath]);
    for (const [a, b] of edges) {
      if (a === activePath) include.add(b);
      if (b === activePath) include.add(a);
    }
  } else if (!showOrphans) {
    include = new Set(edges.flat());
  }
  edges = edges.filter(([a, b]) => include.has(a) && include.has(b));
  const degree = {};
  for (const [a, b] of edges) {
    degree[a] = (degree[a] || 0) + 1;
    degree[b] = (degree[b] || 0) + 1;
  }
  const nodes = [...include].map((p) => ({
    id: p,
    label: displayName(p, true, showMarkdownExtension),
    r: 4 + Math.sqrt(degree[p] || 0) * 2.5,
    color: nodeColor(tagsOf[p] || []),
  }));
  return { nodes, edges };
}

export default function GraphView({ index, activePath, onOpen, showMarkdownExtension = false }) {
  const { t } = useI18n();
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [local, setLocal] = useState(false);
  const [showOrphans, setShowOrphans] = useState(true);
  const live = useRef({});
  live.current = { onOpen, activePath };
  const localRoot = local ? activePath : null;
  const graph = useMemo(() => buildGraph(index, localRoot, !!localRoot, showOrphans, showMarkdownExtension), [index, localRoot, showOrphans, showMarkdownExtension]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const ctx = canvas.getContext('2d');
    const pos = new Map();
    graph.nodes.forEach((n, i) => {
      const a = (i / Math.max(1, graph.nodes.length)) * Math.PI * 2;
      pos.set(n.id, { x: Math.cos(a) * 150 + Math.random() * 10, y: Math.sin(a) * 150 + Math.random() * 10, vx: 0, vy: 0 });
    });
    const neighbors = new Map(graph.nodes.map((n) => [n.id, new Set()]));
    for (const [a, b] of graph.edges) {
      neighbors.get(a).add(b);
      neighbors.get(b).add(a);
    }

    let view = { x: 0, y: 0, k: 1 };
    let hover = null;
    let drag = null;
    let alpha = 1;
    let raf = 0;
    let w = 0;
    let h = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      w = wrap.clientWidth;
      h = wrap.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const toWorld = (cx, cy) => ({ x: (cx - w / 2 - view.x) / view.k, y: (cy - h / 2 - view.y) / view.k });
    const nodeAt = (cx, cy) => {
      const p = toWorld(cx, cy);
      return graph.nodes.find((n) => {
        const q = pos.get(n.id);
        return (q.x - p.x) ** 2 + (q.y - p.y) ** 2 <= (n.r + 4) ** 2;
      });
    };

    const step = () => {
      const ns = graph.nodes;
      for (let i = 0; i < ns.length; i++) {
        const a = pos.get(ns[i].id);
        for (let j = i + 1; j < ns.length; j++) {
          const b = pos.get(ns[j].id);
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          const d2 = dx * dx + dy * dy || 0.01;
          const f = (900 / d2) * alpha;
          const d = Math.sqrt(d2);
          dx /= d;
          dy /= d;
          a.vx += dx * f; a.vy += dy * f;
          b.vx -= dx * f; b.vy -= dy * f;
        }
        a.vx -= a.x * 0.002 * alpha;
        a.vy -= a.y * 0.002 * alpha;
      }
      for (const [s, t] of graph.edges) {
        const a = pos.get(s);
        const b = pos.get(t);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = ((d - 90) / d) * 0.03 * alpha;
        a.vx += dx * f; a.vy += dy * f;
        b.vx -= dx * f; b.vy -= dy * f;
      }
      for (const n of ns) {
        const p = pos.get(n.id);
        if (drag && drag.node === n) continue;
        p.vx *= 0.6;
        p.vy *= 0.6;
        p.x += p.vx;
        p.y += p.vy;
      }
      alpha = Math.max(0.02, alpha * 0.995);
    };

    let colors;
    const readColors = () => {
      const styles = getComputedStyle(document.documentElement);
      colors = Object.fromEntries(['--text', '--border', '--accent', '--aff', '--neg', '--warning', '--text-muted']
        .map((key) => [key, styles.getPropertyValue(key).trim()]));
    };
    readColors();
    window.addEventListener('themechange', readColors);

    const draw = () => {
      step();
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2 + view.x, h / 2 + view.y);
      ctx.scale(view.k, view.k);
      const focus = hover?.id;
      for (const [s, t] of graph.edges) {
        const a = pos.get(s);
        const b = pos.get(t);
        const hot = focus && (s === focus || t === focus);
        ctx.strokeStyle = colors[hot ? '--accent' : '--border'];
        ctx.globalAlpha = focus && !hot ? 0.25 : 1;
        ctx.lineWidth = hot ? 1.6 / view.k : 1 / view.k;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      for (const n of graph.nodes) {
        const p = pos.get(n.id);
        const dim = focus && n.id !== focus && !neighbors.get(focus)?.has(n.id);
        ctx.globalAlpha = dim ? 0.25 : 1;
        ctx.fillStyle = colors[n.id === live.current.activePath ? '--accent' : n.color];
        ctx.beginPath();
        ctx.arc(p.x, p.y, n.r, 0, Math.PI * 2);
        ctx.fill();
        if (view.k > 0.6 || n.id === focus) {
          ctx.fillStyle = colors['--text'];
          ctx.font = `${12 / Math.max(view.k, 0.8)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(n.label, p.x, p.y + n.r + 12 / Math.max(view.k, 0.8));
        }
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const rect = () => canvas.getBoundingClientRect();
    const onDown = (e) => {
      const r = rect();
      const n = nodeAt(e.clientX - r.left, e.clientY - r.top);
      drag = { node: n, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
    };
    const onMove = (e) => {
      const r = rect();
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      if (drag) {
        if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3) drag.moved = true;
        if (drag.node) {
          const p = pos.get(drag.node.id);
          const wpt = toWorld(cx, cy);
          p.x = wpt.x;
          p.y = wpt.y;
          alpha = Math.max(alpha, 0.3);
        } else {
          view.x = drag.vx + (e.clientX - drag.sx);
          view.y = drag.vy + (e.clientY - drag.sy);
        }
      } else {
        hover = nodeAt(cx, cy) || null;
        canvas.style.cursor = hover ? 'pointer' : 'grab';
      }
    };
    const onUp = (e) => {
      if (drag && drag.node && !drag.moved) live.current.onOpen(drag.node.id, e.ctrlKey || e.metaKey);
      drag = null;
    };
    const onWheel = (e) => {
      e.preventDefault();
      const r = rect();
      const cx = e.clientX - r.left - w / 2;
      const cy = e.clientY - r.top - h / 2;
      const k = Math.min(4, Math.max(0.2, view.k * (e.deltaY < 0 ? 1.1 : 0.9)));
      view = { k, x: cx - ((cx - view.x) * k) / view.k, y: cy - ((cy - view.y) * k) / view.k };
    };

    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('themechange', readColors);
      ro.disconnect();
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [graph]);

  return (
    <div className="graph" ref={wrapRef}>
      <canvas ref={canvasRef} />
      <div className="graph-controls">
        <label>
          <input type="checkbox" checked={local} onChange={(e) => setLocal(e.target.checked)} /> {t('Local graph')}
        </label>
        <label>
          <input type="checkbox" checked={showOrphans} onChange={(e) => setShowOrphans(e.target.checked)} /> {t('Orphans')}
        </label>
        <div className="graph-legend">
          <span style={{ color: 'var(--aff)' }}>● #aff</span>
          <span style={{ color: 'var(--neg)' }}>● #neg</span>
          <span style={{ color: 'var(--warning)' }}>● #opponent</span>
        </div>
      </div>
    </div>
  );
}
