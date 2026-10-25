export const FLOW_PRESETS = {
  'On-case (Aff)': ['1AC', '1NC', '2AC', 'Block', '1AR', '2NR', '2AR'],
  'Off-case (Neg)': ['1NC', '2AC', 'Block', '1AR', '2NR', '2AR'],
  'CX notes': ['1AC CX', '1NC CX', '2AC CX', '2NC CX'],
};

export function flowColumns(preset, separateNegativeBlock = false) {
  if (!Object.hasOwn(FLOW_PRESETS, preset) || typeof separateNegativeBlock !== 'boolean') throw new Error('Invalid flow creation options.');
  return FLOW_PRESETS[preset].flatMap((column) => column === 'Block' && separateNegativeBlock ? ['2NC', '1NR'] : [column]);
}

export function createFlow(separateNegativeBlock = false) {
  const columns = flowColumns('On-case (Aff)', separateNegativeBlock);
  return JSON.stringify({
    version: 1, sheets: [{ name: 'Case', columns, rows: [Array(columns.length).fill('')] }],
  }, null, 2);
}

export const EMPTY_FLOW = createFlow();

export function parseFlow(content) {
  if (typeof content !== 'string') throw new Error('Flow content must be JSON text.');
  const data = JSON.parse(content);
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
    !Array.isArray(data.sheets) || !data.sheets.length || data.sheets.some((sheet) =>
      !sheet || typeof sheet.name !== 'string' || !Array.isArray(sheet.columns) || !sheet.columns.length ||
      sheet.columns.some((column) => typeof column !== 'string') || !Array.isArray(sheet.rows) ||
      sheet.rows.some((row) => !Array.isArray(row) || row.length !== sheet.columns.length ||
        row.some((cell) => typeof cell !== 'string')))) throw new Error('Invalid flow structure.');
  if (data.version !== 1) throw new Error('Unsupported flow version.');
  return data;
}

export function serializeFlow(flow) {
  return JSON.stringify(parseFlow(JSON.stringify(flow)), null, 2);
}

export function setFlowCell(flow, sheetIndex, rowIndex, columnIndex, text) {
  const data = parseFlow(JSON.stringify(flow));
  const sheet = data.sheets[sheetIndex];
  if (![sheetIndex, rowIndex, columnIndex].every((value) => Number.isInteger(value) && value >= 0) ||
    !sheet || !sheet.rows[rowIndex] || columnIndex >= sheet.columns.length || typeof text !== 'string') {
    throw new Error('Cell requires valid sheet, row and column indexes and text.');
  }
  sheet.rows[rowIndex][columnIndex] = text;
  return data;
}
