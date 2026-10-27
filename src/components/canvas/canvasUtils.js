export const PRESET_COLORS = [
  ['1', '#e06c75', 'Red'], ['2', '#d19a66', 'Orange'], ['3', '#e5c07b', 'Yellow'],
  ['4', '#98c379', 'Green'], ['5', '#56b6c2', 'Cyan'], ['6', '#c678dd', 'Purple'],
];

export function nodeColor(color) {
  return color?.startsWith('#') ? color : PRESET_COLORS.find(([id]) => id === color)?.[1] || 'var(--border)';
}

export function sidePoint(node, side) {
  if (side === 'top') return { x: node.x + node.width / 2, y: node.y };
  if (side === 'bottom') return { x: node.x + node.width / 2, y: node.y + node.height };
  if (side === 'left') return { x: node.x, y: node.y + node.height / 2 };
  return { x: node.x + node.width, y: node.y + node.height / 2 };
}
