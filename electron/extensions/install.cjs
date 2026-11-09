const fs = require('node:fs/promises');
const path = require('node:path');
const { createExtensionRegistry } = require('../extensionRegistry.cjs');
const {
  validateManifest,
  reviewSignature,
  needsReview,
  REVIEW_PERMISSIONS,
} = require('./manifest.cjs');
const {
  findManifestRoot,
  containedFile,
  copyExtension,
  MAX_INSTALL_FILES,
  MAX_INSTALL_BYTES,
} = require('./files.cjs');

function registerInstallHandlers(context) {
  const {
    app,
    ipcMain,
    shell,
    readConfig,
    writeConfig,
    dialog,
    getWindow,
    limits,
    folder,
    enabledIds,
    scan,
  } = context;
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
      await copyExtension(app, root, target);
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

  const registry = createExtensionRegistry({
    stagingRoot: () => path.join(app.getPath('userData'), 'extension-downloads'),
    validateManifest,
    limits,
    installFromFolder,
    maxFiles: MAX_INSTALL_FILES,
    maxBytes: MAX_INSTALL_BYTES,
  });
  ipcMain.handle('extensions:registryList', (_event, refresh) => registry.list(refresh === true));
  ipcMain.handle('extensions:registryInstall', (_event, url, id) => registry.install(url, id));

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

module.exports = { registerInstallHandlers };
