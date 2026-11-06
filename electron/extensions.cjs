const fs = require('node:fs/promises');
const path = require('node:path');
const { validateSettingDefinitions, validateSettingValue } = require('./extensionSettings.mjs');
const { createHash, randomUUID } = require('node:crypto');
const { DEFAULT_LIMITS, validateLimits } = require('./customization.mjs');
const { requestExtensionNetwork, validateNetworkHosts } = require('./extensionNetwork.cjs');

// Extensions live in <userData>/extensions/<folder>/manifest.json. The main process only reads and
// validates files; extension code runs in a supervised sandbox worker (see src/lib/extensions.js).
const PERMISSIONS = [
  'editor',
  'vault:read',
  'vault:write',
  'settings',
  'editor:active-note',
  'events',
  'ui',
  'network',
  'secrets',
];
const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const REVIEW_PERMISSIONS = ['settings', 'editor:active-note', 'events', 'ui', 'network', 'secrets'];
const MAX_SECRET_KEY = 200;
const MAX_SECRET_VALUE = 10000;
const MAX_SECRETS = 50;
const MAX_INSTALL_FILES = 5000;
const MAX_INSTALL_BYTES = 50 * 1024 * 1024;
const SKIPPED_NAMES = new Set(['.git', 'node_modules']);

// Accepts the extension folder, its manifest.json, or a wrapper folder holding exactly one extension.
async function findManifestRoot(source) {
  const stat = await fs.stat(source).catch(() => null);
  if (!stat) {
    throw new Error('That path no longer exists.');
  }
  let dir = source;
  if (stat.isFile()) {
    if (path.basename(source).toLowerCase() !== 'manifest.json') {
      throw new Error('Drop a folder that contains a manifest.json file.');
    }
    dir = path.dirname(source);
  }
  const hasManifest = (candidate) =>
    fs.stat(path.join(candidate, 'manifest.json')).then(
      (item) => item.isFile(),
      () => false
    );
  if (await hasManifest(dir)) {
    return dir;
  }
  const nested = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const candidate = path.join(dir, entry.name);
    if (entry.isDirectory() && !SKIPPED_NAMES.has(entry.name) && (await hasManifest(candidate))) {
      nested.push(candidate);
    }
  }
  if (nested.length === 1) {
    return nested[0];
  }
  throw new Error(
    nested.length
      ? 'Several extensions were found. Drop one extension folder at a time.'
      : `No manifest.json found in "${path.basename(dir)}".`
  );
}

async function assertCopyable(root) {
  let files = 0;
  let bytes = 0;
  const pending = [root];
  while (pending.length) {
    for (const entry of await fs.readdir(pending.pop(), { withFileTypes: true })) {
      if (SKIPPED_NAMES.has(entry.name) || entry.isSymbolicLink()) {
        continue;
      }
      const full = path.join(entry.parentPath, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
      } else if (entry.isFile()) {
        files += 1;
        bytes += (await fs.stat(full)).size;
      }
      if (files > MAX_INSTALL_FILES || bytes > MAX_INSTALL_BYTES) {
        throw new Error('Extension folder is too large to install.');
      }
    }
  }
}

async function copyFilter(source) {
  return !SKIPPED_NAMES.has(path.basename(source)) && !(await fs.lstat(source)).isSymbolicLink();
}

function relativeFile(root, value, ext) {
  if (
    typeof value !== 'string' ||
    !value ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    /^[a-z]:/i.test(value) ||
    !value.toLowerCase().endsWith(ext)
  ) {
    throw new Error(`Expected a relative ${ext} file path.`);
  }
  const full = path.resolve(root, value);
  const rel = path.relative(root, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`File escapes the extension folder: ${value}`);
  }
  return full;
}

// Resolves symlinks so a link inside the extension folder cannot read files elsewhere.
async function containedFile(root, value, ext) {
  const file = await fs.realpath(relativeFile(root, value, ext));
  const rel = path.relative(await fs.realpath(root), file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`File escapes the extension folder: ${value}`);
  }
  return file;
}

