const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { detectPandoc } = require('./pandoc.cjs');

const run = promisify(execFile);
const IMPORT_READERS = { docx: 'docx', odt: 'odt', rtf: 'rtf', html: 'html', htm: 'html', epub: 'epub' };

function cleanImportedMarkdown(markdown) {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00ad\u200b-\u200d\ufeff]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '') + '\n';
}

async function importDocument(executable, file) {
  const extension = path.extname(file).slice(1).toLowerCase();
  const reader = IMPORT_READERS[extension];
  if (!reader) throw new Error('Unsupported import format.');
  const args = [
    `--from=${reader}`, '--to=markdown+mark+raw_html-bracketed_spans',
    `--lua-filter=${path.join(__dirname, 'highlightRoundTrip.lua')}`,
  ];
  if (extension === 'docx') args.push('--track-changes=accept');
  args.push('--wrap=none', '--sandbox', '--', file);
  const { stdout, stderr } = await run(executable, args,
    { windowsHide: true, timeout: 120000, maxBuffer: 20 * 1024 * 1024 });
  const warnings = [stderr.trim(), extension === 'docx'
    ? 'Tracked changes were imported in their accepted (final-document) state.' : ''].filter(Boolean).join('\n');
  return { markdown: cleanImportedMarkdown(stdout), warnings };
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
  ipcMain.handle('documents:readingSamples', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Import timed reading documents', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Documents', extensions: ['md', 'txt', ...Object.keys(IMPORT_READERS)] }],
    });
    if (result.canceled) return { canceled: true };
    if (result.filePaths.length > 100) throw new Error('Use at most 100 timed reading samples.');
    const documents = [];
    let total = 0;
    let pandoc;
    for (const file of result.filePaths) {
      const size = (await fs.stat(file)).size;
      total += size;
      if (size > 5 * 1024 * 1024 || total > 20 * 1024 * 1024) {
        throw new Error('Reading imports are limited to 5 MB per document and 20 MB per batch.');
      }
      const extension = path.extname(file).toLowerCase();
      let converted;
      if (['.md', '.txt'].includes(extension)) {
        converted = { markdown: await fs.readFile(file, 'utf8'), warnings: '' };
      } else {
        pandoc ||= await detectPandoc(readConfig().pandocPath || '');
        if (!pandoc.available) throw new Error(pandoc.message);
        converted = await importDocument(pandoc.executable, file);
      }
      documents.push({ name: path.basename(file), ...converted });
    }
    return { canceled: false, documents };
  });
}

module.exports = { IMPORT_READERS, cleanImportedMarkdown, importDocument, registerDocuments };
