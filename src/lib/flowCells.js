/** 
 * Calculate inclusive rectangular bounds for two zero-based cell positions. 
 * @param {{row:number,column:number}} anchor 
 * @param {{row:number,column:number}} head 
 * @returns {{top:number,bottom:number,left:number,right:number}} 
 */
export function cellBounds(anchor, head) {
  return {
    top: Math.min(anchor.row, head.row), bottom: Math.max(anchor.row, head.row),
    left: Math.min(anchor.column, head.column), right: Math.max(anchor.column, head.column),
  };
}

/** 
 * Serialize a rectangular cell range as quoted tab-separated text. 
 * @param {string[][]} rows 
 * @param {{top:number,bottom:number,left:number,right:number}} bounds 
 * @returns {string} 
 */
export function copyFlowCells(rows, bounds) {
  /** 
   * Quote a cell only when TSV syntax requires escaping. 
   * @param {string} text 
   * @returns {string} 
   */
  const quote = (text) => /[\t\r\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  return rows.slice(bounds.top, bounds.bottom + 1)
    .map((row) => row.slice(bounds.left, bounds.right + 1).map(quote).join('\t')).join('\n');
}

/** 
 * Parse quoted tab-separated cell text into rows, rejecting unclosed quotes. 
 * @param {string} text 
 * @returns {string[][]} 
 */
export function parseFlowCells(text) {
  const rows = [[]];
  let cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && (quoted || cell === '')) {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === '\t' || char === '\n' || char === '\r')) {
      rows.at(-1).push(cell); cell = '';
      if (char !== '\t') {
        if (char === '\r' && text[i + 1] === '\n') i++;
        rows.push([]);
      }
    } else cell += char;
  }
  if (quoted) throw new Error('The pasted cell data has an unclosed quoted value.');
  rows.at(-1).push(cell);
  if (rows.length > 1 && rows.at(-1).length === 1 && rows.at(-1)[0] === '' && /[\r\n]$/.test(text)) rows.pop();
  return rows;
}

/** 
 * Return a copied sheet with cells pasted at the given zero-based position. 
 * @param {{columns:string[],rows:string[][]}} sheet 
 * @param {number} top 
 * @param {number} left 
 * @param {string[][]} cells 
 * @returns {{columns:string[],rows:string[][]}} 
 */
export function pasteFlowCells(sheet, top, left, cells) {
  const width = Math.max(sheet.columns.length, left + Math.max(...cells.map((row) => row.length)));
  const height = Math.max(sheet.rows.length, top + cells.length);
  if (width * height > 100000) throw new Error('Pasting would exceed 100,000 flow cells.');
  const columns = [...sheet.columns, ...Array.from({ length: width - sheet.columns.length }, () => 'New')];
  const rows = Array.from({ length: height }, (_, r) =>
    Array.from({ length: width }, (_, c) => cells[r - top]?.[c - left] ?? sheet.rows[r]?.[c] ?? ''));
  return { columns, rows };
}