function validateManifest(value, root, limits = DEFAULT_LIMITS) {
  const fail = (message) => {
    throw new Error(`Invalid manifest: ${message}`);
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('expected a JSON object.');
  }
  if (value.manifestVersion !== 1) {
    fail('manifestVersion must be 1.');
  }
  if (typeof value.id !== 'string' || !ID.test(value.id)) {
    fail('id must be 2-64 lowercase letters, digits or dashes.');
  }
  for (const key of ['name', 'version']) {
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 80) {
      fail(`${key} is required.`);
    }
  }
  for (const key of ['description', 'author']) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 500)) {
      fail(`${key} must be text.`);
    }
  }
  const permissions = value.permissions ?? [];
  if (!Array.isArray(permissions) || permissions.some((p) => !PERMISSIONS.includes(p))) {
    fail(`permissions may only contain ${PERMISSIONS.join(', ')}.`);
  }
  let networkHosts;
  try {
    networkHosts = validateNetworkHosts(value.networkHosts === undefined ? [] : value.networkHosts);
  } catch (error) {
    fail(error.message);
  }
  if (permissions.includes('network') !== networkHosts.length > 0) {
    fail('network requires at least one networkHosts entry, and networkHosts requires network.');
  }
  const contributes = value.contributes ?? {};
  if (typeof contributes !== 'object' || Array.isArray(contributes)) {
    fail('contributes must be an object.');
  }
  const commands = contributes.commands ?? [];
  const themes = contributes.themes ?? [];
  const settings = validateSettingDefinitions(contributes.settings, limits);
  const surfaces = {};
  for (const kind of ['panels', 'webviews']) {
    const declarations = contributes[kind] ?? [];
    if (!Array.isArray(declarations) || declarations.length > 10) {
      fail(`contributes.${kind} must be a list of at most 10.`);
    }
    const ids = new Set();
    surfaces[kind] = declarations.map((item) => {
      if (
        !item ||
        typeof item.id !== 'string' ||
        !ID.test(item.id) ||
        ids.has(item.id) ||
        typeof item.title !== 'string' ||
        !item.title.trim() ||
        item.title.length > 80
      ) {
        fail(`each ${kind} contribution needs a unique id and a title of up to 80 characters.`);
      }
      ids.add(item.id);
      return { id: item.id, title: item.title.trim() };
    });
    if (declarations.length && (!permissions.includes('ui') || !value.main)) {
      fail(`${kind} require ui permission and a main script.`);
    }
  }
  if (settings.length && !permissions.includes('settings')) {
    fail('contributes.settings requires the settings permission.');
  }
  if (!Array.isArray(commands) || commands.length > limits.extensionCommands) {
    fail(`contributes.commands must be a list of at most ${limits.extensionCommands}.`);
  }
  if (!Array.isArray(themes) || themes.length > limits.extensionThemes) {
    fail(`contributes.themes must be a list of at most ${limits.extensionThemes}.`);
  }
  const seen = new Set();
  for (const command of commands) {
    if (
      !command ||
      typeof command.id !== 'string' ||
      !ID.test(command.id) ||
      seen.has(command.id)
    ) {
      fail('each command needs a unique lowercase id.');
    }
    seen.add(command.id);
    if (typeof command.title !== 'string' || !command.title.trim() || command.title.length > 80) {
      fail(`command ${command.id} needs a title.`);
    }
    if (command.key !== undefined && typeof command.key !== 'string') {
      fail(`command ${command.id} key must be text.`);
    }
  }
  if (commands.length && !value.main) {
    fail('commands require a main script.');
  }
  const ribbonItems = contributes.ribbonItems ?? [];
  if (!Array.isArray(ribbonItems) || ribbonItems.length > 10) {
    fail('contributes.ribbonItems must be a list of at most 10.');
  }
  const ribbonIds = new Set();
  for (const item of ribbonItems) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !ID.test(item.id) ||
      ribbonIds.has(item.id) ||
      typeof item.title !== 'string' ||
      !item.title.trim() ||
      item.title.length > 80 ||
      typeof item.icon !== 'string' ||
      !/^[a-z-]{1,40}$/.test(item.icon) ||
      !commands.some((command) => command.id === item.command)
    ) {
      fail('each ribbon item needs a unique id, title, icon name and declared command.');
    }
    ribbonIds.add(item.id);
  }
  if (ribbonItems.length && !permissions.includes('ui')) {
    fail('ribbon items require ui permission.');
  }
  if (value.main !== undefined) {
    relativeFile(root, value.main, '.js');
  }
  themes.forEach((theme) => relativeFile(root, theme, '.json'));
  return {
    manifestVersion: 1,
    id: value.id,
    name: value.name.trim(),
    version: value.version.trim(),
    description: value.description || '',
    author: value.author || '',
    main: value.main || null,
    permissions: [...new Set(permissions)],
    networkHosts,
    contributes: {
      commands: commands.map(({ id, title, key }) => ({ id, title: title.trim(), key: key || '' })),
      themes,
      settings,
      ribbonItems: ribbonItems.map(({ id, title, icon, command }) => ({
        id,
        title: title.trim(),
        icon,
        command,
      })),
      ...surfaces,
    },
  };
}

