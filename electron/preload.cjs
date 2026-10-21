const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  extractCitation: (url) => ipcRenderer.invoke('citation:extract', url),
  onMenuCommand: (callback) => {
    const listener = (_e, command) => callback(command);
    ipcRenderer.on('menu:command', listener);
    return () => ipcRenderer.removeListener('menu:command', listener);
  },
  readFont: () => ipcRenderer.invoke('fonts:read'),
  importFont: () => ipcRenderer.invoke('fonts:import'),
  activateFont: () => ipcRenderer.invoke('fonts:activate'),
  setModelAutoload: (enabled) => ipcRenderer.invoke('embeddings:autoload', enabled),
  getLastVault: () => ipcRenderer.invoke('vault:getLast'),
  chooseVault: () => ipcRenderer.invoke('vault:choose'),
  createSampleVault: () => ipcRenderer.invoke('vault:createSample'),
  list: () => ipcRenderer.invoke('fs:list'),
  readAll: () => ipcRenderer.invoke('fs:readAll'),
  read: (p) => ipcRenderer.invoke('fs:read', p),
  write: (p, c) => ipcRenderer.invoke('fs:write', p, c),
  create: (p, c) => ipcRenderer.invoke('fs:create', p, c),
  mkdir: (p, underscoreFolders) => ipcRenderer.invoke('fs:mkdir', p, underscoreFolders),
  rename: (a, b) => ipcRenderer.invoke('fs:rename', a, b),
  remove: (p) => ipcRenderer.invoke('fs:delete', p),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  pandocStatus: () => ipcRenderer.invoke('pandoc:status'),
  choosePandoc: () => ipcRenderer.invoke('pandoc:choose'),
  exportDocument: (document) => ipcRenderer.invoke('pandoc:export', document),
  exportHtml: (document) => ipcRenderer.invoke('documents:html', document),
  importDocument: () => ipcRenderer.invoke('documents:import'),
  saveTheme: (theme) => ipcRenderer.invoke('themes:save', theme),
  embeddingStatus: () => ipcRenderer.invoke('embeddings:status'),
  saveHfToken: (token) => ipcRenderer.invoke('embeddings:token', token),
  downloadEmbeddingModel: () => ipcRenderer.invoke('embeddings:download'),
  semanticSearch: (request) => ipcRenderer.invoke('embeddings:search', request),
});
