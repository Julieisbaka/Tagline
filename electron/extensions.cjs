const fs = require('node:fs/promises');
const path = require('node:path');
const { validateSettingValue } = require('./extensionSettings.mjs');
const { createHash, randomUUID } = require('node:crypto');
const { validateLimits } = require('./customization.mjs');
const { requestExtensionNetwork } = require('./extensionNetwork.cjs');
const {
  validateManifest,
  reviewSignature,
  needsReview,
  PERMISSIONS,
  ID,
  REVIEW_PERMISSIONS,
} = require('./extensions/manifest.cjs');
const { containedFile } = require('./extensions/files.cjs');
const { registerStorageHandlers } = require('./extensions/storage.cjs');
const { registerInstallHandlers } = require('./extensions/install.cjs');

function registerExtensions({
  app,
  ipcMain,
  shell,
  readConfig,
  writeConfig,
  dialog,
  getWindow,
  safeStorage,
}) {
  const installTokens = new Map();
  const networkRequestTimes = new Map();
  const limits = () => validateLimits(readConfig().customizationLimits);
  ipcMain.handle('customization:get', () => limits());
  ipcMain.handle('customization:set', (_event, value) => {
    const next = validateLimits(value);
    writeConfig({ customizationLimits: next });
    return next;
  });
  const folder = () => path.join(app.getPath('userData'), 'extensions');
  const enabledIds = () =>
    Array.isArray(readConfig().enabledExtensions) ? readConfig().enabledExtensions : [];

  async function scan() {
    const config = readConfig();
    let entries = [];
    try {
      entries = await fs.readdir(folder(), { withFileTypes: true });
    } catch (e) {
      if (e.code !== 'ENOENT') {
        throw e;
      }
    }
    const enabled = Array.isArray(config.enabledExtensions) ? config.enabledExtensions : [];
    const found = [];
    const ids = new Set();
    for (const entry of entries
      .filter((e) => e.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const root = path.join(folder(), entry.name);
      try {
        const manifest = validateManifest(
          JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8')),
          root,
          limits()
        );
        if (ids.has(manifest.id)) {
          throw new Error(`Duplicate extension id: ${manifest.id}`);
        }
        ids.add(manifest.id);
        const reviewRequired = enabled.includes(manifest.id) && needsReview(manifest, config);
        const reviewToken = createHash('sha256').update(reviewSignature(manifest)).digest('hex');
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
          enabled: enabled.includes(manifest.id) && !reviewRequired,
        });
      } catch (error) {
        found.push({ id: null, folder: entry.name, root, error: error.message, enabled: false });
      }
    }
    return found;
  }

  ipcMain.handle('extensions:list', async () => (await scan()).map(({ root, ...item }) => item));
  ipcMain.handle('extensions:exportSettings', async (_event, id, values) => {
    const item = (await scan()).find((extension) => extension.id === id && !extension.error);
    if (!item || !values || typeof values !== 'object' || Array.isArray(values)) {
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
    if (JSON.stringify(clean).length > limits().extensionStorageCharacters) {
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

  // Returns code and theme files only for enabled, valid extensions.
  ipcMain.handle('extensions:load', async (_e, id) => {
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
      if ((await fs.stat(file)).size > currentLimits.extensionSourceBytes) {
        throw new Error(`Extension script exceeds ${currentLimits.extensionSourceBytes} bytes.`);
      }
      source = await fs.readFile(file, 'utf8');
    }
    const themes = [];
    let themePreviewBytes = 0;
    for (const theme of item.contributes.themes) {
      const file = await containedFile(item.root, theme, '.json');
      const size = (await fs.stat(file)).size;
      if (size > currentLimits.themeFileBytes) {
        throw new Error(`Theme file exceeds ${currentLimits.themeFileBytes} bytes.`);
      }
      themePreviewBytes += size;
      if (themePreviewBytes > currentLimits.themePreviewBytes) {
        throw new Error(
          `Extension theme previews exceed ${currentLimits.themePreviewBytes} bytes.`
        );
      }
      themes.push(JSON.parse(await fs.readFile(file, 'utf8')));
    }
    const initialized = readConfig().initializedExtensions;
    const firstInstall = !!source && !(Array.isArray(initialized) && initialized.includes(item.id));
    const installToken = firstInstall ? randomUUID() : null;
    if (installToken) {
      installTokens.set(item.id, installToken);
    }
    return { source, themes, limits: limits(), firstInstall, installToken };
  });

  ipcMain.handle('extensions:completeInstall', async (_event, id, token) => {
    if (typeof token !== 'string' || installTokens.get(id) !== token) {
      throw new Error('Stale extension installation.');
    }
    const item = (await scan()).find(
      (extension) => extension.id === id && extension.enabled && !extension.error
    );
    if (!item) {
      throw new Error('Extension is no longer enabled.');
    }
    const initialized = readConfig().initializedExtensions;
    writeConfig({
      initializedExtensions: [...new Set([...(Array.isArray(initialized) ? initialized : []), id])],
    });
    installTokens.delete(id);
    return true;
  });

  ipcMain.handle('extensions:setEnabled', async (_e, id, enabled, reviewToken) => {
    if (typeof id !== 'string' || !ID.test(id) || typeof enabled !== 'boolean') {
      throw new Error('Invalid extension request.');
    }
    const item = (await scan()).find((extension) => extension.id === id && !extension.error);
    if (enabled && !item) {
      throw new Error('Extension not found.');
    }
    if (
      enabled &&
      ((reviewToken !== undefined && reviewToken !== item.reviewToken) ||
        (item.permissions.some((permission) => REVIEW_PERMISSIONS.includes(permission)) &&
          reviewToken !== item.reviewToken))
    ) {
      throw new Error(
        'Extension permissions or settings changed. Reload and review before enabling.'
      );
    }
    const next = enabledIds().filter((item) => item !== id);
    if (!enabled) {
      installTokens.delete(id);
    }
    if (!enabled) {
      networkRequestTimes.delete(id);
    }
    if (enabled) {
      next.push(id);
    }
    const extensionReviews = { ...readConfig().extensionReviews };
    if (enabled) {
      extensionReviews[id] = reviewSignature(item);
    }
    writeConfig({ enabledExtensions: next, extensionReviews });
    return next;
  });

  ipcMain.handle('extensions:setPermissions', async (_event, id, permissions, reviewToken) => {
    if (
      typeof id !== 'string' ||
      !ID.test(id) ||
      !Array.isArray(permissions) ||
      permissions.some((permission) => typeof permission !== 'string') ||
      new Set(permissions).size !== permissions.length
    ) {
      throw new Error('Invalid extension permission request.');
    }
    const item = (await scan()).find((extension) => extension.id === id && !extension.error);
    if (!item) {
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
    writeConfig({ extensionPermissions });
    return true;
  });

  ipcMain.handle('extensions:uninstall', async (_event, id) => {
    if (typeof id !== 'string' || !id || path.basename(id) !== id || id === '.' || id === '..') {
      throw new Error('Invalid extension request.');
    }
    const item = (await scan()).find((extension) => extension.folder === id);
    if (!item) {
      throw new Error('Extension not found.');
    }
    await fs.rm(item.root, { recursive: true });
    const config = readConfig();
    const extensionReviews = { ...config.extensionReviews };
    const extensionPermissions = { ...config.extensionPermissions };
    if (item.id) {
      installTokens.delete(item.id);
      networkRequestTimes.delete(item.id);
      delete extensionReviews[item.id];
      delete extensionPermissions[item.id];
    }
    writeConfig({
      enabledExtensions: enabledIds().filter((enabledId) => enabledId !== item.id),
      extensionReviews,
      extensionPermissions,
      initializedExtensions: (Array.isArray(config.initializedExtensions)
        ? config.initializedExtensions
        : []
      ).filter((initializedId) => initializedId !== item.id),
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
    ipcMain,
    shell,
    readConfig,
    writeConfig,
    dialog,
    getWindow,
    safeStorage,
    scan,
    limits,
    folder,
    enabledIds,
  };
  registerStorageHandlers(context);

  ipcMain.handle('extensions:networkFetch', async (_event, id, url, options) => {
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
    const now = Date.now();
    const recent = (networkRequestTimes.get(id) || []).filter((time) => now - time < 1000);
    if (recent.length >= 10) {
      throw new Error('Extensions are limited to 10 network requests per second.');
    }
    recent.push(now);
    networkRequestTimes.set(id, recent);
    return requestExtensionNetwork(item.networkHosts, url, options);
  });

  registerInstallHandlers(context);
}

module.exports = { registerExtensions, validateManifest, PERMISSIONS };
