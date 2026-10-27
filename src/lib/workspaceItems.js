export const FILE_ACTIONS = [
  { id: 'newNote', title: 'New note', icon: 'file-plus' },
  { id: 'newFlow', title: 'New flow', icon: 'flow' },
  { id: 'newCanvas', title: 'New canvas', icon: 'canvas' },
  { id: 'newFolder', title: 'New folder', icon: 'folder-plus' },
  { id: 'refresh', title: 'Refresh' },
];

export const STATUS_ITEMS = [
  { id: 'section', title: 'Current card' },
  { id: 'cards', title: 'Card count' },
  { id: 'words', title: 'Word count' },
  { id: 'highlighted', title: 'Highlighted words and reading time' },
  { id: 'estimate', title: 'Speech estimate type' },
  { id: 'readability', title: 'Readability' },
  { id: 'speechDoc', title: 'Speech document' },
  { id: 'mode', title: 'Editing mode' },
];

/** Normalize the visible workspace item order against the supplied catalog. @param {unknown} value @param {object[]} catalog @returns {string[]} */
export function normalizeWorkspaceItems(value, catalog) {
  const ids = catalog.map((item) => item.id);
  return Array.isArray(value) ? [...new Set(value.filter((id) => ids.includes(id)))] : ids;
}

/** Move one workspace item to another item's position without mutating the input. @param {string[]} items @param {string} id @param {string} target @returns {string[]} */
export function moveWorkspaceItem(items, id, target) {
  if (id === target || !items.includes(id) || !items.includes(target)) return items;
  const next = [...items];
  next.splice(items.indexOf(id), 1);
  next.splice(items.indexOf(target), 0, id);
  return next;
}
