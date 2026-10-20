// Renders build/icon.svg to PNG and a multi-resolution Windows ICO using Electron's Chromium.
// Run with: npm run icons
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const BUILD = path.join(__dirname, '..', 'build');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

// Classic 32-bit DIB entry (BGRA, bottom-up, plus an all-zero AND mask) for maximum Windows compatibility.
function dib(size, rgba) {
  const info = Buffer.alloc(40);
  info.writeUInt32LE(40, 0);
  info.writeInt32LE(size, 4);
  info.writeInt32LE(size * 2, 8);
  info.writeUInt16LE(1, 12);
  info.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = ((size - 1 - y) * size + x) * 4;
      const dst = (y * size + x) * 4;
      pixels[dst] = rgba[src + 2];
      pixels[dst + 1] = rgba[src + 1];
      pixels[dst + 2] = rgba[src];
      pixels[dst + 3] = rgba[src + 3];
    }
  }
  const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size);
  return Buffer.concat([info, pixels, mask]);
}

function ico(images) {
  const entries = images.map(({ size, png, rgba }) => ({ size, data: size >= 256 ? png : dib(size, rgba) }));
  const header = Buffer.alloc(6 + 16 * entries.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach(({ size, data }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...entries.map((e) => e.data)]);
}

app.whenReady().then(async () => {
  try {
    const svg = await fs.readFile(path.join(BUILD, 'icon.svg'), 'utf8');
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await win.loadURL('data:text/html,<!doctype html><title>icons</title>');
    const render = (size) => win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = ${size};
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, ${size}, ${size});
        const rgba = Array.from(ctx.getImageData(0, 0, ${size}, ${size}).data);
        resolve({ png: canvas.toDataURL('image/png').split(',')[1], rgba });
      };
      img.onerror = () => reject(new Error('Could not decode icon.svg'));
      img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
    })`).then(({ png, rgba }) => ({ size, png: Buffer.from(png, 'base64'), rgba }));

    const icons = [];
    for (const size of ICO_SIZES) icons.push(await render(size));
    await fs.writeFile(path.join(BUILD, 'icon.ico'), ico(icons));
    await fs.writeFile(path.join(BUILD, 'icon.png'), (await render(512)).png);
    const chunks = [];
    for (const [type, size] of [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128],
      ['ic08', 256], ['ic09', 512], ['ic10', 1024]]) {
      const png = (await render(size)).png;
      const chunk = Buffer.alloc(8);
      chunk.write(type, 0, 'ascii');
      chunk.writeUInt32BE(png.length + 8, 4);
      chunks.push(chunk, png);
    }
    const header = Buffer.alloc(8);
    header.write('icns', 0, 'ascii');
    header.writeUInt32BE(8 + chunks.reduce((sum, b) => sum + b.length, 0), 4);
    await fs.writeFile(path.join(BUILD, 'icon.icns'), Buffer.concat([header, ...chunks]));
    console.log(`Wrote build/icon.png (512px) and build/icon.ico (${ICO_SIZES.join(', ')}px).`);
    app.exit(0);
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
