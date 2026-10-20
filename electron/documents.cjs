const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { detectPandoc } = require('./pandoc.cjs');

const run = promisify(execFile);
const IMPORT_READERS = { docx: 'docx', odt: 'odt', rtf: 'rtf', html: 'html', htm: 'html', epub: 'epub' };

async function importDocument(executable, file) {
  const reader = IMPORT_READERS[path.extname(file).slice(1).toLowerCase()];
  if (!reader) throw new Error('Unsupported import format.');
  const { stdout, stderr } = await run(executable, [
    `--from=${reader}`, '--to=markdown+raw_html-bracketed_spans', '--wrap=none', '--sandbox', '--', file,
  ], { windowsHide: true, timeout: 120000, maxBuffer: 20 * 1024 * 1024 });
  return { markdown: stdout, warnings: stderr.trim() };
}

function registerDocuments({ ipcMain, dialog, getWindow, readConfig }) {
  ipcMain.handle('documents:html', async (_e, { title, html }) => {
    if (typeof title !== 'string' || typeof html !== 'string') throw new Error('Invalid HTML export.');
    const result = await dialog.showSaveDialog(getWindow(), {
      title: 'Export HTML', defaultPath: title.replace(/[\\/:*?"<>|]/g, '-') + '.html',
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (result.canceled) return { canceled: true };
    await fs.writeFile(result.filePath, html, 'utf8');
    return { canceled: false, path: result.filePath };
  });
  ipcMain.handle('themes:save', async (_e, theme) => {
    if (!theme || theme.version !== 1 || typeof theme.name !== 'string' || !theme.colors) {
      throw new Error('Invalid theme.');
    }
    const result = await dialog.showSaveDialog(getWindow(), {
      title: 'Export theme', defaultPath: 'tagline-theme.json', filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled) return { canceled: true };
    await fs.writeFile(result.filePath, JSON.stringify(theme, null, 2) + '\n', 'utf8');
    return { canceled: false, path: result.filePath };
  });
  ipcMain.handle('documents:import', async () => {
    const info = await detectPandoc(readConfig().pandocPath || '');
    if (!info.available) throw new Error(info.message);
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Import document', properties: ['openFile'],
      filters: [{ name: 'Documents', extensions: Object.keys(IMPORT_READERS) }],
    });
    if (result.canceled) return { canceled: true };
    const source = result.filePaths[0];
    const converted = await importDocument(info.executable, source);
    return { canceled: false, name: path.basename(source, path.extname(source)), ...converted };
  });
}

module.exports = { IMPORT_READERS, importDocument, registerDocuments };
