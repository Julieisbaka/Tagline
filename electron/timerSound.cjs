const fs = require('node:fs/promises');
const path = require('node:path');

const formats = {
  '.flac': { mime: 'audio/flac', valid: (data) => data.subarray(0, 4).toString() === 'fLaC' },
  '.m4a': { mime: 'audio/mp4', valid: (data) => data.subarray(4, 8).toString() === 'ftyp' },
  '.mp3': {
    mime: 'audio/mpeg',
    valid: (data) => data.subarray(0, 3).toString() === 'ID3' ||
      (data[0] === 0xff && (data[1] & 0xe0) === 0xe0),
  },
  '.ogg': { mime: 'audio/ogg', valid: (data) => data.subarray(0, 4).toString() === 'OggS' },
  '.wav': {
    mime: 'audio/wav',
    valid: (data) => data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WAVE',
  },
};
const MAX_SOUND_BYTES = 10 * 1024 * 1024;

function registerTimerSound({ app, ipcMain, dialog, getWindow }) {
  const file = path.join(app.getPath('userData'), 'timer-sound.json');
  const read = async () => {
    try {
      const saved = JSON.parse(await fs.readFile(file, 'utf8'));
      const format = Object.values(formats).find((item) => item.mime === saved.mime);
      if (!format || typeof saved.name !== 'string' || typeof saved.data !== 'string') {
        throw new Error('Invalid saved timer sound.');
      }
      const data = Buffer.from(saved.data, 'base64');
      if (data.length > MAX_SOUND_BYTES || !format.valid(data)) throw new Error('Invalid saved timer sound.');
      return { name: saved.name, data: `data:${saved.mime};base64,${saved.data}` };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  };

  ipcMain.handle('timerSound:read', read);
  ipcMain.handle('timerSound:import', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Choose timer sound',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: Object.keys(formats).map((extension) => extension.slice(1)) }],
    });
    if (result.canceled) return null;
    const source = result.filePaths[0];
    const format = formats[path.extname(source).toLowerCase()];
    if (!format) throw new Error('Unsupported timer sound format.');
    const stat = await fs.stat(source);
    if (stat.size > MAX_SOUND_BYTES) throw new Error('Timer sound files must be 10 MB or smaller.');
    const data = await fs.readFile(source);
    if (!format.valid(data)) throw new Error('The selected file is not a valid audio file of that format.');
    const saved = { name: path.basename(source), mime: format.mime, data: data.toString('base64') };
    await fs.writeFile(file, JSON.stringify(saved));
    return { name: saved.name };
  });
  ipcMain.handle('timerSound:clear', async () => {
    try {
      await fs.unlink(file);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  });
}

module.exports = { registerTimerSound };
