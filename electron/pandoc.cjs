const { execFile, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
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
// Pandoc only accepts a reference document for its word-processor writers.
const REFERENCE_FORMATS = new Set(['docx', 'odt']);

function addRtfHighlightColor(rtf) {
  if (!rtf.includes('\\highlight99')) {
    return rtf;
  }
  let colorIndex = null;
  const withColor = rtf.replace(/\{\\colortbl;[^}]*\}/, (table) => {
    colorIndex = (table.match(/;/g) || []).length;
    return `${table.slice(0, -1)}\\red255\\green255\\blue0;}`;
  });
  if (colorIndex === null) {
    throw new Error('Pandoc RTF output did not contain a color table.');
  }
  return withColor.replaceAll('\\highlight99', `\\highlight${colorIndex}`);
}

async function preserveRtfHighlights(outputPath) {
  const output = await fs.readFile(outputPath, 'utf8');
  const updated = addRtfHighlightColor(output);
  if (updated !== output) {
    await fs.writeFile(outputPath, updated, 'utf8');
  }
}

async function detectPandoc(customPath = '') {
  const candidates = customPath
    ? [customPath]
    : [
        'pandoc',
        ...(process.platform === 'win32'
          ? [
              path.join(process.env.LOCALAPPDATA || os.homedir(), 'Pandoc', 'pandoc.exe'),
              path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Pandoc', 'pandoc.exe'),
            ]
          : []),
        ...(process.platform === 'darwin'
          ? ['/opt/homebrew/bin/pandoc', '/usr/local/bin/pandoc']
          : []),
      ];
  for (const executable of candidates) {
    try {
      const { stdout } = await run(executable, ['--version'], {
        windowsHide: true,
        timeout: 10000,
      });
      if (!/^pandoc\s+\d/i.test(stdout)) {
        throw new Error('The selected executable is not Pandoc.');
      }
      return { available: true, executable, version: stdout.split(/\r?\n/)[0] };
    } catch (e) {
      if (e.code !== 'ENOENT' || customPath) {
        throw new Error(`Cannot run Pandoc: ${e.message}`);
      }
    }
  }
  return {
    available: false,
    message: 'Pandoc was not found. Install it or choose its executable in Settings.',
  };
}

function highlightFilterPath(moduleDirectory) {
  const appDirectory = path.dirname(moduleDirectory);
  const filterDirectory =
    path.basename(appDirectory) === 'app.asar'
      ? path.join(path.dirname(appDirectory), 'app.asar.unpacked', path.basename(moduleDirectory))
      : moduleDirectory;
  return path.join(filterDirectory, 'highlightRoundTrip.lua');
}

// Replace an export atomically so a failed conversion or copy never truncates
// an existing file at the destination.
async function replaceFile(source, destination) {
  try {
    await fs.rename(source, destination);
    return;
  } catch (error) {
    if (error.code !== 'EXDEV') {
      throw error;
    }
  }
  // The destination can live on another device. Stage the copy beside it so
  // the final rename still swaps it in atomically, then delete the source.
  const staged = `${destination}.${randomUUID()}.tmp`;
  try {
    await fs.copyFile(source, staged);
    await fs.rename(staged, destination);
  } catch (error) {
    await fs.rm(staged, { force: true }).catch(() => {});
    throw error;
  }
  await fs.rm(source, { force: true });
}

