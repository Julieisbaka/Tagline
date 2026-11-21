const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
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
    handleExtension,
    shell,
    readConfig,
    writeConfig,
    dialog,
    getWindow,
    limits,
    folder,
    invalidateManifest,
    enabledIds,
    scan,
    resetExtensionState,
    secretsDir,
    storageDir,
    serialize,
    serializeStorage,
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
      limits(),
      { appVersion: app.getVersion?.() || '' }
    );
    if (manifest.main) {
      await containedFile(root, manifest.main, '.js');
    }
    for (const theme of manifest.contributes.themes) {
      await containedFile(root, theme, '.json');
    }
    const installed = await scan();
    const existing = installed.find((item) => item.id === manifest.id);
    if (existing) {
      const options = {
        type: 'warning',
        title: 'Replace installed extension?',
        message: `Replacing ${manifest.name} will disable it, revoke its permissions, and delete its saved data. You must grant permissions again before it can access them.`,
        buttons: ['Cancel', 'Replace'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      };
      const window = getWindow();
      const confirmation = window
        ? await dialog.showMessageBox(window, options)
        : await dialog.showMessageBox(options);
      if (confirmation.response !== 1) {
        throw new Error('Extension replacement was canceled.');
      }
    }
    const taken = new Set(installed.map((item) => item.folder));
    let name = manifest.id;
    for (let i = 2; !existing && taken.has(name); i++) {
      name = `${manifest.id}-${i}`;
    }
    const target = existing ? existing.root : path.join(folder(), name);
    const inPlace = (await fs.realpath(root).catch(() => root)) === (await realpathOrSelf(target));
    if (existing) {
      const staging = path.join(app.getPath('userData'), 'extension-staging', randomUUID());
      const targetBackup = `${staging}.previous`;
      try {
        await copyExtension(app, root, staging);
        const stagedManifest = validateManifest(
          JSON.parse(await fs.readFile(path.join(staging, 'manifest.json'), 'utf8')),
          staging,
          limits(),
          { appVersion: app.getVersion?.() || '' }
        );
        if (stagedManifest.id !== manifest.id) {
          throw new Error('The extension changed while it was being installed.');
        }
        await serialize(manifest.id, () =>
          serializeStorage(manifest.id, async () => {
            const config = readConfig();
            const fields = [
              'enabledExtensions',
              'extensionReviews',
              'extensionPermissions',
              'initializedExtensions',
              'engineCompatibilityOverrides',
            ];
            const previousConfig = Object.fromEntries(
              fields.map((field) => [field, config[field]])
            );
            const extensionReviews = { ...config.extensionReviews };
            const extensionPermissions = { ...config.extensionPermissions, [manifest.id]: [] };
            delete extensionReviews[manifest.id];
            const configUpdate = {
              enabledExtensions: enabledIds().filter((id) => id !== manifest.id),
              extensionReviews,
              extensionPermissions,
              initializedExtensions: (Array.isArray(config.initializedExtensions)
                ? config.initializedExtensions
                : []
              ).filter((id) => id !== manifest.id),
              engineCompatibilityOverrides: (Array.isArray(config.engineCompatibilityOverrides)
                ? config.engineCompatibilityOverrides
                : []
              ).filter((id) => id !== manifest.id),
            };
            const secretFile = path.join(secretsDir(), `${manifest.id}.bin`);
            const storageFile = path.join(storageDir(), `${manifest.id}.bin`);
            const secretBackup = `${secretFile}.${randomUUID()}.replacement-backup`;
            const storageBackup = `${storageFile}.${randomUUID()}.replacement-backup`;
            let hadSecret = false;
            let hadStorage = false;
            let hadTarget = false;
            let installedReplacement = false;
            let configChanged = false;
            try {
              await fs.rename(secretFile, secretBackup).then(
                () => {
                  hadSecret = true;
                },
                (error) => {
                  if (error.code !== 'ENOENT') {
                    throw error;
                  }
                }
              );
              await fs.rename(storageFile, storageBackup).then(
                () => {
                  hadStorage = true;
                },
                (error) => {
                  if (error.code !== 'ENOENT') {
                    throw error;
                  }
                }
              );
              configChanged = true;
              await writeConfig(configUpdate);
              resetExtensionState(manifest.id);
              await fs.rename(target, targetBackup);
              hadTarget = true;
              await fs.rename(staging, target);
              installedReplacement = true;
              invalidateManifest(target);
            } catch (error) {
              const rollbackErrors = [];
              const rollback = async (task) => {
                try {
                  await task();
                } catch (rollbackError) {
                  rollbackErrors.push(rollbackError);
                }
              };
              if (installedReplacement) {
                await rollback(() => fs.rm(target, { recursive: true, force: true }));
              }
              if (hadTarget) {
                await rollback(() => fs.rename(targetBackup, target));
              }
              if (configChanged) {
                await rollback(() => writeConfig(previousConfig));
              }
              if (hadStorage) {
                await rollback(() => fs.rename(storageBackup, storageFile));
              }
              if (hadSecret) {
                await rollback(() => fs.rename(secretBackup, secretFile));
              }
              invalidateManifest(target);
              if (rollbackErrors.length) {
                throw new AggregateError(
                  [error, ...rollbackErrors],
                  'Extension replacement failed and could not be fully rolled back.'
                );
              }
              throw error;
            }
            await Promise.all([
              hadTarget ? fs.rm(targetBackup, { recursive: true, force: true }) : undefined,
              hadSecret ? fs.rm(secretBackup, { force: true }) : undefined,
              hadStorage ? fs.rm(storageBackup, { force: true }) : undefined,
            ]);
          })
        );
      } finally {
        await fs.rm(staging, { recursive: true, force: true });
      }
    } else if (!inPlace) {
      await copyExtension(app, root, target);
    }
    invalidateManifest(target);
    const gated = manifest.permissions.some((permission) =>
      REVIEW_PERMISSIONS.includes(permission)
    );
    const wasEnabled = !existing && enabledIds().includes(manifest.id);
    let enabled = wasEnabled;
    if (!existing && !gated && !wasEnabled) {
      await writeConfig({
        enabledExtensions: [...enabledIds(), manifest.id],
        extensionReviews: {
          ...readConfig().extensionReviews,
          [manifest.id]: reviewSignature(manifest),
        },
      });
      enabled = true;
    } else if (!existing && !gated) {
      await writeConfig({
        extensionReviews: {
          ...readConfig().extensionReviews,
          [manifest.id]: reviewSignature(manifest),
        },
      });
    }
    const reviewRequired =
      !!existing || (gated && (!wasEnabled || needsReview(manifest, readConfig())));
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
  handleExtension('extensions:registryList', (refresh) => registry.list(refresh === true));
  handleExtension('extensions:registryInstall', (url, id) => registry.install(url, id));

  handleExtension('extensions:installFolder', (source) => installFromFolder(source));
  handleExtension('extensions:chooseAndInstall', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Install extension from folder',
      properties: ['openDirectory'],
    });
    return result.canceled || !result.filePaths[0] ? null : installFromFolder(result.filePaths[0]);
  });

  handleExtension('extensions:openFolder', async () => {
    await fs.mkdir(folder(), { recursive: true });
    const error = await shell.openPath(folder());
    if (error) {
      throw new Error(error);
    }
  });
}

module.exports = { registerInstallHandlers };
