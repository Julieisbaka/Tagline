const fs = require('node:fs/promises');
const { constants: fsConstants } = require('node:fs');
const path = require('node:path');
const { validateSettingValue } = require('./extensionSettings.mjs');
const { createHash, randomUUID } = require('node:crypto');
const { validateLimits } = require('./customization.mjs');
const { requestExtensionNetwork, downloadExtensionNetwork } = require('./extensionNetwork.cjs');
const { beginExtensionAuthorization, MAX_TIMEOUT_MS } = require('./extensions/oauth.cjs');
const {
  validateManifest,
  reviewSignature,
  needsReview,
  PERMISSIONS,
  ID,
  REVIEW_PERMISSIONS,
} = require('./extensions/manifest.cjs');
const { containedFile, containedFileAny } = require('./extensions/files.cjs');
const { registerStorageHandlers } = require('./extensions/storage.cjs');
const { registerInstallHandlers } = require('./extensions/install.cjs');

const MAX_TRANSLATION_BYTES = 262144;
const MAX_TEMPLATE_BYTES = 1048576;
const MAX_TEMPLATE_TOTAL_BYTES = 4194304;
const MAX_FONT_BYTES = 10485760;
const MAX_FONT_TOTAL_BYTES = 20971520;
const FONT_MIME_TYPES = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

async function readExtensionFile(file, maxBytes, message) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new Error('Not a file.');
    }
    if (stat.size > maxBytes) {
      throw new Error(message);
    }
    const data = await handle.readFile();
    if (data.length > maxBytes) {
      throw new Error(message);
    }
    return data;
  } finally {
    await handle.close();
  }
}

function parseTranslationCatalog(text, locale) {
  let catalog;
  try {
    catalog = JSON.parse(text);
  } catch {
    throw new Error(`Invalid ${locale} translation catalog JSON.`);
  }
  const entries = Object.entries(catalog || {});
  if (
    !catalog ||
    typeof catalog !== 'object' ||
    Array.isArray(catalog) ||
    entries.length > 2000 ||
    entries.some(
      ([key, value]) =>
        !key ||
        key.length > 128 ||
        key === '__proto__' ||
        typeof value !== 'string' ||
        value.length > 10000
    )
  ) {
    throw new Error(`Invalid ${locale} translation catalog.`);
  }
  return Object.fromEntries(entries);
}

