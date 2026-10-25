import { memo, useCallback, useMemo } from 'react';
import { parseFlow } from '../../electron/flow.mjs';
import { parseCanvas } from '../lib/canvas.js';
import { useI18n } from '../lib/i18n.js';
import { slugify } from '../lib/markdown.js';
import { isCanvas, isFlow, isMarkdown, outline, resolveLink } from '../lib/vault.js';
import Preview from './Preview.jsx';

export default memo(function CanvasFilePreview({ path, subpath, contents, paths, onOpenLink }) {
  const { t } = useI18n();
  const content = path ? contents[path] : undefined;
  const resolve = useCallback((target) => resolveLink(target, paths), [paths]);
  const parsed = useMemo(() => {
    if (content === undefined) return {};
    try {
      if (isFlow(path)) return { flow: parseFlow(content) };
      if (isCanvas(path)) return { canvas: parseCanvas(content) };
      let text = content;
      if (subpath?.startsWith('#')) {
        const headings = outline(content);
        const start = headings.findIndex((heading) => slugify(heading.text) === slugify(subpath.slice(1)));
        if (start >= 0) {
          const end = headings.slice(start + 1).find((heading) => heading.level <= headings[start].level);
          text = content.split('\n').slice(headings[start].line, end?.line).join('\n');
        }
      }
      return { text };
    } catch (error) { return { error: error.message }; }
  }, [path, content, subpath]);
  const nodesById = useMemo(() => new Map(parsed.canvas?.nodes.map((node) => [node.id, node])), [parsed.canvas]);
  if (!path) return null;
  if (content === undefined) return <p role="status">{t('Loading…')}</p>;
  if (parsed.error) return <p className="error-text" role="alert">{parsed.error}</p>;
  if (isMarkdown(path)) return <Preview className="canvas-node-preview" content={parsed.text}
    resolve={resolve} onOpenLink={onOpenLink} onTagClick={() => { }} />;
  if (parsed.flow) return <div className="canvas-node-preview canvas-file-flow">
    {parsed.flow.sheets.map((sheet, index) => <section key={index}>
      <strong>{sheet.name}</strong>
      <table><thead><tr>{sheet.columns.map((column, c) => <th key={c}>{column}</th>)}</tr></thead>
        <tbody>{sheet.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </section>)}
  </div>;
  const nodes = parsed.canvas?.nodes || [];
  const left = Math.min(0, ...nodes.map((node) => node.x));
  const top = Math.min(0, ...nodes.map((node) => node.y));
  const width = Math.max(1, ...nodes.map((node) => node.x + node.width)) - left;
  const height = Math.max(1, ...nodes.map((node) => node.y + node.height)) - top;
  return <svg className="canvas-file-map" role="img" aria-label={t('Canvas preview')}
    viewBox={`${left - 10} ${top - 10} ${width + 20} ${height + 20}`}>
    {parsed.canvas?.edges.map((edge) => {
      const from = nodesById.get(edge.fromNode);
      const to = nodesById.get(edge.toNode);
      return <line key={edge.id} x1={from.x + from.width / 2} y1={from.y + from.height / 2}
        x2={to.x + to.width / 2} y2={to.y + to.height / 2} />;
    })}
    {nodes.map((node) => <g key={node.id}>
      <rect x={node.x} y={node.y} width={node.width} height={node.height} />
      <text x={node.x + 8} y={node.y + 20}>{(node.text || node.file || node.url || node.label || '').slice(0, 40)}</text>
    </g>)}
  </svg>;
});
