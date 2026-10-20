const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');

const run = promisify(execFile);
const FORMATS = {
  docx: { label: 'Word document', ext: 'docx', writer: 'docx' },
  odt: { label: 'OpenDocument text', ext: 'odt', writer: 'odt' },
  rtf: { label: 'Rich text', ext: 'rtf', writer: 'rtf' },
  html: { label: 'HTML document', ext: 'html', writer: 'html5' },
  epub: { label: 'EPUB ebook', ext: 'epub', writer: 'epub3' },
  pdf: { label: 'PDF (requires a PDF engine)', ext: 'pdf', writer: 'latex' },
};

async function detectPandoc(customPath = '') {
  const candidates = customPath ? [customPath] : [
    'pandoc',
    ...(process.platform === 'win32' ? [
      path.join(process.env.LOCALAPPDATA || os.homedir(), 'Pandoc', 'pandoc.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Pandoc', 'pandoc.exe'),
    ] : []),
    ...(process.platform === 'darwin' ? ['/opt/homebrew/bin/pandoc', '/usr/local/bin/pandoc'] : []),
  ];
  for (const executable of candidates) {
    try {
      const { stdout } = await run(executable, ['--version'], { windowsHide: true, timeout: 10000 });
      if (!/^pandoc\s+\d/i.test(stdout)) throw new Error('The selected executable is not Pandoc.');
      return { available: true, executable, version: stdout.split(/\r?\n/)[0] };
    } catch (e) {
      if (e.code !== 'ENOENT' || customPath) throw new Error(`Cannot run Pandoc: ${e.message}`);
    }
  }
  return { available: false, message: 'Pandoc was not found. Install it or choose its executable in Settings.' };
}

function convert({ executable, html, format, outputPath, title }) {
  if (!FORMATS[format]) return Promise.reject(new Error('Unsupported export format.'));
  return new Promise((resolve, reject) => {
    const args = ['--from=html', `--to=${FORMATS[format].writer}`, '--standalone',
      '--sandbox', '--wrap=none', '--metadata', `title=${title}`, '--output', outputPath];
    const child = spawn(executable, args, { windowsHide: true, shell: false });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('Pandoc timed out after 120 seconds.'));
    }, 120000);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ warnings: stderr.trim() });
    };
    child.stderr.on('data', (data) => { if (stderr.length < 64000) stderr += data; });
    child.on('error', finish);
    child.stdin.on('error', (e) => { if (e.code !== 'EPIPE') finish(e); });
    child.on('close', (code) => finish(code === 0 ? null
      : new Error(`Pandoc export failed (${code}). ${stderr.trim() || 'No diagnostic output.'}`)));
    child.stdin.end(html);
  });
}

function registerPandoc({ ipcMain, dialog, getWindow, readConfig, writeConfig }) {
  const status = () => detectPandoc(readConfig().pandocPath || '');
  ipcMain.handle('pandoc:status', status);
  ipcMain.handle('pandoc:choose', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Select Pandoc executable', properties: ['openFile'],
      ...(process.platform === 'win32' ? { filters: [{ name: 'Executable', extensions: ['exe'] }] } : {}),
    });
    if (result.canceled) return null;
    const info = await detectPandoc(result.filePaths[0]);
    writeConfig({ pandocPath: result.filePaths[0] });
    return info;
  });
  ipcMain.handle('pandoc:export', async (_event, { title, html, format }) => {
    if (typeof title !== 'string' || typeof html !== 'string' || !FORMATS[format]) {
      throw new Error('Invalid export request.');
    }
    const info = await status();
    if (!info.available) throw new Error(info.message);
    const f = FORMATS[format];
    const result = await dialog.showSaveDialog(getWindow(), {
      title: `Export ${f.label}`, defaultPath: title.replace(/[\\/:*?"<>|]/g, '-') + '.' + f.ext,
      filters: [{ name: f.label, extensions: [f.ext] }],
    });
    if (result.canceled) return { canceled: true };
    // Only replace the chosen destination after conversion succeeds.
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'debate-export-'));
    const tempOutput = path.join(tempDir, `document.${f.ext}`);
    try {
      const converted = await convert({ executable: info.executable, html, format, outputPath: tempOutput, title });
      await fs.copyFile(tempOutput, result.filePath);
      return { canceled: false, path: result.filePath, warnings: converted.warnings };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
}

module.exports = { FORMATS, detectPandoc, convert, registerPandoc };
