const { cleanupMigrationArtifacts } = require('../vaultMigrations.cjs');
const { parsePins, serializePins, staleCorruptBackups } = require('../pinsFile.cjs');

const PINS_PATH = '.tagline/pins.json';

function registerVaultIpc(
  {
    app,
    ipcMain,
    dialog,
    shell,
    path,
    fs,
    fssync,
    randomUUID,
    SAMPLE_VAULT,
    DEFAULT_RETENTION,
    NOTE_EXTS,
    walk,
    readVaultSnapshot,
    registerMcp,
    readConfig,
    writeConfig,
    consumeConfigRecovery,
    resolveInVault,
    openVault,
    listRecentVaults,
    validateRecentVault,
    uniquePath,
    toPosix,
    assertMainFrameSender,
    process,
  },
  state,
  history
) {
  ipcMain.handle('vault:getLast', async (event) => {
    assertMainFrameSender(event, 'Vault access');
    const { lastVault } = readConfig();
    if (lastVault && (await validateRecentVault(lastVault))) {
      return openVault(lastVault);
    }
    return null;
  });

  ipcMain.handle('vault:listRecent', (event) => {
    assertMainFrameSender(event, 'Vault access');
    return listRecentVaults();
  });
  ipcMain.handle('config:getRecovery', (event) => {
    assertMainFrameSender(event, 'Configuration access');
    return consumeConfigRecovery();
  });

  let pinsQueue = Promise.resolve();
  async function readPinsFile(full) {
    let raw;
    try {
      raw = await fs.readFile(full, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
    const pins = parsePins(raw);
    if (pins) {
      return pins;
    }
    const corrupt = `${full}.corrupt-${Date.now()}-${randomUUID()}`;
    try {
      await fs.rename(full, corrupt);
      console.warn('[pins] moved invalid pins file to', corrupt);
      const directory = path.dirname(full);
      const stale = staleCorruptBackups(await fs.readdir(directory)).map((name) =>
        path.join(directory, name)
      );
      await Promise.all(stale.map((name) => fs.rm(name, { force: true })));
    } catch (error) {
      console.warn('[pins] failed to move invalid pins file', error.message);
    }
    // Tell the renderer the file was invalid so it can say why pins did not restore.
    return { favorites: [], pinnedTabs: [], corrupted: true };
  }

  function readPins() {
    const full = resolveInVault(PINS_PATH);
    const task = pinsQueue.catch(() => {}).then(() => readPinsFile(full));
    pinsQueue = task;
    return task;
  }

  function writePinsAtomic(value) {
    const serialized = serializePins(value);
    const full = resolveInVault(PINS_PATH);
    const task = pinsQueue
      .catch(() => {})
      .then(async () => {
        const directory = path.dirname(full);
        const temporary = path.join(directory, `.tagline-pins-${randomUUID()}.tmp`);
        const retryable = (error) => error && (error.code === 'EBUSY' || error.code === 'EPERM');
        await fs.mkdir(directory, { recursive: true });
        try {
          await fs.writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx' });
          const handle = await fs.open(temporary, 'r+');
          try {
            await handle.sync();
          } finally {
            await handle.close();
          }
          // Retry rename on EBUSY/EPERM (Windows file-lock hazard), up to 5 attempts
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              await fs.rename(temporary, full);
              break;
            } catch (error) {
              if (!retryable(error) || attempt === 4) {
                throw error;
              }
              await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
            }
          }
        } catch (error) {
          try {
            await fs.rm(temporary, { force: true });
          } catch {}
          throw error;
        }
        try {
          const directoryHandle = await fs.open(directory, 'r');
          try {
            await directoryHandle.sync();
          } finally {
            await directoryHandle.close();
          }
        } catch {}
        return true;
      });
    pinsQueue = task;
    return task;
  }

  ipcMain.handle('vault:readPins', (event) => {
    assertMainFrameSender(event, 'Pinned items');
    return readPins();
  });
  ipcMain.handle('vault:writePins', (event, value) => {
    assertMainFrameSender(event, 'Pinned items');
    return writePinsAtomic(value);
  });
  ipcMain.handle('vault:openRecent', async (event, root) => {
    assertMainFrameSender(event, 'Vault access');
    if (typeof root !== 'string' || !path.isAbsolute(root)) {
      throw new Error('Invalid saved vault path.');
    }
    const resolvedRoot = path.resolve(root);
    if (!(await validateRecentVault(resolvedRoot))) {
      throw new Error('That saved vault is unavailable. Choose its folder to add it again.');
    }
    return openVault(resolvedRoot);
  });
  ipcMain.handle('vault:forgetRecent', async (event, root) => {
    assertMainFrameSender(event, 'Vault access');
    if (typeof root !== 'string' || !path.isAbsolute(root)) {
      throw new Error('Invalid saved vault path.');
    }
    const key = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
    const config = readConfig();
    const recent = config.recentVaults;
    const recentVaults = (Array.isArray(recent) ? recent : []).filter(
      (item) => typeof item === 'string' && key(path.resolve(item)) !== key(path.resolve(root))
    );
    const lastVault =
      typeof config.lastVault === 'string' &&
      key(path.resolve(config.lastVault)) === key(path.resolve(root))
        ? null
        : config.lastVault;
    await writeConfig({ recentVaults, lastVault });
    return true;
  });
  ipcMain.handle('vault:revealRecent', async (event, root) => {
    assertMainFrameSender(event, 'Vault access');
    if (typeof root !== 'string' || !path.isAbsolute(root)) {
      throw new Error('Invalid saved vault path.');
    }
    const resolvedRoot = path.resolve(root);
    if (!(await validateRecentVault(resolvedRoot))) {
      throw new Error('That saved vault is unavailable.');
    }
    const error = await shell.openPath(resolvedRoot);
    if (error) {
      throw new Error(error);
    }
  });
  ipcMain.handle('vault:cleanupMigrationBackups', async (event, root) => {
    assertMainFrameSender(event, 'Vault access');
    if (typeof root !== 'string' || !path.isAbsolute(root)) {
      throw new Error('Invalid saved vault path.');
    }
    const resolvedRoot = path.resolve(root);
    if (!(await validateRecentVault(resolvedRoot))) {
      throw new Error('That saved vault is unavailable.');
    }
    return cleanupMigrationArtifacts(resolvedRoot);
  });

  // TODO: Coordinate with external programs editing vault files to prevent races and lost updates.
  let vaultMutationQueue = Promise.resolve();
  function serializeVaultMutation(task) {
    const run = vaultMutationQueue.catch(() => {}).then(task);
    vaultMutationQueue = run;
    return run;
  }

  ipcMain.handle('vault:choose', async (event) => {
    assertMainFrameSender(event, 'Vault access');
    const res = await dialog.showOpenDialog(state.win, {
      title: 'Open or create a vault folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) {
      return null;
    }
    return openVault(res.filePaths[0]);
  });

  ipcMain.handle('vault:createSample', async (event) => {
    assertMainFrameSender(event, 'Vault access');
    const res = await dialog.showOpenDialog(state.win, {
      title: 'Choose a folder for the sample vault',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) {
      return null;
    }
    return serializeVaultMutation(async () => {
      const info = await openVault(path.join(res.filePaths[0], 'Tagline Sample Vault'));
      if (!info) {
        return null;
      }
      if (state.vaultRoot !== info.root) {
        throw new Error('The vault changed before the sample could be created.');
      }
      for (const [rel, content] of Object.entries(SAMPLE_VAULT)) {
        const full = resolveInVault(rel, info.root);
        await fs.mkdir(path.dirname(full), { recursive: true });
        try {
          await fs.writeFile(full, content, { encoding: 'utf8', flag: 'wx' });
        } catch (error) {
          if (error.code !== 'EEXIST') {
            throw error;
          }
        }
      }
      return info;
    });
  });

  ipcMain.handle('fs:list', async (event) => {
    assertMainFrameSender(event, 'Vault file access');
    return walk(resolveInVault(''));
  });
  ipcMain.handle('fs:snapshot', async (event) => {
    assertMainFrameSender(event, 'Vault file access');
    return readVaultSnapshot(resolveInVault(''));
  });
  ipcMain.handle('fs:readAll', async (event) => {
    assertMainFrameSender(event, 'Vault file access');
    return (await readVaultSnapshot(resolveInVault(''))).contents;
  });

  ipcMain.handle('fs:read', async (event, rel) => {
    assertMainFrameSender(event, 'Vault file access');
    return fs.readFile(resolveInVault(rel), 'utf8');
  });

  function writeVaultFile(
    rel,
    content,
    retention = DEFAULT_RETENTION,
    canvasMode = 'complete',
    vaultRoot = state.vaultRoot
  ) {
    const full = resolveInVault(rel, vaultRoot);
    return serializeVaultMutation(async () => {
      if (state.vaultRoot !== vaultRoot) {
        throw new Error('The vault changed before the file could be saved.');
      }
      let result = true;
      if (typeof content === 'function') {
        const prepared = await content(full);
        if (state.vaultRoot !== vaultRoot) {
          throw new Error('The vault changed before the file could be saved.');
        }
        content = prepared.content;
        result = prepared.result;
      }
      await history.snapshot(rel, content, retention, canvasMode, vaultRoot);
      await fs.mkdir(path.dirname(full), { recursive: true });
      let mode;
      try {
        mode = (await fs.stat(full)).mode;
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
      const temporary = path.join(path.dirname(full), `.tagline-save-${randomUUID()}.tmp`);
      const retryable = (error) => error && (error.code === 'EBUSY' || error.code === 'EPERM');
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode });
          let handle;
          try {
            handle = await fs.open(temporary, 'r+');
            await handle.sync();
          } finally {
            if (handle) {
              await handle.close();
            }
          }
          await fs.rename(temporary, full);
          break;
        } catch (error) {
          if (error.code !== 'EEXIST') {
            await fs.rm(temporary, { force: true }).catch(() => {});
          }
          if (retryable(error) && attempt < 4) {
            await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
            continue;
          }
          throw error;
        }
      }
      return result;
    });
  }
  ipcMain.handle('fs:write', (event, rel, content, retention, canvasMode) => {
    assertMainFrameSender(event, 'Vault file access');
    if (typeof content !== 'string') {
      throw new Error('Invalid file content.');
    }
    return writeVaultFile(rel, content, retention, canvasMode);
  });

  ipcMain.handle('fs:create', async (event, rel, content = '') => {
    assertMainFrameSender(event, 'Vault file access');
    if (typeof content !== 'string') {
      throw new Error('Invalid file content.');
    }
    const vaultRoot = state.vaultRoot;
    return serializeVaultMutation(async () => {
      if (state.vaultRoot !== vaultRoot) {
        throw new Error('The vault changed before the file could be created.');
      }
      await fs.mkdir(path.dirname(resolveInVault(rel, vaultRoot)), { recursive: true });
      for (let attempt = 0; attempt < 10; attempt++) {
        const finalRel = uniquePath(rel, false, false, vaultRoot);
        try {
          await fs.writeFile(resolveInVault(finalRel, vaultRoot), content, {
            encoding: 'utf8',
            flag: 'wx',
          });
          return toPosix(finalRel);
        } catch (error) {
          if (error.code !== 'EEXIST') {
            throw error;
          }
          if (attempt === 9) {
            throw new Error('Could not create a unique file after 10 attempts.', { cause: error });
          }
        }
      }
      throw new Error('Could not create a unique file after 10 attempts.');
    });
  });

  ipcMain.handle('fs:mkdir', async (event, rel, underscoreFolders) => {
    assertMainFrameSender(event, 'Vault file access');
    if (typeof underscoreFolders !== 'boolean') {
      throw new Error('Invalid folder path preference.');
    }
    const vaultRoot = state.vaultRoot;
    return serializeVaultMutation(async () => {
      if (state.vaultRoot !== vaultRoot) {
        throw new Error('The vault changed before the folder could be created.');
      }
      await fs.mkdir(path.dirname(resolveInVault(rel, vaultRoot)), { recursive: true });
      for (let attempt = 0; attempt < 10; attempt++) {
        const finalRel = uniquePath(rel, true, underscoreFolders, vaultRoot);
        try {
          await fs.mkdir(resolveInVault(finalRel, vaultRoot));
          return toPosix(finalRel);
        } catch (error) {
          if (error.code !== 'EEXIST') {
            throw error;
          }
          if (attempt === 9) {
            throw new Error('Could not create a unique folder after 10 attempts.', {
              cause: error,
            });
          }
        }
      }
      throw new Error('Could not create a unique folder after 10 attempts.');
    });
  });

  async function renameVaultPathUnchecked(from, to, vaultRoot) {
    const dest = resolveInVault(to, vaultRoot);
    const source = resolveInVault(from, vaultRoot);
    // Same path, different case: collides on case-insensitive filesystems,
    // so rename through a temporary name instead.
    const caseOnly = from !== to && from.toLowerCase() === to.toLowerCase();
    if (fssync.existsSync(dest) && !caseOnly) {
      return { ok: false, code: 'destination-exists' };
    }
    const stat = await fs.stat(source);
    let documents = [];
    if (stat.isDirectory()) {
      const collect = (nodes, base) => {
        for (const node of nodes) {
          const relative = `${base}/${node.path}`;
          if (node.type === 'folder') {
            collect(node.children, base);
          } else {
            documents.push(relative);
          }
        }
      };
      collect(await walk(source), from);
    } else if (NOTE_EXTS.includes(path.extname(from).toLowerCase())) {
      documents = [from];
    }
    await fs.mkdir(path.dirname(dest), { recursive: true });
    // Vaults normally live on one mount, but a vault can contain mount points
    // (external drives, network shares). fs.rename fails with EXDEV across
    // devices, so fall back to copy+delete to keep the move working.
    const movePath = async (src, dst) => {
      try {
        await fs.rename(src, dst);
        return;
      } catch (error) {
        if (error.code !== 'EXDEV') {
          throw error;
        }
      }
      // Cross-device (or rename-unsupported): copy then delete. Every failure
      // path removes any partial or complete copy so history can be rolled
      // back to the exact pre-move state; history and the filesystem never
      // diverge.
      try {
        await fs.cp(src, dst, {
          recursive: true,
          errorOnExist: true,
          force: false,
          preserveTimestamps: true,
          verbatimSymlinks: true,
        });
      } catch (error) {
        await fs.rm(dst, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
      try {
        await fs.rm(src, { recursive: true, force: true });
      } catch (error) {
        // Source remains after a successful copy. Undo the copy rather than
        // leaving both copies with history pointing only at the new path.
        await fs.rm(dst, { recursive: true, force: true }).catch(() => {});
        error.message = `Copied to "${dst}" but could not remove "${src}": ${error.message}`;
        throw error;
      }
    };
    const migrated = [];
    const rollbackHistory = async () => {
      for (const [oldPath, newPath] of [...migrated].reverse()) {
        await history.rename(newPath, oldPath, vaultRoot);
      }
    };
    try {
      for (const oldPath of documents) {
        const newPath = `${to}${oldPath.slice(from.length)}`;
        await history.rename(oldPath, newPath, vaultRoot);
        migrated.push([oldPath, newPath]);
      }
      if (caseOnly) {
        const temp = path.join(path.dirname(source), `.tagline-rename-${randomUUID()}`);
        await fs.rename(source, temp);
        try {
          await movePath(temp, dest);
        } catch (error) {
          try {
            await fs.rename(temp, source);
          } catch {}
          throw error;
        }
      } else {
        await movePath(source, dest);
      }
    } catch (error) {
      await rollbackHistory();
      throw error;
    }
    return { ok: true, path: toPosix(to) };
  }
  function renameVaultPath(from, to, vaultRoot = state.vaultRoot) {
    resolveInVault(from, vaultRoot);
    resolveInVault(to, vaultRoot);
    return serializeVaultMutation(() => {
      if (state.vaultRoot !== vaultRoot) {
        throw new Error('The vault changed before the item could be renamed.');
      }
      return renameVaultPathUnchecked(from, to, vaultRoot);
    });
  }
  ipcMain.handle('fs:rename', (event, from, to) => {
    assertMainFrameSender(event, 'Vault file access');
    return renameVaultPath(from, to);
  });

  state.mcp = registerMcp({
    app,
    ipcMain,
    getWindow: () => state.win,
    getVaultRoot: () => state.vaultRoot,
    resolveInVault,
    getLocalModels: () => state.localModels,
    readConfig,
    writeConfig,
    writeNote: (rel, content, vaultRoot) =>
      writeVaultFile(rel, content, DEFAULT_RETENTION, 'complete', vaultRoot),
    renamePath: renameVaultPath,
    trashItem: (full, vaultRoot) =>
      serializeVaultMutation(async () => {
        if (state.vaultRoot !== vaultRoot) {
          throw new Error('The vault changed before the item could be deleted.');
        }
        await shell.trashItem(full);
      }),
  });

  ipcMain.handle('fs:delete', async (event, rel) => {
    assertMainFrameSender(event, 'Vault file access');
    const full = resolveInVault(rel);
    const vaultRoot = state.vaultRoot;
    if (full === state.vaultRoot) {
      throw new Error('Refusing to delete vault root');
    }
    return serializeVaultMutation(async () => {
      if (state.vaultRoot !== vaultRoot) {
        throw new Error('The vault changed before the item could be deleted.');
      }
      try {
        await shell.trashItem(full);
      } catch (error) {
        if (error.code === 'ENOENT' || /ENOENT|not found/i.test(error.message || '')) {
          throw new Error(
            `Can't move "${rel}" to the trash because it no longer exists. Refresh the vault and try again.`
          );
        }
        throw error;
      }
      return true;
    });
  });

  ipcMain.handle('shell:reveal', async (event, rel) => {
    assertMainFrameSender(event, 'Revealing vault files');
    shell.showItemInFolder(resolveInVault(rel));
  });
  ipcMain.handle('history:list', (event, rel) => {
    assertMainFrameSender(event, 'Revision history');
    if (typeof rel !== 'string') {
      throw new Error('Invalid file path.');
    }
    return history.list(rel);
  });
  ipcMain.handle('history:read', (event, rel, id) => {
    assertMainFrameSender(event, 'Revision history');
    if (typeof rel !== 'string' || typeof id !== 'string') {
      throw new Error('Invalid file path.');
    }
    return history.read(rel, id);
  });
  ipcMain.handle('history:latest-working', (event, rel) => {
    assertMainFrameSender(event, 'Revision history');
    if (typeof rel !== 'string') {
      throw new Error('Invalid file path.');
    }
    return history.latestWorking(rel);
  });
}

module.exports = { registerVaultIpc };
