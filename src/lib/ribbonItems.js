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

export function normalizeRibbonItems(value) {
  if (!Array.isArray(value)) return [...DEFAULT_RIBBON_ITEMS];
  const validIds = new Set(RIBBON_ITEMS.map(({ id }) => id));
  return [...new Set(value.filter((id) => validIds.has(id)))];
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
