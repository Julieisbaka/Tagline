import { parseFlow } from '../../../electron/flow.mjs';

/**
 * Build the searchable representation of a .flow document.
 * Sheet and column names become Markdown-style headings so they receive the
 * same ranking bonus as headings in notes; each non-empty cell becomes a line.
 * `cellMap` maps each synthetic line index that holds a cell to
 * `{ sheetIndex, row, column }` so a search-result line can be opened back at
 * that cell. Invalid flow JSON falls back to the raw text so the file stays
 * findable.
 * @param {string} content - The raw .flow file content.
 * @returns {{text: string, cells: string, cellMap: Array<{sheetIndex:number,row:number,column:number}|undefined>}}
 *   Index text, cell-only text, and the synthetic-line to cell map.
 */
export function flowDocument(content) {
  const raw = typeof content === 'string' ? content : '';
  let flow;
  try {
    flow = parseFlow(raw);
  } catch {
    return { text: raw, cells: raw, cellMap: [] };
  }
  const cells = [];
  const lines = [];
  const cellMap = [];
  for (const [sheetIndex, sheet] of flow.sheets.entries()) {
    lines.push(`# ${sheet.name}`);
    cellMap.push(undefined);
    for (const [columnIndex, column] of sheet.columns.entries()) {
      lines.push(`## ${column}`);
      cellMap.push(undefined);
      for (let row = 0; row < sheet.rows.length; row++) {
        const cell = sheet.rows[row][columnIndex] ?? '';
        if (!cell.trim()) {
          continue;
        }
        cells.push(cell);
        lines.push(cell);
        // A textarea cell can contain newlines. The synthetic text is later
        // split on '\n' for match line numbers, so the map needs one entry per
        // physical line or every match after a multiline cell points nowhere.
        const physicalLines = cell.split('\n').length;
        for (let i = 0; i < physicalLines; i++) {
          cellMap.push({ sheetIndex, row, column: columnIndex });
        }
      }
    }
  }
  return { text: lines.join('\n'), cells: cells.join('\n'), cellMap };
}
