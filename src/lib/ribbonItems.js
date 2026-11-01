export const RIBBON_ITEMS = [
  { id: 'fileExplorer', icon: 'sidebar', title: 'Toggle file explorer' },
  { id: 'switcher', icon: 'file', title: 'Quick switcher', keybinding: 'switcher' },
  { id: 'search', icon: 'search', title: 'Search', keybinding: 'search' },
  { id: 'graph', icon: 'graph', title: 'Graph view', keybinding: 'graph' },
  { id: 'commands', icon: 'command', title: 'Command palette', keybinding: 'commands' },
  { id: 'import', icon: 'folder', title: 'Import document with Pandoc' },
  { id: 'rightPanel', icon: 'timer', title: 'Toggle right sidebar (timer, backlinks, outline)' },
  { id: 'evidenceCheckup', icon: 'checklist', title: 'Evidence checkup', keybinding: 'evidence-checkup', defaultVisible: false },
];

export const DEFAULT_RIBBON_ITEMS = RIBBON_ITEMS.filter((item) => item.defaultVisible !== false).map(({ id }) => id);

/** 
 * Normalize built-in and extension ribbon IDs while preserving contribution order.
 * This function ensures that the ribbon items array contains only valid built-in or extension IDs, appends contributions that are not hidden, and maintains the original order of items.
 * @param {unknown} value - The input array of ribbon item IDs to normalize.
 * @param {object[]} [contributions] - An array of additional ribbon item contributions, each with an `id` property.
 * @param {string[]} [hidden] - An array of ribbon item IDs that should be excluded from the final list.
 * @returns {string[]} - A normalized array of ribbon item IDs.
 */
export function normalizeRibbonItems(value, contributions = [], hidden = []) {
  if (!Array.isArray(value)) value = DEFAULT_RIBBON_ITEMS;
  const validIds = new Set(RIBBON_ITEMS.map(({ id }) => id));
  const items = [...new Set(value.filter((id) => validIds.has(id) ||
    (typeof id === 'string' && /^ext:[a-z0-9][a-z0-9-]{1,63}\.[a-z0-9][a-z0-9-]{1,63}$/.test(id))))];
  for (const item of contributions) if (!items.includes(item.id) && !hidden.includes(item.id)) items.push(item.id);
  return items;
}

/** 
 * Move one ribbon item to another item's position without mutating the input.
 * This function creates a new array with the specified source item relocated to the position of the target item, preserving the order of other items.
 * @param {string[]} items - The array of ribbon item IDs.
 * @param {string} sourceId - The ID of the ribbon item to move.
 * @param {string} targetId - The ID of the ribbon item to move the source item before.
 * @returns {string[]} - A new array with the ribbon items reordered.
 */
export function moveRibbonItem(items, sourceId, targetId) {
  const next = [...items];
  const sourceIndex = next.indexOf(sourceId);
  const targetIndex = next.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return next;
  next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, sourceId);
  return next;
}