function registerExtensions({
  app,
  ipcMain,
  shell,
  readConfig,
  writeConfig,
  dialog,
  getWindow,
  safeStorage,
  getVaultRoot,
  assertMainFrameSender,
}) {
  if (typeof assertMainFrameSender !== 'function') {
    throw new TypeError('Extension IPC requires a main-frame sender guard.');
  }
  const handleExtension = (channel, handler) => {
    ipcMain.handle(channel, async (event, ...args) => {
      assertMainFrameSender(event, 'Extension IPC');
      return handler(...args);
    });
  };
  const installTokens = new Map();
  const networkRequestTimes = new Map();
  const pendingAuthorizations = new Map();
  const manifestCache = new Map();
  const cancelAuthorization = (id) => pendingAuthorizations.get(id)?.cancel();
  const invalidateManifest = (root) => manifestCache.delete(path.resolve(root, 'manifest.json'));
  const limits = () => validateLimits(readConfig().customizationLimits);
  handleExtension('customization:get', () => limits());
  handleExtension('customization:set', async (value) => {
    const next = validateLimits(value);
    await writeConfig({ customizationLimits: next });
    manifestCache.clear();
    return next;
  });
  const folder = () => path.join(app.getPath('userData'), 'extensions');
  const enabledIds = () =>
    Array.isArray(readConfig().enabledExtensions) ? readConfig().enabledExtensions : [];

  async function readManifest(root, currentLimits, appVersion) {
    const manifestPath = path.resolve(root, 'manifest.json');
    let handle;
    let stat;
    try {
      handle = await fs.open(manifestPath, 'r');
      stat = await handle.stat();
    } catch (error) {
      await handle?.close();
      manifestCache.delete(manifestPath);
      throw error;
    }
    let source;
    try {
      const cached = manifestCache.get(manifestPath);
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        if (cached.error) {
          throw new Error(cached.error);
        }
        return cached;
      }
      manifestCache.delete(manifestPath);
      source = await handle.readFile('utf8');
    } finally {
      await handle.close();
    }
    let raw;
    try {
      raw = JSON.parse(source);
    } catch (error) {
      manifestCache.set(manifestPath, {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        error: error.message,
      });
      throw error;
    }
    try {
      let manifest;
      let incompatible = null;
      try {
        manifest = validateManifest(raw, root, currentLimits, { appVersion });
      } catch (error) {
        if (!/Invalid manifest: requires Tagline /.test(String(error?.message || ''))) {
          throw error;
        }
        manifest = validateManifest(raw, root, currentLimits, {
          appVersion,
          ignoreEngineCompatibility: true,
        });
        incompatible = manifest.engineIncompatible || {
          required: manifest.engines?.tagline,
          appVersion,
        };
      }
      const result = {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        manifest,
        incompatible,
        reviewToken: createHash('sha256').update(reviewSignature(manifest)).digest('hex'),
      };
      manifestCache.set(manifestPath, result);
      return result;
    } catch (error) {
      manifestCache.set(manifestPath, {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        error: error.message,
      });
      throw error;
    }
  }

  async function scan() {
    const config = readConfig();
    const extensionsFolder = folder();
    let entries = [];
    try {
      entries = await fs.readdir(extensionsFolder, { withFileTypes: true });
    } catch (e) {
      if (e.code !== 'ENOENT') {
        throw e;
      }
    }
    const enabled = Array.isArray(config.enabledExtensions) ? config.enabledExtensions : [];
    const forced = Array.isArray(config.engineCompatibilityOverrides)
      ? config.engineCompatibilityOverrides
      : [];
    const currentLimits = validateLimits(config.customizationLimits);
    const appVersion = app.getVersion?.() || '';
    const found = [];
    const ids = new Set();
    const manifests = new Set();
    for (const entry of entries
      .filter((e) => e.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const root = path.join(extensionsFolder, entry.name);
      const manifestPath = path.resolve(root, 'manifest.json');
      manifests.add(manifestPath);
      try {
        const { manifest, incompatible, reviewToken } = await readManifest(
          root,
          currentLimits,
          appVersion
        );
        if (ids.has(manifest.id)) {
          throw new Error(`Duplicate extension id: ${manifest.id}`);
        }
        ids.add(manifest.id);
        const incompatibleForced = !!incompatible && forced.includes(manifest.id);
        const reviewRequired = enabled.includes(manifest.id) && needsReview(manifest, config);
        found.push({
          ...manifest,
          folder: entry.name,
          root,
          allowedPermissions: Array.isArray(config.extensionPermissions?.[manifest.id])
            ? manifest.permissions.filter((permission) =>
                config.extensionPermissions[manifest.id].includes(permission)
              )
            : [...manifest.permissions],
          reviewRequired,
          reviewToken,
          incompatible: !!incompatible,
          incompatibleMessage: incompatible
            ? `Requires Tagline ${incompatible.required}, but this app is ${incompatible.appVersion}.`
            : '',
          forceEnabled: incompatibleForced,
          error:
            incompatible && !incompatibleForced
              ? `Requires Tagline ${incompatible.required}, but this app is ${incompatible.appVersion}.`
              : undefined,
          enabled:
            enabled.includes(manifest.id) &&
            !reviewRequired &&
            (!incompatible || incompatibleForced),
        });
      } catch (error) {
        found.push({ id: null, folder: entry.name, root, error: error.message, enabled: false });
      }
    }
    for (const manifestPath of manifestCache.keys()) {
      if (!manifests.has(manifestPath)) {
        manifestCache.delete(manifestPath);
      }
    }
    return found;
  }

  handleExtension('extensions:list', async () => (await scan()).map(({ root, ...item }) => item));
  handleExtension('extensions:exportSettings', async (id, values) => {
    const item = (await scan()).find((extension) => extension.id === id);
    if (!item || item.error || !values || typeof values !== 'object' || Array.isArray(values)) {
      throw new Error('Invalid extension settings export.');
    }
    const clean = {};
    for (const [key, value] of Object.entries(values)) {
      const setting = item.contributes.settings.find((definition) => definition.id === key);
      if (!setting) {
        throw new Error(`Undeclared extension setting: ${key}.`);
      }
      clean[key] = validateSettingValue(setting, value);
    }
    if (Buffer.byteLength(JSON.stringify(clean)) > limits().extensionStorageCharacters) {
      throw new Error('Extension settings exceed the configured storage limit.');
    }
    const result = await dialog.showSaveDialog(getWindow(), {
      title: 'Export extension settings',
      defaultPath: `${id}-settings.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled) {
      return { canceled: true };
    }
    await fs.writeFile(
      result.filePath,
      JSON.stringify({ version: 1, extensionId: id, values: clean }, null, 2),
      'utf8'
    );
    return { canceled: false };
  });

  // Returns code and declared assets only for enabled, valid extensions.
  handleExtension('extensions:load', async (id) => {
    const item = (await scan()).find((ext) => ext.id === id);
    if (!item || item.error) {
      throw new Error('Extension not found.');
    }
    if (!item.enabled) {
      throw new Error('Extension is disabled.');
    }
    const currentLimits = limits();
    let source = null;
    if (item.main) {
      const file = await containedFile(item.root, item.main, '.js');
      source = (
        await readExtensionFile(
          file,
          currentLimits.extensionSourceBytes,
          `Extension script exceeds ${currentLimits.extensionSourceBytes} bytes.`
        )
      ).toString('utf8');
    }
    const themes = [];
    const themeGroups = [];
    const translations = {};
    const fonts = [];
    const templates = [];
    let themePreviewBytes = 0;
    let fontBytes = 0;
    let templateBytes = 0;
    const readTheme = async (theme) => {
      const file = await containedFile(item.root, theme, '.json');
      const data = await readExtensionFile(
        file,
        currentLimits.themeFileBytes,
        `Theme file exceeds ${currentLimits.themeFileBytes} bytes.`
      );
      const size = data.length;
      themePreviewBytes += size;
      if (themePreviewBytes > currentLimits.themePreviewBytes) {
        throw new Error(
          `Extension theme previews exceed ${currentLimits.themePreviewBytes} bytes.`
        );
      }
      return JSON.parse(data.toString('utf8'));
    };
    for (const theme of item.contributes.themes) {
      themes.push(await readTheme(theme));
    }
    for (const group of item.contributes.themeGroups ?? []) {
      themeGroups.push({
        id: group.id,
        title: group.title,
        light: await readTheme(group.light),
        dark: await readTheme(group.dark),
      });
    }
    for (const [locale, relative] of Object.entries(item.contributes.translations ?? {})) {
      const file = await containedFile(item.root, relative, '.json');
      const data = await readExtensionFile(
        file,
        MAX_TRANSLATION_BYTES,
        `Translation catalog exceeds ${MAX_TRANSLATION_BYTES} bytes.`
      );
      translations[locale] = parseTranslationCatalog(data.toString('utf8'), locale);
    }
    for (const font of item.contributes.fonts ?? []) {
      const extension = path.extname(font.file).toLowerCase();
      const file = await containedFile(item.root, font.file, extension);
      const data = await readExtensionFile(
        file,
        MAX_FONT_BYTES,
        `Extension font exceeds ${MAX_FONT_BYTES} bytes.`
      );
      const size = data.length;
      fontBytes += size;
      if (fontBytes > MAX_FONT_TOTAL_BYTES) {
        throw new Error(`Extension fonts exceed ${MAX_FONT_TOTAL_BYTES} bytes.`);
      }
      fonts.push({
        family: font.family,
        weight: font.weight,
        style: font.style,
        license: font.license,
        source: font.source,
        mimeType: FONT_MIME_TYPES[extension],
        data: data.toString('base64'),
      });
    }
    for (const template of item.contributes.templates ?? []) {
      const file = await containedFile(item.root, template.file, '.md');
      const data = await readExtensionFile(
        file,
        MAX_TEMPLATE_BYTES,
        `Extension template exceeds ${MAX_TEMPLATE_BYTES} bytes.`
      );
      const size = data.length;
      templateBytes += size;
      if (templateBytes > MAX_TEMPLATE_TOTAL_BYTES) {
        throw new Error(`Extension templates exceed ${MAX_TEMPLATE_TOTAL_BYTES} bytes.`);
      }
      templates.push({
        id: template.id,
        title: template.title,
        content: data.toString('utf8'),
      });
    }
    const initialized = readConfig().initializedExtensions;
    const firstInstall = !!source && !(Array.isArray(initialized) && initialized.includes(item.id));
    let installToken = firstInstall ? randomUUID() : null;
    if (installToken) {
      const tokens = installTokens.get(item.id) ?? new Set();
      tokens.add(installToken);
      installTokens.set(item.id, tokens);
    }
    return {
      source,
      themes,
      themeGroups,
      translations,
      fonts,
      templates,
      limits: currentLimits,
      firstInstall,
      installToken,
    };
  });

  handleExtension('extensions:completeInstall', async (id, token) => {
    if (typeof token !== 'string' || !installTokens.get(id)?.has(token)) {
      throw new Error('Stale extension installation.');
    }
    const item = (await scan()).find(
      (extension) => extension.id === id && extension.enabled && !extension.error
    );
    if (!item) {
      throw new Error('Extension is no longer enabled.');
    }
    const initialized = readConfig().initializedExtensions;
    await writeConfig({
      initializedExtensions: [...new Set([...(Array.isArray(initialized) ? initialized : []), id])],
    });
    installTokens.delete(id);
    return true;
  });

  handleExtension('extensions:setEnabled', async (id, enabled, reviewToken, options = {}) => {
    if (typeof id !== 'string' || !ID.test(id) || typeof enabled !== 'boolean') {
      throw new Error('Invalid extension request.');
    }
    const forceIncompatible = !!(options && options.forceIncompatible);
    const item = (await scan()).find(
      (extension) => extension.id === id && (!extension.error || extension.incompatible)
    );
    if (enabled && !item) {
      throw new Error('Extension not found.');
    }
    if (enabled && item?.incompatible && !item.forceEnabled && !forceIncompatible) {
      throw new Error(
        item.incompatibleMessage || 'Extension is incompatible with this version of Tagline.'
      );
    }
    if (
      enabled &&
      (!item?.incompatible || item.forceEnabled || forceIncompatible) &&
      ((reviewToken !== undefined && reviewToken !== item.reviewToken) ||
        (item.permissions.some((permission) => REVIEW_PERMISSIONS.includes(permission)) &&
          reviewToken !== item.reviewToken))
    ) {
      throw new Error(
        'Extension permissions or settings changed. Reload and review before enabling.'
      );
    }
    const next = enabledIds().filter((value) => value !== id);
    if (!enabled) {
      installTokens.delete(id);
    }
    if (!enabled) {
      networkRequestTimes.delete(id);
      cancelAuthorization(id);
    }
    if (enabled) {
      next.push(id);
    }
    const config = readConfig();
    const extensionReviews = { ...config.extensionReviews };
    if (enabled) {
      extensionReviews[id] = reviewSignature(item);
    }
    let engineCompatibilityOverrides = Array.isArray(config.engineCompatibilityOverrides)
      ? config.engineCompatibilityOverrides.filter((value) => value !== id)
      : [];
    if (enabled && item?.incompatible && (forceIncompatible || item.forceEnabled)) {
      engineCompatibilityOverrides.push(id);
    }
    if (!enabled && item?.incompatible) {
      engineCompatibilityOverrides = engineCompatibilityOverrides.filter((value) => value !== id);
    }
    await writeConfig({ enabledExtensions: next, extensionReviews, engineCompatibilityOverrides });
    return next;
  });

  handleExtension('extensions:setPermissions', async (id, permissions, reviewToken) => {
    if (
      typeof id !== 'string' ||
      !ID.test(id) ||
      !Array.isArray(permissions) ||
      permissions.some((permission) => typeof permission !== 'string') ||
      new Set(permissions).size !== permissions.length
    ) {
      throw new Error('Invalid extension permission request.');
    }
    const item = (await scan()).find((extension) => extension.id === id);
    if (!item || item.error) {
      throw new Error('Extension not found.');
    }
    if (
      reviewToken !== item.reviewToken ||
      permissions.some((permission) => !item.permissions.includes(permission))
    ) {
      throw new Error('Extension permissions changed. Reload and review before changing access.');
    }
    const extensionPermissions = { ...readConfig().extensionPermissions };
    extensionPermissions[id] = [...permissions];
    if (!permissions.includes('network')) {
      cancelAuthorization(id);
    }
    await writeConfig({ extensionPermissions });
    return true;
  });

  handleExtension('extensions:uninstall', async (id) => {
    if (typeof id !== 'string' || !id || path.basename(id) !== id || id === '.' || id === '..') {
      throw new Error('Invalid extension request.');
    }
    const item = (await scan()).find((extension) => extension.folder === id);
    if (!item) {
      throw new Error('Extension not found.');
    }
    await fs.rm(item.root, { recursive: true });
    invalidateManifest(item.root);
    const config = readConfig();
    const extensionReviews = { ...config.extensionReviews };
    const extensionPermissions = { ...config.extensionPermissions };
    if (item.id) {
      installTokens.delete(item.id);
      networkRequestTimes.delete(item.id);
      cancelAuthorization(item.id);
      delete extensionReviews[item.id];
      delete extensionPermissions[item.id];
    }
    await writeConfig({
      enabledExtensions: enabledIds().filter((enabledId) => enabledId !== item.id),
      extensionReviews,
      extensionPermissions,
      initializedExtensions: (Array.isArray(config.initializedExtensions)
        ? config.initializedExtensions
        : []
      ).filter((initializedId) => initializedId !== item.id),
      engineCompatibilityOverrides: (Array.isArray(config.engineCompatibilityOverrides)
        ? config.engineCompatibilityOverrides
        : []
      ).filter((overrideId) => overrideId !== item.id),
    });
    if (item.id) {
      await context.serialize(item.id, async () => {
        await fs.rm(path.join(context.secretsDir(), `${item.id}.bin`), { force: true });
      });
    }
    if (item.id) {
      await context.serializeStorage(item.id, async () => {
        await fs.rm(path.join(context.storageDir(), `${item.id}.bin`), { force: true });
      });
    }
    return true;
  });

  const context = {
    app,
    handleExtension,
    shell,
    readConfig,
    writeConfig,
    dialog,
    getWindow,
    safeStorage,
    scan,
    limits,
    folder,
    invalidateManifest,
    enabledIds,
    resetExtensionState: (id) => {
      installTokens.delete(id);
      networkRequestTimes.delete(id);
      cancelAuthorization(id);
    },
  };
  registerStorageHandlers(context);

  async function authorizeNetwork(id, vaultWrite = false) {
    if (typeof id !== 'string' || !ID.test(id)) {
      throw new Error('Invalid extension request.');
    }
    const item = (await scan()).find((extension) => extension.id === id && !extension.error);
    if (!item || !item.enabled) {
      throw new Error('Extension is no longer enabled.');
    }
    if (!item.allowedPermissions.includes('network')) {
      throw new Error('Network permission is required.');
    }
    if (vaultWrite && !item.allowedPermissions.includes('vault:write')) {
      throw new Error('Vault write permission is required for downloads.');
    }
    return item;
  }

  function rateLimitNetwork(id) {
    const now = Date.now();
    const recent = (networkRequestTimes.get(id) || []).filter((time) => now - time < 1000);
    if (recent.length >= 20) {
      throw new Error('Extensions are limited to 20 network requests per second.');
    }
    recent.push(now);
    networkRequestTimes.set(id, recent);
  }

  handleExtension('extensions:networkFetch', async (id, url, options) => {
    const item = await authorizeNetwork(id);
    rateLimitNetwork(id);
    return requestExtensionNetwork(
      item.networkHosts,
      url,
      options,
      limits().extensionNetworkTimeoutMs
    );
  });

  async function vaultDestination(root, rel) {
    if (
      typeof rel !== 'string' ||
      !rel ||
      rel.length > 1024 ||
      rel.includes('\\') ||
      path.posix.isAbsolute(rel) ||
      path.win32.isAbsolute(rel)
    ) {
      throw new Error('Download destination must be a vault-relative path.');
    }
    const parts = rel.split('/');
    if (
      parts.some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          /[<>:"|?*\x00-\x1f]/.test(part) ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
      )
    ) {
      throw new Error('Invalid download destination.');
    }
    const realRoot = await fs.realpath(root);
    let parent = realRoot;
    for (const part of parts.slice(0, -1)) {
      parent = path.join(parent, part);
      const stat = await fs.lstat(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error('Download destination must use existing vault folders, without links.');
      }
    }
    return { realRoot, target: path.join(parent, parts.at(-1)) };
  }

  handleExtension('extensions:networkFetchToFile', async (id, url, rel, options) => {
    const item = await authorizeNetwork(id, true);
    const root = getVaultRoot?.();
    if (!root) {
      throw new Error('Open a vault before downloading.');
    }
    const destination = await vaultDestination(root, rel);
    const currentLimits = limits();
    rateLimitNetwork(id);
    const downloads = path.join(app.getPath('userData'), 'extension-downloads');
    const directory = path.join(downloads, id);
    for (const folder of [downloads, directory]) {
      await fs.mkdir(folder, { recursive: true });
      const stat = await fs.lstat(folder);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error('Invalid extension download directory.');
      }
    }
    const temporary = path.join(directory, `${randomUUID()}.tmp`);
    const file = await fs.open(temporary, 'wx', 0o600);
    try {
      const result = await downloadExtensionNetwork(
        item.networkHosts,
        url,
        options,
        currentLimits.extensionNetworkTimeoutMs,
        currentLimits.networkDownloadBytes,
        file
      );
      await file.close();
      const refreshed = await authorizeNetwork(id, true);
      if (reviewSignature(refreshed) !== reviewSignature(item)) {
        throw new Error('Extension permissions or hosts changed during download.');
      }
      if (getVaultRoot() !== root) {
        throw new Error('The vault changed during download.');
      }
      const checked = await vaultDestination(root, rel);
      if (checked.realRoot !== destination.realRoot || checked.target !== destination.target) {
        throw new Error('The vault changed during download.');
      }
      await fs.copyFile(temporary, checked.target, fsConstants.COPYFILE_EXCL);
      return { ...result, path: rel };
    } finally {
      try {
        await file.close();
      } finally {
        await fs.rm(temporary, { force: true });
      }
    }
  });

  handleExtension('extensions:oauthAuthorize', async (id, address, options = {}) => {
    const item = await authorizeNetwork(id);
    rateLimitNetwork(id);
    if (pendingAuthorizations.has(id)) {
      throw new Error('This extension already has an authorization flow in progress.');
    }
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      Object.keys(options).some((key) => key !== 'timeoutMs')
    ) {
      throw new Error('Invalid OAuth options.');
    }
    const flow = beginExtensionAuthorization({
      address,
      networkHosts: item.networkHosts,
      timeoutMs: options.timeoutMs ?? MAX_TIMEOUT_MS,
      openExternal: (url) => shell.openExternal(url),
    });
    pendingAuthorizations.set(id, flow);
    try {
      const result = await flow.promise;
      const current = await authorizeNetwork(id);
      if (reviewSignature(current) !== reviewSignature(item)) {
        throw new Error('Extension permissions or hosts changed during authorization.');
      }
      return result;
    } finally {
      if (pendingAuthorizations.get(id) === flow) {
        pendingAuthorizations.delete(id);
      }
      flow.cancel();
    }
  });
  handleExtension('extensions:oauthCancel', async (id) => {
    cancelAuthorization(id);
    return true;
  });

  handleExtension('extensions:readFile', async (id, relPath, encoding = 'utf8') => {
    const item = (await scan()).find((extension) => extension.id === id && !extension.error);
    if (!item) {
      throw new Error('Extension not found.');
    }
    if (!item.enabled) {
      throw new Error('Extension is disabled.');
    }
    if (encoding !== 'utf8' && encoding !== 'base64') {
      throw new Error('Invalid encoding.');
    }
    const file = await containedFileAny(item.root, relPath);
    const max = 2 * 1024 * 1024;
    const data = await readExtensionFile(file, max, `Extension file exceeds ${max} bytes.`);
    return encoding === 'base64' ? data.toString('base64') : data.toString('utf8');
  });

  handleExtension('extensions:chooseVaultPath', async (id, kind) => {
    const item = (await scan()).find((extension) => extension.id === id && !extension.error);
    if (!item || !item.enabled) {
      throw new Error('Extension is no longer enabled.');
    }
    if (!item.allowedPermissions.includes('vault:read')) {
      throw new Error('Extension does not have vault:read permission.');
    }
    const root = getVaultRoot?.();
    if (!root) {
      throw new Error('No vault is open.');
    }
    const res = await dialog.showOpenDialog(getWindow(), {
      title: kind === 'folder' ? 'Choose a vault folder' : 'Choose a vault file',
      defaultPath: root,
      properties: kind === 'folder' ? ['openDirectory'] : ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) {
      return null;
    }
    const selected = path.resolve(res.filePaths[0]);
    const relative = path.relative(root, selected);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Selected path must be inside the open vault.');
    }
    return relative.split(path.sep).join('/');
  });
  registerInstallHandlers(context);
}

module.exports = { registerExtensions, validateManifest, PERMISSIONS };
