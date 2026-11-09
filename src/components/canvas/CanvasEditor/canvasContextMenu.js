import { createCanvasId, resolveCanvasLink } from '../../../lib/canvas.js';
import { resolveLink } from '../../../lib/vault.js';

export default function openCanvasContextMenu(
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
) {
  event.preventDefault?.();
  event.stopPropagation?.();
  const targetNode = canvas.nodes.find((item) => item.id === nodeId);
  const targetEdge = canvas.edges.find((item) => item.id === edgeId);
  const items = targetNode
    ? [
        ...(targetNode.type === 'file'
          ? [
              {
                label: 'Open file',
                disabled: !resolveLink(targetNode.file, paths),
                run: () => onOpenFile(resolveLink(targetNode.file, paths), targetNode.subpath),
              },
            ]
          : []),
        ...(targetNode.type === 'link'
          ? [
              {
                label: 'Open link',
                disabled: !resolveCanvasLink(targetNode.url, paths),
                run: () => {
                  const link = resolveCanvasLink(targetNode.url, paths);
                  if (link.type === 'file') {
                    onOpenFile(link.path, link.heading ? `#${link.heading}` : undefined);
                  } else {
                    onOpenUrl(link.url);
                  }
                },
              },
            ]
          : []),
        ...(targetNode.type !== 'group'
          ? [
              {
                label: 'Duplicate node',
                run: () => {
                  const copy = {
                    ...targetNode,
                    id: createCanvasId(),
                    x: targetNode.x + 32,
                    y: targetNode.y + 32,
                  };
                  update({ ...canvas, nodes: [...canvas.nodes, copy] });
                  setSelectedNode(copy.id);
                },
              },
              { label: 'Group node', run: () => addNode('group', undefined, targetNode) },
            ]
          : []),
        {
          label: 'Connect nodes',
          command: 'canvas-connect',
          run: () => {
            setConnectionStart(targetNode.id);
            setConnecting(true);
          },
        },
        {
          label: 'Delete node',
          command: 'canvas-delete',
          danger: true,
          run: () => removeNode(targetNode.id),
        },
      ]
    : targetEdge
      ? [
          {
            label: 'Reverse connection',
            run: () =>
              update({
                ...canvas,
                edges: canvas.edges.map((item) =>
                  item.id === targetEdge.id
                    ? {
                        ...item,
                        fromNode: item.toNode,
                        toNode: item.fromNode,
                        fromSide: item.toSide || 'left',
                        toSide: item.fromSide || 'right',
                        fromEnd: item.toEnd || 'arrow',
                        toEnd: item.fromEnd || 'none',
                      }
                    : item
                ),
              }),
          },
          {
            label: 'Delete connection',
            command: 'canvas-delete',
            danger: true,
            run: () => {
              update({
                ...canvas,
                edges: canvas.edges.filter((item) => item.id !== targetEdge.id),
              });
              setSelectedEdge(null);
            },
          },
        ]
      : ['text', 'file', 'link', 'group'].map((type) => ({
          label: t('Add {type}', { type: t(type) }),
          command: `canvas-add-${type}`,
          run: () => addNode(type, position, null),
        }));
  setSelectedNode(targetNode?.id || null);
  setSelectedEdge(targetEdge?.id || null);
  setMenu({
    x: event.clientX,
    y: event.clientY,
    items: [...items, { label: 'Open JSON source', run: onEditSource }],
  });
}
