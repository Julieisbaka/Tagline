const fs = require('node:fs/promises');
const path = require('node:path');
const { validateSettingDefinitions, validateSettingValue } = require('./extensionSettings.mjs');
const { createHash } = require('node:crypto');
const { DEFAULT_LIMITS, validateLimits } = require('./customization.mjs');

// Extensions live in <userData>/extensions/<folder>/manifest.json. The main process only reads and
// validates files; extension code runs in a supervised sandbox worker (see src/lib/extensions.js).
const PERMISSIONS = ['editor', 'vault:read', 'vault:write', 'settings', 'editor:active-note', 'events', 'ui'];
const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;

function relativeFile(root, value, ext) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || !value.toLowerCase().endsWith(ext)) {
    throw new Error(`Expected a relative ${ext} file path.`);
  }
  const full = path.resolve(root, value);
  const rel = path.relative(root, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`File escapes the extension folder: ${value}`);
  return full;
}

// Resolves symlinks so a link inside the extension folder cannot read files elsewhere.
async function containedFile(root, value, ext) {
  const file = await fs.realpath(relativeFile(root, value, ext));
  const rel = path.relative(await fs.realpath(root), file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`File escapes the extension folder: ${value}`);
  return file;
}

function validateManifest(value, root, limits = DEFAULT_LIMITS) {
  const fail = (message) => { throw new Error(`Invalid manifest: ${message}`); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('expected a JSON object.');
  if (value.manifestVersion !== 1) fail('manifestVersion must be 1.');
  if (typeof value.id !== 'string' || !ID.test(value.id)) fail('id must be 2-64 lowercase letters, digits or dashes.');
  for (const key of ['name', 'version']) {
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 80) fail(`${key} is required.`);
  }
  for (const key of ['description', 'author']) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 500)) fail(`${key} must be text.`);
  }
  const permissions = value.permissions ?? [];
  if (!Array.isArray(permissions) || permissions.some((p) => !PERMISSIONS.includes(p))) {
    fail(`permissions may only contain ${PERMISSIONS.join(', ')}.`);
  }
  const contributes = value.contributes ?? {};
  if (typeof contributes !== 'object' || Array.isArray(contributes)) fail('contributes must be an object.');
  const commands = contributes.commands ?? [];
  const themes = contributes.themes ?? [];
  const settings = validateSettingDefinitions(contributes.settings, limits);
  const surfaces = {};
  for (const kind of ['panels', 'webviews']) {
    const declarations = contributes[kind] ?? [];
    if (!Array.isArray(declarations) || declarations.length > 10) fail(`contributes.${kind} must be a list of at most 10.`);
    const ids = new Set();
    surfaces[kind] = declarations.map((item) => {
      if (!item || typeof item.id !== 'string' || !ID.test(item.id) || ids.has(item.id) ||
        typeof item.title !== 'string' || !item.title.trim() || item.title.length > 80) {
        fail(`each ${kind} contribution needs a unique id and a title of up to 80 characters.`);
      }
      ids.add(item.id);
      return { id: item.id, title: item.title.trim() };
    });
    if (declarations.length && (!permissions.includes('ui') || !value.main)) fail(`${kind} require ui permission and a main script.`);
  }
  if (settings.length && !permissions.includes('settings')) fail('contributes.settings requires the settings permission.');
  if (!Array.isArray(commands) || commands.length > limits.extensionCommands) fail(`contributes.commands must be a list of at most ${limits.extensionCommands}.`);
  if (!Array.isArray(themes) || themes.length > limits.extensionThemes) fail(`contributes.themes must be a list of at most ${limits.extensionThemes}.`);
  const seen = new Set();
  for (const command of commands) {
    if (!command || typeof command.id !== 'string' || !ID.test(command.id) || seen.has(command.id)) {
      fail('each command needs a unique lowercase id.');
    }
    seen.add(command.id);
    if (typeof command.title !== 'string' || !command.title.trim() || command.title.length > 80) fail(`command ${command.id} needs a title.`);
    if (command.key !== undefined && typeof command.key !== 'string') fail(`command ${command.id} key must be text.`);
  }
  if (commands.length && !value.main) fail('commands require a main script.');
  if (value.main !== undefined) relativeFile(root, value.main, '.js');
  themes.forEach((theme) => relativeFile(root, theme, '.json'));
  return {
    manifestVersion: 1, id: value.id, name: value.name.trim(), version: value.version.trim(),
    description: value.description || '', author: value.author || '', main: value.main || null,
    permissions: [...new Set(permissions)],
    contributes: { commands: commands.map(({ id, title, key }) => ({ id, title: title.trim(), key: key || '' })), themes, settings, ...surfaces },
  };
}

function reviewSignature(manifest) {
  return JSON.stringify({
    permissions: [...manifest.permissions].sort(), settings: manifest.contributes.settings,
    ...(manifest.contributes.panels.length || manifest.contributes.webviews.length
      ? { panels: manifest.contributes.panels, webviews: manifest.contributes.webviews } : {})
  });
}

