const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  installPandoc: () => ipcRenderer.invoke('pandoc:install'),
  openWebsite: (url, bounds) => ipcRenderer.invoke('browser:open', url, bounds),
  resizeWebsite: (bounds) => ipcRenderer.invoke('browser:bounds', bounds),
  closeWebsite: () => ipcRenderer.invoke('browser:close'),
  websiteAction: (action, url) => ipcRenderer.invoke('browser:action', action, url),
  onWebsiteLink: (callback) => {
    const listener = (_event, url) => callback(url);
    ipcRenderer.on('browser:link', listener);
    return () => ipcRenderer.removeListener('browser:link', listener);
  },
  onWebsiteState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('browser:state', listener);
    return () => ipcRenderer.removeListener('browser:state', listener);
  },
  extractCitation: (url) => ipcRenderer.invoke('citation:extract', url),
  setKeybindings: (overrides) => ipcRenderer.invoke('keybindings:set', overrides),
  nextFlowFile: () => ipcRenderer.invoke('flow:pending'),
  openFlowFile: (file) => ipcRenderer.invoke('flow:open', file),
  onFlowAvailable: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('flow:available', listener);
    return () => ipcRenderer.removeListener('flow:available', listener);
  },
  onMenuCommand: (callback) => {
    const listener = (_e, command) => callback(command);
    ipcRenderer.on('menu:command', listener);
    return () => ipcRenderer.removeListener('menu:command', listener);
  },
  listExtensions: () => ipcRenderer.invoke('extensions:list'),
  loadExtension: (id) => ipcRenderer.invoke('extensions:load', id),
  setExtensionEnabled: (id, enabled, reviewToken) => ipcRenderer.invoke('extensions:setEnabled', id, enabled, reviewToken),
  openExtensionsFolder: () => ipcRenderer.invoke('extensions:openFolder'),
  getCustomizationLimits: () => ipcRenderer.invoke('customization:get'),
  exportExtensionSettings: (id, values) => ipcRenderer.invoke('extensions:exportSettings', id, values),
  setCustomizationLimits: (limits) => ipcRenderer.invoke('customization:set', limits),
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
  write: (p, c, retention) => ipcRenderer.invoke('fs:write', p, c, retention),
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
  listHistory: (p) => ipcRenderer.invoke('history:list', p),
  readHistory: (p, id) => ipcRenderer.invoke('history:read', p, id),
  importReadingSamples: () => ipcRenderer.invoke('documents:readingSamples'),
  saveTheme: (theme) => ipcRenderer.invoke('themes:save', theme),
  embeddingStatus: () => ipcRenderer.invoke('embeddings:status'),
  saveHfToken: (token) => ipcRenderer.invoke('embeddings:token', token),
  downloadEmbeddingModel: () => ipcRenderer.invoke('embeddings:download'),
  semanticSearch: (request) => ipcRenderer.invoke('embeddings:search', request),
  nliStatus: () => ipcRenderer.invoke('nli:status'),
  setNliRepo: (repo) => ipcRenderer.invoke('nli:setRepo', repo),
  chooseNliFolder: () => ipcRenderer.invoke('nli:chooseFolder'),
  loadNliModel: () => ipcRenderer.invoke('nli:load'),
  unloadNliModel: () => ipcRenderer.invoke('nli:unload'),
  analyzeHypotheses: (request) => ipcRenderer.invoke('nli:analyze', request),
  summaryStatus: () => ipcRenderer.invoke('summary:status'),
  loadSummaryModel: () => ipcRenderer.invoke('summary:load'),
  summarizeDocument: (content) => ipcRenderer.invoke('summary:run', content),
});
