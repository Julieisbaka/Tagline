const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  setNativeUi: (options) => ipcRenderer.invoke('app:setNativeUi', options),
  nativeContextMenu: (items) => ipcRenderer.invoke('app:nativeContextMenu', items),
  nativeConfirm: (options) => ipcRenderer.invoke('app:nativeConfirm', options),
  editText: (action) => ipcRenderer.invoke('app:editText', action),
  systemLanguages: JSON.parse(decodeURIComponent(process.argv.find((arg) => arg.startsWith('--tagline-languages=')).split('=')[1])),
  getInstallationInfo: () => ipcRenderer.invoke('app:installation'),
  checkForUpdates: () => ipcRenderer.invoke('app:checkUpdates'),
  getUpdateState: () => ipcRenderer.invoke('app:getUpdateState'),
  downloadUpdate: () => ipcRenderer.invoke('app:downloadUpdate'),
  installUpdate: () => ipcRenderer.invoke('app:installUpdate'),
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('app:updateState', listener);
    return () => ipcRenderer.removeListener('app:updateState', listener);
  },
  openProjectPage: (page) => ipcRenderer.invoke('app:openProjectPage', page),
  uninstallApp: (removeProfile) => ipcRenderer.invoke('app:uninstall', removeProfile),
  googleDocs: {
    status: () => ipcRenderer.invoke('googleDocs:status'),
    connect: () => ipcRenderer.invoke('googleDocs:connect'),
    cancelConnect: () => ipcRenderer.invoke('googleDocs:cancelConnect'),
    save: (endpoint, secret, connectionId) => ipcRenderer.invoke('googleDocs:save', endpoint, secret, connectionId),
    disconnect: (connectionId) => ipcRenderer.invoke('googleDocs:disconnect', connectionId),
    sendNote: (document) => ipcRenderer.invoke('googleDocs:sendNote', document),
    uploadFile: (connectionId) => ipcRenderer.invoke('googleDocs:uploadFile', connectionId),
    saveScript: () => ipcRenderer.invoke('googleDocs:saveScript'),
    openSetup: () => ipcRenderer.invoke('googleDocs:openSetup'),
    openDocument: (url, accountEmail) => ipcRenderer.invoke('googleDocs:openDocument', url, accountEmail),
  },
  tabroom: {
    status: () => ipcRenderer.invoke('tabroom:status'),
    login: () => ipcRenderer.invoke('tabroom:login'),
    logout: () => ipcRenderer.invoke('tabroom:logout'),
    load: (tournament) => ipcRenderer.invoke('tabroom:load', tournament),
    page: (id, index) => ipcRenderer.invoke('tabroom:page', id, index),
    records: (id, kind, index, query) => ipcRenderer.invoke('tabroom:records', id, kind, index, query),
    openJson: (source) => ipcRenderer.invoke('tabroom:openJson', source),
    snapshotRecordsForJson: (token, kind, index, query) =>
      ipcRenderer.invoke('tabroom:snapshotRecordsForJson', token, kind, index, query),
    download: (id) => ipcRenderer.invoke('tabroom:download', id),
  },
  openCaselist: {
    writePasswordStatus: () => ipcRenderer.invoke('opencaselist:writePasswordStatus'),
    verifyWritePassword: (password) => ipcRenderer.invoke('opencaselist:verifyWritePassword', password),
    configureWritePassword: (enabled, password, currentPassword) =>
      ipcRenderer.invoke('opencaselist:configureWritePassword', enabled, password, currentPassword),
    status: () => ipcRenderer.invoke('opencaselist:status'),
    login: () => ipcRenderer.invoke('opencaselist:login'),
    logout: () => ipcRenderer.invoke('opencaselist:logout'),
    list: (kind, selection) => ipcRenderer.invoke('opencaselist:list', kind, selection),
    search: (caselist, query) => ipcRenderer.invoke('opencaselist:search', caselist, query),
    resolveTabroomTeam: (caselist, team) => ipcRenderer.invoke('opencaselist:resolveTabroomTeam', caselist, team),
    write: (action, selection, value) => ipcRenderer.invoke('opencaselist:write', action, selection, value),
    upload: (selection, value) => ipcRenderer.invoke('opencaselist:upload', selection, value),
    download: (remotePath) => ipcRenderer.invoke('opencaselist:download', remotePath),
  },
  onPrepareClose: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('app:prepareClose', listener);
    ipcRenderer.send('app:saveHandlerReady', true);
    return () => {
      ipcRenderer.removeListener('app:prepareClose', listener);
      ipcRenderer.send('app:saveHandlerReady', false);
    };
  },
  closeReady: (success) => ipcRenderer.send('app:closeReady', success),
  installPandoc: () => ipcRenderer.invoke('pandoc:install'),
  openWebsite: (url, bounds) => ipcRenderer.invoke('browser:open', url, bounds),
  resizeWebsite: (bounds) => ipcRenderer.invoke('browser:bounds', bounds),
  onWebsiteResize: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('browser:resize', listener);
    return () => ipcRenderer.removeListener('browser:resize', listener);
  },
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
  checkEvidenceLinks: (urls, options) => ipcRenderer.invoke('evidence:checkLinks', urls, options),
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
  completeExtensionInstall: (id, token) => ipcRenderer.invoke('extensions:completeInstall', id, token),
  setExtensionEnabled: (id, enabled, reviewToken) => ipcRenderer.invoke('extensions:setEnabled', id, enabled, reviewToken),
  openExtensionsFolder: () => ipcRenderer.invoke('extensions:openFolder'),
  getCustomizationLimits: () => ipcRenderer.invoke('customization:get'),
  exportExtensionSettings: (id, values) => ipcRenderer.invoke('extensions:exportSettings', id, values),
  setCustomizationLimits: (limits) => ipcRenderer.invoke('customization:set', limits),
  readFont: () => ipcRenderer.invoke('fonts:read'),
  importFont: () => ipcRenderer.invoke('fonts:import'),
  activateFont: () => ipcRenderer.invoke('fonts:activate'),
  readTimerSound: () => ipcRenderer.invoke('timerSound:read'),
  importTimerSound: () => ipcRenderer.invoke('timerSound:import'),
  clearTimerSound: () => ipcRenderer.invoke('timerSound:clear'),
  setModelAutoload: (enabled) => ipcRenderer.invoke('embeddings:autoload', enabled),
  getLastVault: () => ipcRenderer.invoke('vault:getLast'),
  chooseVault: () => ipcRenderer.invoke('vault:choose'),
  listRecentVaults: () => ipcRenderer.invoke('vault:listRecent'),
  openRecentVault: (root) => ipcRenderer.invoke('vault:openRecent', root),
  forgetRecentVault: (root) => ipcRenderer.invoke('vault:forgetRecent', root),
  revealRecentVault: (root) => ipcRenderer.invoke('vault:revealRecent', root),
  createSampleVault: () => ipcRenderer.invoke('vault:createSample'),
  list: () => ipcRenderer.invoke('fs:list'),
  readSnapshot: () => ipcRenderer.invoke('fs:snapshot'),
  readAll: () => ipcRenderer.invoke('fs:readAll'),
  read: (p) => ipcRenderer.invoke('fs:read', p),
  write: (p, c, retention, canvasMode, experimentalHistoryDeltas) =>
    ipcRenderer.invoke('fs:write', p, c, retention, canvasMode, experimentalHistoryDeltas),
  create: (p, c) => ipcRenderer.invoke('fs:create', p, c),
  mkdir: (p, underscoreFolders) => ipcRenderer.invoke('fs:mkdir', p, underscoreFolders),
  rename: (a, b) => ipcRenderer.invoke('fs:rename', a, b),
  remove: (p) => ipcRenderer.invoke('fs:delete', p),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  pandocStatus: () => ipcRenderer.invoke('pandoc:status'),
  choosePandoc: () => ipcRenderer.invoke('pandoc:choose'),
  exportDocument: (document) => ipcRenderer.invoke('pandoc:export', document),
  exportHtml: (document) => ipcRenderer.invoke('documents:html', document),
  importDocument: (options) => ipcRenderer.invoke('documents:import', options),
  listHistory: (p) => ipcRenderer.invoke('history:list', p),
  readHistory: (p, id) => ipcRenderer.invoke('history:read', p, id),
  latestWorkingHistory: (p) => ipcRenderer.invoke('history:latest-working', p),
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
