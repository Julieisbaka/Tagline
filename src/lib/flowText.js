import { parseFlow } from '../../electron/flow.mjs';

/**
 * Build the searchable representation of a .flow document.
 * Sheet and column names become Markdown-style headings so they receive the
 * same ranking bonus as headings in notes; each non-empty cell becomes a line.
 * Invalid flow JSON falls back to the raw text so the file stays findable.
 * @param {string} content - The raw .flow file content.
 * @returns {{text: string, cells: string}} - Index text and cell-only text.
 */
export function flowDocument(content) {
  const raw = typeof content === 'string' ? content : '';
  let flow;
  try {
    flow = parseFlow(raw);
  } catch {
    return { text: raw, cells: raw };
  }
  const cells = [];
  const lines = [];
  for (const sheet of flow.sheets) {
    lines.push(`# ${sheet.name}`);
    for (const [index, column] of sheet.columns.entries()) {
      lines.push(`## ${column}`);
      for (const row of sheet.rows) {
        const cell = row[index] ?? '';
        if (!cell.trim()) {
          continue;
        }
        cells.push(cell);
        lines.push(cell);
      }
    }
  }
  return { text: lines.join('\n'), cells: cells.join('\n') };
}
