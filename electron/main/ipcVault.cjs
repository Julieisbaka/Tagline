const { cleanupMigrationArtifacts } = require('../vaultMigrations.cjs');

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
    resolveInVault,
    openVault,
    listRecentVaults,
    uniquePath,
    toPosix,
    assertModelSender,
    process,
  },
  state,
  history
) {
  ipcMain.handle('vault:getLast', async (event) => {
    assertModelSender(event, 'Vault access');
    const { lastVault } = readConfig();
    if (
      lastVault &&
      (fssync.existsSync(lastVault) || fssync.existsSync(`${lastVault}.tagline-migration.json`))
    ) {
      return openVault(lastVault);
    }
    return null;
  });

  ipcMain.handle('vault:listRecent', (event) => {
    assertModelSender(event, 'Vault access');
    return listRecentVaults();
  });
  ipcMain.handle('vault:openRecent', async (event, root) => {
    assertModelSender(event, 'Vault access');
    if (typeof root !== 'string' || !path.isAbsolute(root)) {
      throw new Error('Invalid saved vault path.');
    }
    const recent = await listRecentVaults();
    const key = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
    if (!recent?.some((item) => item.exists && key(item.root) === key(path.resolve(root)))) {
      throw new Error('That saved vault is unavailable. Choose its folder to add it again.');
    }
    return openVault(root);
  });
  ipcMain.handle('vault:forgetRecent', (event, root) => {
    assertModelSender(event, 'Vault access');
    if (typeof root !== 'string' || !path.isAbsolute(root)) {
      throw new Error('Invalid saved vault path.');
    }
    const key = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
    const recent = readConfig().recentVaults;
    const recentVaults = (Array.isArray(recent) ? recent : []).filter(
      (item) => typeof item === 'string' && key(path.resolve(item)) !== key(path.resolve(root))
    );
    const config = readConfig();
    const lastVault =
      typeof config.lastVault === 'string' &&
      key(path.resolve(config.lastVault)) === key(path.resolve(root))
        ? null
        : config.lastVault;
    writeConfig({ recentVaults, lastVault });
    return true;
  });
  ipcMain.handle('vault:revealRecent', async (event, root) => {
    assertModelSender(event, 'Vault access');
    if (typeof root !== 'string' || !path.isAbsolute(root)) {
      throw new Error('Invalid saved vault path.');
    }
    const recent = await listRecentVaults();
    const key = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
    if (!recent?.some((item) => item.exists && key(item.root) === key(path.resolve(root)))) {
      throw new Error('That saved vault is unavailable.');
    }
    const error = await shell.openPath(root);
    if (error) {
      throw new Error(error);
    }
  });
  ipcMain.handle('vault:cleanupMigrationBackups', async (event, root) => {
    assertModelSender(event, 'Vault access');
    if (typeof root !== 'string' || !path.isAbsolute(root)) {
      throw new Error('Invalid saved vault path.');
    }
    return cleanupMigrationArtifacts(root);
  });

  ipcMain.handle('vault:choose', async (event) => {
    assertModelSender(event, 'Vault access');
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
    assertModelSender(event, 'Vault access');
    const res = await dialog.showOpenDialog(state.win, {
      title: 'Choose a folder for the sample vault',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) {
      return null;
    }
    const info = await openVault(path.join(res.filePaths[0], 'Tagline Sample Vault'));
    if (!info) {
      return null;
    }
    for (const [rel, content] of Object.entries(SAMPLE_VAULT)) {
      const full = resolveInVault(rel);
      await fs.mkdir(path.dirname(full), { recursive: true });
      if (!fssync.existsSync(full)) {
        await fs.writeFile(full, content, 'utf8');
      }
    }
    return info;
  });

  ipcMain.handle('fs:list', async (event) => {
    assertModelSender(event, 'Vault file access');
    return walk(resolveInVault(''));
  });
  ipcMain.handle('fs:snapshot', async (event) => {
    assertModelSender(event, 'Vault file access');
    return readVaultSnapshot(resolveInVault(''));
  });
  ipcMain.handle('fs:readAll', async (event) => {
    assertModelSender(event, 'Vault file access');
    return (await readVaultSnapshot(resolveInVault(''))).contents;
  });

  ipcMain.handle('fs:read', async (event, rel) => {
    assertModelSender(event, 'Vault file access');
    return fs.readFile(resolveInVault(rel), 'utf8');
  });

  async function writeVaultFile(
    rel,
    content,
    retention = DEFAULT_RETENTION,
    canvasMode = 'complete',
    experimentalHistoryDeltas = false
  ) {
    const full = resolveInVault(rel);
    await history.snapshot(rel, content, retention, canvasMode, experimentalHistoryDeltas);
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
    try {
      await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode });
      await fs.rename(temporary, full);
    } catch (error) {
      if (error.code !== 'EEXIST') {
        await fs.rm(temporary, { force: true });
      }
      throw error;
    }
    return true;
  }
  ipcMain.handle(
    'fs:write',
    (event, rel, content, retention, canvasMode, experimentalHistoryDeltas) => {
      assertModelSender(event, 'Vault file access');
      if (typeof content !== 'string') {
        throw new Error('Invalid file content.');
      }
      return writeVaultFile(rel, content, retention, canvasMode, experimentalHistoryDeltas);
    }
  );

  ipcMain.handle('fs:create', async (event, rel, content = '') => {
    assertModelSender(event, 'Vault file access');
    if (typeof content !== 'string') {
      throw new Error('Invalid file content.');
    }
    await fs.mkdir(path.dirname(resolveInVault(rel)), { recursive: true });
    while (true) {
      const finalRel = uniquePath(rel);
      try {
        await fs.writeFile(resolveInVault(finalRel), content, { encoding: 'utf8', flag: 'wx' });
        return toPosix(finalRel);
      } catch (error) {
        if (error.code !== 'EEXIST') {
          throw error;
        }
      }
    }
  });

  ipcMain.handle('fs:mkdir', async (event, rel, underscoreFolders) => {
    assertModelSender(event, 'Vault file access');
    if (typeof underscoreFolders !== 'boolean') {
      throw new Error('Invalid folder path preference.');
    }
    await fs.mkdir(path.dirname(resolveInVault(rel)), { recursive: true });
    while (true) {
      const finalRel = uniquePath(rel, true, underscoreFolders);
      try {
        await fs.mkdir(resolveInVault(finalRel));
        return toPosix(finalRel);
      } catch (error) {
        if (error.code !== 'EEXIST') {
          throw error;
        }
      }
    }
  });

  async function renameVaultPath(from, to) {
    const dest = resolveInVault(to);
    const source = resolveInVault(from);
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
      try {
        await fs.cp(src, dst, {
          recursive: true,
          errorOnExist: true,
          force: false,
          preserveTimestamps: true,
          verbatimSymlinks: true,
        });
      } catch (error) {
        if (error.code !== 'EEXIST') {
          await fs.rm(dst, { recursive: true, force: true }).catch(() => {});
        }
        throw error;
      }
      try {
        await fs.rm(src, { recursive: true, force: true });
      } catch (error) {
        // Copy is complete; keep it rather than risk losing data, and skip the
        // history rollback so revision history stays aligned with the copy.
        error.revisionHistoryKept = true;
        error.message = `Copied to "${dst}" but could not remove "${src}": ${error.message}`;
        throw error;
      }
    };
    const migrated = [];
    const rollbackHistory = async () => {
      for (const [oldPath, newPath] of [...migrated].reverse()) {
        await history.rename(newPath, oldPath);
      }
    };
    try {
      for (const oldPath of documents) {
        const newPath = `${to}${oldPath.slice(from.length)}`;
        await history.rename(oldPath, newPath);
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
      if (!error.revisionHistoryKept) {
        await rollbackHistory();
      }
      throw error;
    }
    return { ok: true, path: toPosix(to) };
  }
  ipcMain.handle('fs:rename', (event, from, to) => {
    assertModelSender(event, 'Vault file access');
    return renameVaultPath(from, to);
  });

  state.mcp = registerMcp({
    app,
    ipcMain,
    getWindow: () => state.win,
    getVaultRoot: () => state.vaultRoot,
    getLocalModels: () => state.localModels,
    readConfig,
    writeConfig,
    writeNote: (rel, content) => writeVaultFile(rel, content),
    renamePath: renameVaultPath,
    trashItem: (full) => shell.trashItem(full),
  });

  ipcMain.handle('fs:delete', async (event, rel) => {
    assertModelSender(event, 'Vault file access');
    const full = resolveInVault(rel);
    if (full === state.vaultRoot) {
      throw new Error('Refusing to delete vault root');
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

  ipcMain.handle('shell:reveal', async (event, rel) => {
    assertModelSender(event, 'Revealing vault files');
    shell.showItemInFolder(resolveInVault(rel));
  });
  ipcMain.handle('history:list', (event, rel) => {
    assertModelSender(event, 'Revision history');
    if (typeof rel !== 'string') {
      throw new Error('Invalid file path.');
    }
    return history.list(rel);
  });
  ipcMain.handle('history:read', (event, rel, id) => {
    assertModelSender(event, 'Revision history');
    if (typeof rel !== 'string' || typeof id !== 'string') {
      throw new Error('Invalid file path.');
    }
    return history.read(rel, id);
  });
  ipcMain.handle('history:latest-working', (event, rel) => {
    assertModelSender(event, 'Revision history');
    if (typeof rel !== 'string') {
      throw new Error('Invalid file path.');
    }
    return history.latestWorking(rel);
  });
}

module.exports = { registerVaultIpc };