function reviewSignature(manifest) {
  return JSON.stringify({
    permissions: [...manifest.permissions].sort(),
    settings: manifest.contributes.settings,
    ...(manifest.contributes.ribbonItems.length
      ? { ribbonItems: manifest.contributes.ribbonItems }
      : {}),
    ...(manifest.contributes.panels.length || manifest.contributes.webviews.length
      ? { panels: manifest.contributes.panels, webviews: manifest.contributes.webviews }
      : {}),
    ...(manifest.networkHosts?.length ? { networkHosts: [...manifest.networkHosts].sort() } : {}),
  });
}

function needsReview(manifest, config) {
  const approved = config.extensionReviews?.[manifest.id];
  if (approved !== undefined) {
    return approved !== reviewSignature(manifest);
  }
  // Legacy extensions without a stored review may keep running only when they declare
  // no review-gated capability; settings, editor:active-note, events, ui and network
  // always require an explicit, matching review before they are enabled.
  return manifest.permissions.some((permission) => REVIEW_PERMISSIONS.includes(permission));
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
    let entries = [];
    try {
      entries = await fs.readdir(folder(), { withFileTypes: true });
    } catch (e) {
      if (e.code !== 'ENOENT') {
        throw e;
      }
    }
    const enabled = enabledIds();
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
        const reviewRequired = enabled.includes(manifest.id) && needsReview(manifest, readConfig());
        const reviewToken = createHash('sha256').update(reviewSignature(manifest)).digest('hex');
        found.push({
          ...manifest,
          folder: entry.name,
          root,
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

  const secretsDir = () => path.join(app.getPath('userData'), 'extension-secrets');
  const secretQueues = new Map();
  const storageDir = () => path.join(app.getPath('userData'), 'extension-storage');
  const storageQueues = new Map();
  const readExtensionStorage = async (id) => {
    const file = path.join(storageDir(), `${id}.bin`);
    let encrypted;
    try {
      encrypted = await fs.readFile(file);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
    try {
      const parsed = JSON.parse((await safeStorage.decryptStringAsync(encrypted)).result);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      throw new Error('Cannot decrypt this extension’s storage.');
    }
  };
  const writeExtensionStorage = async (id, data) => {
    const file = path.join(storageDir(), `${id}.bin`);
    if (!Object.keys(data).length) {
      await fs.rm(file, { force: true });
      return;
    }
    await fs.mkdir(storageDir(), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, await safeStorage.encryptStringAsync(JSON.stringify(data)), {
      mode: 0o600,
    });
    await fs.rename(tmp, file);
  };
  const serializeStorage = (id, task) => {
    const run = (storageQueues.get(id) || Promise.resolve()).catch(() => {}).then(task);
    storageQueues.set(id, run);
    return run;
  };
  ipcMain.handle('extensions:storage', async (_event, id, action, key, value) => {
    if (typeof id !== 'string' || !ID.test(id) || !['get', 'set', 'replace'].includes(action)) {
      throw new Error('Invalid extension request.');
    }
    const item = (await scan()).find((extension) => extension.id === id && !extension.error);
    if (!item || !item.enabled) {
      throw new Error('Extension is no longer enabled.');
    }
    if (!safeStorage || !(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('Secure storage is not available on this system.');
    }
    return serializeStorage(id, async () => {
      const data = await readExtensionStorage(id);
      if (action === 'get') {
        return data;
      }
      let next;
      if (action === 'set') {
        if (typeof key !== 'string' || !key || key.length > MAX_SECRET_KEY) {
          throw new Error(`Key must be 1-${MAX_SECRET_KEY} characters.`);
        }
        next = { ...(data || {}), [key]: value };
        if (value === undefined || value === null) {
          delete next[key];
        }
      } else {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('Invalid extension storage.');
        }
        next = value;
      }
      if (JSON.stringify(next).length > limits().extensionStorageCharacters) {
        throw new Error('Extension storage exceeds the configured limit.');
      }
      await writeExtensionStorage(id, next);
      return true;
    });
  });
  const readSecrets = async (id) => {
    const file = path.join(secretsDir(), `${id}.bin`);
    let encrypted;
    try {
      encrypted = await fs.readFile(file);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {};
      }
      throw error;
    }
    try {
      const parsed = JSON.parse((await safeStorage.decryptStringAsync(encrypted)).result);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      throw new Error('Cannot decrypt this extension’s secrets. Clear them and set them again.');
    }
  };
  const writeSecrets = async (id, data) => {
    const file = path.join(secretsDir(), `${id}.bin`);
    if (!Object.keys(data).length) {
      await fs.rm(file, { force: true });
      return;
    }
    await fs.mkdir(secretsDir(), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, await safeStorage.encryptStringAsync(JSON.stringify(data)), {
      mode: 0o600,
    });
    await fs.rename(tmp, file);
  };
  const serialize = (id, task) => {
    const run = (secretQueues.get(id) || Promise.resolve()).catch(() => {}).then(task);
    secretQueues.set(id, run);
    return run;
  };

  ipcMain.handle('extensions:secret', async (_event, id, action, key, value) => {
    if (typeof id !== 'string' || !ID.test(id) || !['get', 'set', 'has'].includes(action)) {
      throw new Error('Invalid extension request.');
    }
    const item = (await scan()).find((extension) => extension.id === id && !extension.error);
    if (!item || !item.enabled) {
      throw new Error('Extension is no longer enabled.');
    }
    if (!item.permissions.includes('secrets')) {
      throw new Error('Secrets permission is required.');
    }
    if (typeof key !== 'string' || !key || key.length > MAX_SECRET_KEY) {
      throw new Error(`Key must be 1-${MAX_SECRET_KEY} characters.`);
    }
    if (!safeStorage || !(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('Secure storage is not available on this system.');
    }
    return serialize(id, async () => {
      const data = await readSecrets(id);
      if (action === 'get') {
        return Object.hasOwn(data, key) ? data[key] : null;
      }
      if (action === 'has') {
        return Object.hasOwn(data, key);
      }
      const next = { ...data };
      if (value === null || value === undefined) {
        delete next[key];
      } else {
        if (typeof value !== 'string' || value.length > MAX_SECRET_VALUE) {
          throw new Error(`Secret values must be strings up to ${MAX_SECRET_VALUE} characters.`);
        }
        if (!Object.hasOwn(next, key) && Object.keys(next).length >= MAX_SECRETS) {
          throw new Error(`Extensions can store at most ${MAX_SECRETS} secrets.`);
        }
        next[key] = value;
      }
      await writeSecrets(id, next);
      return true;
    });
  });

  ipcMain.handle('extensions:clearSecrets', (_event, id) => {
    if (typeof id !== 'string' || !ID.test(id)) {
      throw new Error('Invalid extension request.');
    }
    return serialize(id, async () => {
      await fs.rm(path.join(secretsDir(), `${id}.bin`), { force: true });
      return true;
    });
  });

  ipcMain.handle('extensions:networkFetch', async (_event, id, url, options) => {
    if (typeof id !== 'string' || !ID.test(id)) {
      throw new Error('Invalid extension request.');
    }
    const item = (await scan()).find((extension) => extension.id === id && !extension.error);
    if (!item || !item.enabled) {
      throw new Error('Extension is no longer enabled.');
    }
    if (!item.permissions.includes('network')) {
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

  // Copies a dropped or chosen folder (or its manifest.json) into the extensions folder and enables
  // it when it declares no review-gated permission; otherwise the user reviews it in Settings.
  async function installFromFolder(source) {
    if (typeof source !== 'string' || !path.isAbsolute(source)) {
      throw new Error('Choose a folder that contains a manifest.json file.');
    }
    const root = await findManifestRoot(source);
    const manifest = validateManifest(
      JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8')),
      root,
      limits()
    );
    if (manifest.main) {
      await containedFile(root, manifest.main, '.js');
    }
    for (const theme of manifest.contributes.themes) {
      await containedFile(root, theme, '.json');
    }
    const installed = await scan();
    const existing = installed.find((item) => item.id === manifest.id);
    const taken = new Set(installed.map((item) => item.folder));
    let name = manifest.id;
    for (let i = 2; !existing && taken.has(name); i++) {
      name = `${manifest.id}-${i}`;
    }
    const target = existing ? existing.root : path.join(folder(), name);
    const inPlace = (await fs.realpath(root).catch(() => root)) === (await realpathOrSelf(target));
    if (!inPlace) {
      await copyExtension(root, target);
    }
    const gated = manifest.permissions.some((permission) =>
      REVIEW_PERMISSIONS.includes(permission)
    );
    const wasEnabled = enabledIds().includes(manifest.id);
    let enabled = wasEnabled;
    if (!gated && !wasEnabled) {
      writeConfig({
        enabledExtensions: [...enabledIds(), manifest.id],
        extensionReviews: {
          ...readConfig().extensionReviews,
          [manifest.id]: reviewSignature(manifest),
        },
      });
      enabled = true;
    } else if (!gated) {
      writeConfig({
        extensionReviews: {
          ...readConfig().extensionReviews,
          [manifest.id]: reviewSignature(manifest),
        },
      });
    }
    const reviewRequired = gated && (!wasEnabled || needsReview(manifest, readConfig()));
    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      replaced: !!existing,
      enabled: enabled && !reviewRequired,
      reviewRequired,
    };
  }

  const realpathOrSelf = (target) => fs.realpath(target).catch(() => path.resolve(target));

  async function copyExtension(source, target) {
    await assertCopyable(source);
    const staging = path.join(app.getPath('userData'), 'extension-staging', randomUUID());
    await fs.mkdir(path.dirname(staging), { recursive: true });
    try {
      await fs.cp(source, staging, { recursive: true, filter: copyFilter });
      await fs.mkdir(path.dirname(target), { recursive: true });
      const backup = `${staging}.previous`;
      const hadPrevious = await fs.rename(target, backup).then(
        () => true,
        (error) => {
          if (error.code !== 'ENOENT') {
            throw error;
          }
          return false;
        }
      );
      try {
        await fs.rename(staging, target);
      } catch (error) {
        if (hadPrevious) {
          await fs.rename(backup, target);
        }
        throw error;
      }
      if (hadPrevious) {
        await fs.rm(backup, { recursive: true, force: true });
      }
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }

  ipcMain.handle('extensions:installFolder', (_event, source) => installFromFolder(source));
  ipcMain.handle('extensions:chooseAndInstall', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Install extension from folder',
      properties: ['openDirectory'],
    });
    return result.canceled || !result.filePaths[0] ? null : installFromFolder(result.filePaths[0]);
  });

  ipcMain.handle('extensions:openFolder', async () => {
    await fs.mkdir(folder(), { recursive: true });
    const error = await shell.openPath(folder());
    if (error) {
      throw new Error(error);
    }
  });
}

module.exports = { registerExtensions, validateManifest, PERMISSIONS };