function needsReview(manifest, config) {
  const approved = config.extensionReviews?.[manifest.id];
  if (approved !== undefined) return approved !== reviewSignature(manifest);
  // Preserve old enabled extensions, but never silently grant either new capability.
  return manifest.permissions.some((permission) => ['settings', 'editor:active-note', 'events', 'ui'].includes(permission));
}

function registerExtensions({ app, ipcMain, shell, readConfig, writeConfig, dialog, getWindow }) {
  const limits = () => validateLimits(readConfig().customizationLimits);
  ipcMain.handle('customization:get', () => limits());
  ipcMain.handle('customization:set', (_event, value) => {
    const next = validateLimits(value);
    writeConfig({ customizationLimits: next });
    return next;
  });
  const folder = () => path.join(app.getPath('userData'), 'extensions');
  const enabledIds = () => (Array.isArray(readConfig().enabledExtensions) ? readConfig().enabledExtensions : []);

  async function scan() {
    let entries = [];
    try { entries = await fs.readdir(folder(), { withFileTypes: true }); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    const enabled = enabledIds();
    const found = [];
    const ids = new Set();
    for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const root = path.join(folder(), entry.name);
      try {
        const manifest = validateManifest(JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8')), root, limits());
        if (ids.has(manifest.id)) throw new Error(`Duplicate extension id: ${manifest.id}`);
        ids.add(manifest.id);
        const reviewRequired = enabled.includes(manifest.id) && needsReview(manifest, readConfig());
        const reviewToken = createHash('sha256').update(reviewSignature(manifest)).digest('hex');
        found.push({
          ...manifest, folder: entry.name, root, reviewRequired, reviewToken,
          enabled: enabled.includes(manifest.id) && !reviewRequired
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
    if (!item || !values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Invalid extension settings export.');
    const clean = {};
    for (const [key, value] of Object.entries(values)) {
      const setting = item.contributes.settings.find((definition) => definition.id === key);
      if (!setting) throw new Error(`Undeclared extension setting: ${key}.`);
      clean[key] = validateSettingValue(setting, value);
    }
    if (JSON.stringify(clean).length > limits().extensionStorageCharacters) throw new Error('Extension settings exceed the configured storage limit.');
    const result = await dialog.showSaveDialog(getWindow(), {
      title: 'Export extension settings', defaultPath: `${id}-settings.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled) return { canceled: true };
    await fs.writeFile(result.filePath, JSON.stringify({ version: 1, extensionId: id, values: clean }, null, 2), 'utf8');
    return { canceled: false };
  });

  // Returns code and theme files only for enabled, valid extensions.
  ipcMain.handle('extensions:load', async (_e, id) => {
    const item = (await scan()).find((ext) => ext.id === id);
    if (!item || item.error) throw new Error('Extension not found.');
    if (!item.enabled) throw new Error('Extension is disabled.');
    let source = null;
    if (item.main) {
      const file = await containedFile(item.root, item.main, '.js');
      if ((await fs.stat(file)).size > limits().extensionSourceBytes) throw new Error(`Extension script exceeds ${limits().extensionSourceBytes} bytes.`);
      source = await fs.readFile(file, 'utf8');
    }
    const themes = [];
    for (const theme of item.contributes.themes) {
      const file = await containedFile(item.root, theme, '.json');
      if ((await fs.stat(file)).size > limits().themeFileBytes) throw new Error(`Theme file exceeds ${limits().themeFileBytes} bytes.`);
      themes.push(JSON.parse(await fs.readFile(file, 'utf8')));
    }
    return { source, themes, limits: limits() };
  });

  ipcMain.handle('extensions:setEnabled', async (_e, id, enabled, reviewToken) => {
    if (typeof id !== 'string' || !ID.test(id) || typeof enabled !== 'boolean') throw new Error('Invalid extension request.');
    const item = (await scan()).find((extension) => extension.id === id && !extension.error);
    if (enabled && !item) throw new Error('Extension not found.');
    if (enabled && ((reviewToken !== undefined && reviewToken !== item.reviewToken) ||
      (item.permissions.some((permission) => ['settings', 'editor:active-note', 'events', 'ui'].includes(permission)) &&
        reviewToken !== item.reviewToken))) {
      throw new Error('Extension permissions or settings changed. Reload and review before enabling.');
    }
    const next = enabledIds().filter((item) => item !== id);
    if (enabled) next.push(id);
    const extensionReviews = { ...readConfig().extensionReviews };
    if (enabled) extensionReviews[id] = reviewSignature(item);
    writeConfig({ enabledExtensions: next, extensionReviews });
    return next;
  });

  ipcMain.handle('extensions:openFolder', async () => {
    await fs.mkdir(folder(), { recursive: true });
    const error = await shell.openPath(folder());
    if (error) throw new Error(error);
  });
}

module.exports = { registerExtensions, validateManifest, PERMISSIONS };
