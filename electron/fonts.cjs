const fs = require('node:fs/promises');
const path = require('node:path');

function registerFonts({ app, ipcMain, dialog, getWindow }) {
  const folder = path.join(app.getPath('userData'), 'fonts');
  const file = path.join(folder, 'custom-font.json');
  const types = { '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' };
  const read = async () => {
    try {
      const saved = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!Object.values(types).includes(saved.mime) || typeof saved.data !== 'string') throw new Error('Invalid saved font.');
      return `data:${saved.mime};base64,${saved.data}`;
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  };
  ipcMain.handle('fonts:read', read);
  ipcMain.handle('fonts:import', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Import font', properties: ['openFile'],
      filters: [{ name: 'Fonts', extensions: ['woff2', 'woff', 'ttf', 'otf'] }],
    });
    if (result.canceled) return null;
    const source = result.filePaths[0];
    if (!types[path.extname(source).toLowerCase()]) throw new Error('Unsupported font format.');
    const stat = await fs.stat(source);
    if (stat.size > 20 * 1024 * 1024) throw new Error('Font files must be smaller than 20 MB.');
    const data = await fs.readFile(source);
    const signature = data.subarray(0, 4).toString('hex');
    if (!['774f4632', '774f4646', '00010000', '4f54544f', '74727565'].includes(signature)) {
      throw new Error('Invalid font file.');
    }
    const mime = types[path.extname(source).toLowerCase()];
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(file, JSON.stringify({ mime, data: data.toString('base64') }));
    return { name: path.basename(source), data: `data:${mime};base64,${data.toString('base64')}` };
  });
}

module.exports = { registerFonts };
