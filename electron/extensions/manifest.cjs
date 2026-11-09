const path = require('node:path');
const { validateSettingDefinitions } = require('../extensionSettings.mjs');
const { DEFAULT_LIMITS } = require('../customization.mjs');
const { validateNetworkHosts } = require('../extensionNetwork.cjs');

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
  'api',
];
const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const REVIEW_PERMISSIONS = ['settings', 'editor:active-note', 'events', 'ui', 'network', 'secrets', 'api'];

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
  let sourceUrl = '';
  if (value.sourceUrl !== undefined) {
    if (
      typeof value.sourceUrl !== 'string' ||
      !value.sourceUrl.trim() ||
      value.sourceUrl !== value.sourceUrl.trim() ||
      value.sourceUrl.length > 2048
    ) {
      fail('sourceUrl must be a valid HTTPS URL of at most 2,048 characters.');
    }
    let parsedSourceUrl;
    try {
      parsedSourceUrl = new URL(value.sourceUrl);
    } catch {
      fail('sourceUrl must be a valid HTTPS URL of at most 2,048 characters.');
    }
    if (
      parsedSourceUrl.protocol !== 'https:' ||
      !parsedSourceUrl.hostname ||
      parsedSourceUrl.username ||
      parsedSourceUrl.password
    ) {
      fail('sourceUrl must use HTTPS and cannot contain embedded credentials.');
    }
    sourceUrl = parsedSourceUrl.href;
  }
  let authors;
  if (value.authors === undefined) {
    authors = value.author?.trim() ? [value.author.trim()] : [];
  } else {
    if (
      !Array.isArray(value.authors) ||
      value.authors.length < 1 ||
      value.authors.length > 20 ||
      value.authors.some(
        (author) =>
          typeof author !== 'string' ||
          !author.trim() ||
          author !== author.trim() ||
          /[\r\n]/.test(author) ||
          author.length > 200
      )
    ) {
      fail('authors must be a list of 1 to 20 nonblank names, each at most 200 characters.');
    }
    authors = value.authors.map((author) => author.trim());
    if (new Set(authors).size !== authors.length) {
      fail('authors must not contain duplicate names.');
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
  const commandIds = new Set(
    Array.isArray(commands) ? commands.map((command) => command?.id) : []
  );
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
      if (kind === 'webviews') {
        return { id: item.id, title: item.title.trim() };
      }
      const placement = item.placement ?? 'right-panel';
      const persistVisibility = item.persistVisibility ?? false;
      const when = item.when;
      if (!['right-panel', 'sidebar-bottom', 'editor-side'].includes(placement)) {
        fail(`panel ${item.id} has an invalid placement.`);
      }
      if (typeof persistVisibility !== 'boolean') {
        fail(`panel ${item.id} persistVisibility must be boolean.`);
      }
      let normalizedWhen = null;
      if (when !== undefined) {
        if (!when || typeof when !== 'object' || Array.isArray(when)) {
          fail(`panel ${item.id} when must be an object.`);
        }
        if (Object.keys(when).some((key) => !['extensions', 'mode'].includes(key))) {
          fail(`panel ${item.id} when has an unsupported condition.`);
        }
        const extensions = when.extensions ?? [];
        const mode = when.mode;
        if (
          !Array.isArray(extensions) ||
          extensions.length > 8 ||
          extensions.some((ext) => typeof ext !== 'string' || !/^\.(md|flow|canvas|json)$/.test(ext)) ||
          new Set(extensions).size !== extensions.length ||
          (mode !== undefined && !['read', 'edit', 'visual'].includes(mode)) ||
          (!extensions.length && mode === undefined)
        ) {
          fail(`panel ${item.id} has an invalid when condition.`);
        }
        normalizedWhen = { ...(extensions.length ? { extensions } : {}), ...(mode ? { mode } : {}) };
      }
      return {
        id: item.id,
        title: item.title.trim(),
        placement,
        persistVisibility,
        when: normalizedWhen,
      };
    });
    if (declarations.length && (!permissions.includes('ui') || !value.main)) {
      fail(`${kind} require ui permission and a main script.`);
    }
  }
  if (settings.length && !permissions.includes('settings')) {
    fail('contributes.settings requires the settings permission.');
  }
  if (settings.some(({ type }) => type === 'secret') && !permissions.includes('secrets')) {
    fail('secret settings require the secrets permission.');
  }
  if (settings.some(({ type }) => type === 'path') && !permissions.includes('vault:read')) {
    fail('path settings require the vault:read permission.');
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
  const statusBarItems = contributes.statusBarItems ?? [];
  if (!Array.isArray(statusBarItems) || statusBarItems.length > 20) {
    fail('contributes.statusBarItems must be a list of at most 20.');
  }
  const statusIds = new Set();
  for (const item of statusBarItems) {
    if (
      !item || typeof item.id !== 'string' || !ID.test(item.id) || statusIds.has(item.id) ||
      typeof item.title !== 'string' || !item.title.trim() || item.title.length > 80 ||
      typeof item.icon !== 'string' || !/^[a-z-]{1,40}$/.test(item.icon) ||
      !commandIds.has(item.command)
    ) {
      fail('each statusBarItems contribution needs a unique id, title, icon and declared command.');
    }
    statusIds.add(item.id);
  }
  const contextMenus = contributes.contextMenus ?? [];
  const menuContexts = ['editor', 'file-explorer', 'tab', 'canvas', 'flow'];
  if (!Array.isArray(contextMenus) || contextMenus.length > 50) {
    fail('contributes.contextMenus must be a list of at most 50.');
  }
  const menuIds = new Set();
  for (const item of contextMenus) {
    if (
      !item || typeof item.id !== 'string' || !ID.test(item.id) || menuIds.has(item.id) ||
      typeof item.title !== 'string' || !item.title.trim() || item.title.length > 80 ||
      !menuContexts.includes(item.context) || !commandIds.has(item.command)
    ) {
      fail('each context menu contribution needs a unique id, title, context and declared command.');
    }
    menuIds.add(item.id);
  }
  const fileHandlers = contributes.fileHandlers ?? [];
  if (!Array.isArray(fileHandlers) || fileHandlers.length > 20) {
    fail('contributes.fileHandlers must be a list of at most 20.');
  }
  const handlerIds = new Set();
  const supportedHandlerExtensions = ['.md', '.flow', '.canvas'];
  for (const item of fileHandlers) {
    if (
      !item || typeof item.id !== 'string' || !ID.test(item.id) || handlerIds.has(item.id) ||
      typeof item.title !== 'string' || !item.title.trim() || item.title.length > 80 ||
      !Array.isArray(item.extensions) || !item.extensions.length || item.extensions.length > 3 ||
      item.extensions.some((ext) => !supportedHandlerExtensions.includes(ext)) ||
      new Set(item.extensions).size !== item.extensions.length ||
      !commandIds.has(item.command) ||
      (item.priority !== undefined && (!Number.isInteger(item.priority) || item.priority < 0 || item.priority > 100))
    ) {
      fail('each file handler needs a unique id, title, supported extensions and declared command.');
    }
    handlerIds.add(item.id);
  }
  if ((statusBarItems.length || contextMenus.length || fileHandlers.length) && !permissions.includes('ui')) {
    fail('status bar items, context menus and file handlers require ui permission.');
  }
  if (value.main !== undefined) {
    relativeFile(root, value.main, '.js');
  }
  themes.forEach((theme) => relativeFile(root, theme, '.json'));
  const rawGroups = contributes.themeGroups ?? [];
  if (!Array.isArray(rawGroups) || rawGroups.length > limits.extensionThemeGroups) {
    fail(`contributes.themeGroups must be a list of at most ${limits.extensionThemeGroups}.`);
  }
  const groupIds = new Set();
  const themeGroups = rawGroups.map((group) => {
    if (
      !group ||
      typeof group.id !== 'string' ||
      !ID.test(group.id) ||
      groupIds.has(group.id) ||
      typeof group.title !== 'string' ||
      !group.title.trim() ||
      group.title.length > 80
    ) {
      fail('each theme group needs a unique id and a title of up to 80 characters.');
    }
    groupIds.add(group.id);
    relativeFile(root, group.light, '.json');
    relativeFile(root, group.dark, '.json');
    return { id: group.id, title: group.title.trim(), light: group.light, dark: group.dark };
  });
  return {
    manifestVersion: 1,
    id: value.id,
    name: value.name.trim(),
    version: value.version.trim(),
    description: value.description || '',
    author: value.author || '',
    authors,
    sourceUrl,
    main: value.main || null,
    permissions: [...new Set(permissions)],
    networkHosts,
    contributes: {
      commands: commands.map(({ id, title, key }) => ({ id, title: title.trim(), key: key || '' })),
      themes,
      themeGroups,
      settings,
      ribbonItems: ribbonItems.map(({ id, title, icon, command }) => ({
        id,
        title: title.trim(),
        icon,
        command,
      })),
      statusBarItems: statusBarItems.map(({ id, title, icon, command }) => ({
        id,
        title: title.trim(),
        icon,
        command,
      })),
      contextMenus: contextMenus.map(({ id, title, context, command }) => ({
        id,
        title: title.trim(),
        context,
        command,
      })),
      fileHandlers: fileHandlers.map(({ id, title, extensions, command, priority = 0 }) => ({
        id,
        title: title.trim(),
        extensions,
        command,
        priority,
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
    ...(manifest.contributes.statusBarItems.length
      ? { statusBarItems: manifest.contributes.statusBarItems }
      : {}),
    ...(manifest.contributes.contextMenus.length
      ? { contextMenus: manifest.contributes.contextMenus }
      : {}),
    ...(manifest.contributes.fileHandlers.length
      ? { fileHandlers: manifest.contributes.fileHandlers }
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
  // no review-gated capability; settings, editor:active-note, events, ui, network and api
  // always require an explicit, matching review before they are enabled.
  return manifest.permissions.some((permission) => REVIEW_PERMISSIONS.includes(permission));
}

module.exports = {
  validateManifest,
  relativeFile,
  reviewSignature,
  needsReview,
  PERMISSIONS,
  ID,
  REVIEW_PERMISSIONS,
};
