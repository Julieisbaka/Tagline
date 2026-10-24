export const RIBBON_ITEMS = [
  { id: 'fileExplorer', icon: 'sidebar', title: 'Toggle file explorer' },
  { id: 'switcher', icon: 'file', title: 'Quick switcher', keybinding: 'switcher' },
  { id: 'search', icon: 'search', title: 'Search', keybinding: 'search' },
  { id: 'graph', icon: 'graph', title: 'Graph view', keybinding: 'graph' },
  { id: 'commands', icon: 'command', title: 'Command palette', keybinding: 'commands' },
  { id: 'import', icon: 'folder', title: 'Import document with Pandoc' },
  { id: 'rightPanel', icon: 'timer', title: 'Toggle right sidebar (timer, backlinks, outline)' },
];

export const DEFAULT_RIBBON_ITEMS = RIBBON_ITEMS.map(({ id }) => id);

export function normalizeRibbonItems(value, contributions = [], hidden = []) {
  if (!Array.isArray(value)) value = DEFAULT_RIBBON_ITEMS;
  const validIds = new Set(RIBBON_ITEMS.map(({ id }) => id));
  const items = [...new Set(value.filter((id) => validIds.has(id) ||
    (typeof id === 'string' && /^ext:[a-z0-9][a-z0-9-]{1,63}\.[a-z0-9][a-z0-9-]{1,63}$/.test(id))))];
  for (const item of contributions) if (!items.includes(item.id) && !hidden.includes(item.id)) items.push(item.id);
  return items;
}

export function moveRibbonItem(items, sourceId, targetId) {
  const next = [...items];
  const sourceIndex = next.indexOf(sourceId);
  const targetIndex = next.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return next;
  next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, sourceId);
  return next;
}
