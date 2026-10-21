const path = require('node:path');
const fs = require('node:fs/promises');

function flowArguments(argv) {
  return argv.filter((value) => path.isAbsolute(value) && path.extname(value).toLowerCase() === '.flow');
}

function registerFlowFiles({ app, ipcMain, getWindow, createWindow, getVaultRoot, openVault, argv = process.argv }) {
  if (!app.requestSingleInstanceLock()) { app.quit(); return false; }
  const pending = [];
  const offered = new Set();
  const enqueue = (files) => {
    for (const file of files) if (!pending.includes(file)) pending.push(file);
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send('flow:available');
    }
  };
  enqueue(flowArguments(argv));
  app.on('open-file', (event, file) => {
    event.preventDefault();
    enqueue(flowArguments([file]));
    if (app.isReady() && (!getWindow() || getWindow().isDestroyed())) createWindow();
  });
  app.on('second-instance', (_event, commandLine) => {
    enqueue(flowArguments(commandLine));
    if (!getWindow() || getWindow().isDestroyed()) createWindow();
  });
  ipcMain.handle('flow:pending', () => {
    const file = pending.shift();
    if (file) offered.add(file);
    return file || null;
  });
  ipcMain.handle('flow:open', async (_event, file) => {
    if (!offered.delete(file)) throw new Error('This flow file was not requested by the operating system.');
    const real = await fs.realpath(file);
    if (path.extname(real).toLowerCase() !== '.flow' || !(await fs.stat(real)).isFile()) {
      throw new Error('Select a .flow file.');
    }
    if (path.basename(real).startsWith('.')) throw new Error('Hidden flow files cannot be opened in the vault explorer.');
    const current = getVaultRoot();
    const relative = current && path.relative(current, real);
    const inside = current && !relative.startsWith('..') && !path.isAbsolute(relative) &&
      !relative.split(path.sep).some((part) => part.startsWith('.'));
    const vault = await openVault(inside ? current : path.dirname(real));
    return { vault, path: path.relative(vault.root, real).split(path.sep).join('/') };
  });
  return true;
}

module.exports = { registerFlowFiles, flowArguments };