function convert({ executable, html, format, outputPath, title, author, date, toc, referenceDoc }) {
  if (!FORMATS[format]) {
    return Promise.reject(new Error('Unsupported export format.'));
  }
  return new Promise((resolve, reject) => {
    const args = [
      '--from=html',
      `--to=${FORMATS[format].writer}`,
      `--lua-filter=${highlightFilterPath(__dirname)}`,
      '--standalone',
      '--sandbox',
      '--wrap=none',
      '--metadata',
      `title=${title}`,
    ];
    if (author) {
      args.push('--metadata', `author=${author}`);
    }
    if (date) {
      args.push('--metadata', `date=${date}`);
    }
    if (toc) {
      args.push('--toc');
    }
    if (referenceDoc && REFERENCE_FORMATS.has(format)) {
      args.push(`--reference-doc=${referenceDoc}`);
    }
    args.push('--output', outputPath);
    const child = spawn(executable, args, { windowsHide: true, shell: false });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('Pandoc timed out after 120 seconds.'));
    }, 120000);
    const finish = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
      } else {
        resolve({ warnings: stderr.trim() });
      }
    };
    child.stderr.on('data', (data) => {
      if (stderr.length < 64000) {
        stderr += data;
      }
    });
    child.on('error', finish);
    child.stdin.on('error', (e) => {
      if (e.code !== 'EPIPE') {
        finish(e);
      }
    });
    child.on('close', (code) => {
      if (code !== 0) {
        return finish(
          new Error(`Pandoc export failed (${code}). ${stderr.trim() || 'No diagnostic output.'}`)
        );
      }
      if (format === 'rtf') {
        preserveRtfHighlights(outputPath).then(() => finish(), finish);
      } else {
        finish();
      }
    });
    child.stdin.end(html);
  });
}

function registerPandoc({ ipcMain, dialog, getWindow, readConfig, writeConfig }) {
  const status = () => detectPandoc(readConfig().pandocPath || '');
  ipcMain.handle('pandoc:status', status);
  ipcMain.handle('pandoc:choose', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Select Pandoc executable',
      properties: ['openFile'],
      ...(process.platform === 'win32'
        ? { filters: [{ name: 'Executable', extensions: ['exe'] }] }
        : {}),
    });
    if (result.canceled) {
      return null;
    }
    const info = await detectPandoc(result.filePaths[0]);
    writeConfig({ pandocPath: result.filePaths[0] });
    return info;
  });
  ipcMain.handle('pandoc:chooseReference', async (_event, format) => {
    if (!REFERENCE_FORMATS.has(format)) {
      throw new Error('Reference documents are only supported for Word and OpenDocument exports.');
    }
    const f = FORMATS[format];
    const result = await dialog.showOpenDialog(getWindow(), {
      title: `Select ${f.label} reference document`,
      properties: ['openFile'],
      filters: [{ name: f.label, extensions: [f.ext] }],
    });
    return result.canceled ? { canceled: true } : { canceled: false, path: result.filePaths[0] };
  });
  ipcMain.handle(
    'pandoc:export',
    async (_event, { title, html, format, author, date, toc, referenceDoc }) => {
      if (
        typeof title !== 'string' ||
        typeof html !== 'string' ||
        !FORMATS[format] ||
        (author !== undefined && typeof author !== 'string') ||
        (date !== undefined && typeof date !== 'string') ||
        (toc !== undefined && typeof toc !== 'boolean') ||
        (referenceDoc !== undefined && typeof referenceDoc !== 'string')
      ) {
        throw new Error('Invalid export request.');
      }
      const info = await status();
      if (!info.available) {
        throw new Error(info.message);
      }
      const f = FORMATS[format];
      const result = await dialog.showSaveDialog(getWindow(), {
        title: `Export ${f.label}`,
        defaultPath: title.replace(/[\\/:*?"<>|]/g, '-') + '.' + f.ext,
        filters: [{ name: f.label, extensions: [f.ext] }],
      });
      if (result.canceled) {
        return { canceled: true };
      }
      // Only replace the chosen destination after conversion succeeds.
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'debate-export-'));
      const tempOutput = path.join(tempDir, `document.${f.ext}`);
      try {
        const converted = await convert({
          executable: info.executable,
          html,
          format,
          outputPath: tempOutput,
          title,
          author,
          date,
          toc,
          referenceDoc,
        });
        await replaceFile(tempOutput, result.filePath);
        return { canceled: false, path: result.filePath, warnings: converted.warnings };
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    }
  );
}

module.exports = {
  FORMATS,
  addRtfHighlightColor,
  detectPandoc,
  highlightFilterPath,
  convert,
  replaceFile,
  registerPandoc,
};
