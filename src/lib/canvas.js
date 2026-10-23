const NODE_TYPES = new Set(['text', 'file', 'link', 'group']);
const SIDES = new Set(['top', 'right', 'bottom', 'left']);
const ENDS = new Set(['none', 'arrow']);
const BACKGROUND_STYLES = new Set(['cover', 'ratio', 'repeat']);

export const EMPTY_CANVAS = `${JSON.stringify({ nodes: [], edges: [] }, null, 2)}\n`;

export function createCanvasId() {
  return globalThis.crypto?.randomUUID?.() || `canvas-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
}

function validateColor(value, label) {
  if (value === undefined) return;
  requireString(value, label);
  if (!/^(?:[1-6]|#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8})$/i.test(value)) {
    throw new Error(`${label} must be a preset color (1–6) or a hex color.`);
  }
}

export function parseCanvas(content) {
  if (typeof content !== 'string') throw new Error('Canvas content must be JSON text.');
  let canvas;
  try {
    canvas = JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid Canvas JSON: ${error.message}`);
  }
  if (!isRecord(canvas)) throw new Error('Canvas JSON must be an object.');
  const nodes = canvas.nodes === undefined ? [] : canvas.nodes;
  const edges = canvas.edges === undefined ? [] : canvas.edges;
  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    throw new Error('Canvas nodes and edges must be arrays.');
  }

  const ids = new Set();
  const nodeIds = new Set();
  for (const [index, node] of nodes.entries()) {
    const label = `Node ${index + 1}`;
    if (!isRecord(node)) throw new Error(`${label} must be an object.`);
    requireString(node.id, `${label} id`);
    if (!node.id.trim() || ids.has(node.id)) throw new Error(`${label} id must be unique and non-empty.`);
    ids.add(node.id);
    nodeIds.add(node.id);
    if (!NODE_TYPES.has(node.type)) throw new Error(`${label} has an unsupported type.`);
    for (const key of ['x', 'y', 'width', 'height']) {
      if (!Number.isSafeInteger(node[key])) throw new Error(`${label} ${key} must be an integer.`);
    }
    if (node.width <= 0 || node.height <= 0) throw new Error(`${label} dimensions must be positive.`);
    validateColor(node.color, `${label} color`);
    if (node.type === 'text') requireString(node.text, `${label} text`);
    if (node.type === 'file') {
      requireString(node.file, `${label} file`);
      if (node.subpath !== undefined && (typeof node.subpath !== 'string' || !node.subpath.startsWith('#'))) {
        throw new Error(`${label} subpath must start with #.`);
      }
    }
    if (node.type === 'link') requireString(node.url, `${label} url`);
    if (node.type === 'group') {
      if (node.label !== undefined) requireString(node.label, `${label} label`);
      if (node.background !== undefined) requireString(node.background, `${label} background`);
      if (node.backgroundStyle !== undefined &&
        (typeof node.backgroundStyle !== 'string' || !BACKGROUND_STYLES.has(node.backgroundStyle))) {
        throw new Error(`${label} backgroundStyle is invalid.`);
      }
    }
  }

  for (const [index, edge] of edges.entries()) {
    const label = `Edge ${index + 1}`;
    if (!isRecord(edge)) throw new Error(`${label} must be an object.`);
    requireString(edge.id, `${label} id`);
    if (!edge.id.trim() || ids.has(edge.id)) throw new Error(`${label} id must be unique and non-empty.`);
    ids.add(edge.id);
    requireString(edge.fromNode, `${label} fromNode`);
    requireString(edge.toNode, `${label} toNode`);
    if (!nodeIds.has(edge.fromNode) || !nodeIds.has(edge.toNode)) {
      throw new Error(`${label} must reference existing nodes.`);
    }
    for (const key of ['fromSide', 'toSide']) {
      if (edge[key] !== undefined && (typeof edge[key] !== 'string' || !SIDES.has(edge[key]))) {
        throw new Error(`${label} ${key} is invalid.`);
      }
    }
    for (const key of ['fromEnd', 'toEnd']) {
      if (edge[key] !== undefined && (typeof edge[key] !== 'string' || !ENDS.has(edge[key]))) {
        throw new Error(`${label} ${key} is invalid.`);
      }
    }
    validateColor(edge.color, `${label} color`);
    if (edge.label !== undefined) requireString(edge.label, `${label} label`);
  }
  return { ...canvas, nodes, edges };
}

export function serializeCanvas(canvas) {
  return `${JSON.stringify(parseCanvas(JSON.stringify(canvas)), null, 2)}\n`;
}

export function createCanvasNode(type, index, id = createCanvasId()) {
  if (!NODE_TYPES.has(type)) throw new Error(`Unsupported Canvas node type: ${type}`);
  const node = {
    id,
    type,
    x: 80 + (index % 4) * 320,
    y: 80 + Math.floor(index / 4) * 240,
    width: type === 'group' ? 360 : 280,
    height: type === 'group' ? 240 : 180,
  };
  if (type === 'text') node.text = '';
  if (type === 'file') node.file = '';
  if (type === 'link') node.url = '';
  if (type === 'group') node.label = 'Group';
  return node;
}
