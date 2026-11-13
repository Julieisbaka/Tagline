const { prepareVault } = require('../vaultMigrations.cjs');

function createVault({ app, path, fs, fssync, randomUUID, process, dialog }, state) {
  const configPath = () => path.join(app.getPath('userData'), 'config.json');
  const configRecoveryPath = () => path.join(app.getPath('userData'), 'config.recovery.json');
  let configRecoveryHandled = false;
  let configCache = null;
  let configCacheKey = null;

  function configStatKey(configPathFn) {
    try {
      const stat = fssync.statSync(configPathFn);
      return `${stat.mtimeMs}:${stat.size}:${stat.ctimeMs}`;
    } catch {
      configCache = null;
      configCacheKey = null;
      return null;
    }
  }

  function writeConfigRecovery(info) {
    const recoveryPath = configRecoveryPath();
    const payload = { schemaVersion: 1, ...info };
    const temporary = recoveryPath + '.tmp.' + randomUUID();
    try {
      fssync.writeFileSync(temporary, JSON.stringify(payload, null, 2), 'utf8');
      const fd = fssync.openSync(temporary, 'r+');
      try {
        fssync.fsyncSync(fd);
      } finally {
        fssync.closeSync(fd);
      }
      fssync.renameSync(temporary, recoveryPath);
    } catch (writeErr) {
      try {
        fssync.rmSync(temporary, { force: true });
      } catch {}
      console.error(
        '[config] CRITICAL: failed to persist recovery notice; backup may be at',
        info && info.backupPath,
        writeErr.message
      );
    }
  }

  function readConfig() {
    const configPathFn = configPath();
    const statKey = configStatKey(configPathFn);
    if (configCache && statKey !== null && statKey === configCacheKey) {
      return { ...configCache };
    }
    let raw;
    try {
      raw = fssync.readFileSync(configPathFn, 'utf8');
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        configCache = {};
        configCacheKey = null;
        return {};
      }
      console.warn('[config] failed to read', configPathFn, err.message);
      if (!configRecoveryHandled) {
        configRecoveryHandled = true;
        const corruptPath = configPathFn + '.corrupt.' + Date.now();
        let backupPath = null;
        try {
          fssync.renameSync(configPathFn, corruptPath);
          backupPath = corruptPath;
        } catch (renameErr) {
          console.warn(
            '[config] failed to back up unreadable config',
            corruptPath,
            renameErr.message
          );
        }
        const recovery = {
          at: Date.now(),
          source: 'read',
          backupPath,
          error: String(err.message || err),
        };
        console.warn('[config] recovered from unreadable config', recovery);
        console.info('[event] config_recovered', recovery.source);
        writeConfigRecovery(recovery);
      }
      configCache = null;
      configCacheKey = null;
      return {};
    }
    try {
      const parsed = JSON.parse(raw);
      configCache = parsed;
      configCacheKey = statKey;
      return { ...parsed };
    } catch (err) {
      console.warn('[config] failed to parse', configPathFn, err.message);
      if (!configRecoveryHandled) {
        configRecoveryHandled = true;
        const corruptPath = configPathFn + '.corrupt.' + Date.now();
        let backupPath = null;
        try {
          fssync.renameSync(configPathFn, corruptPath);
          backupPath = corruptPath;
        } catch (renameErr) {
          console.warn('[config] failed to back up corrupt config', corruptPath, renameErr.message);
        }
        const recovery = {
          at: Date.now(),
          source: 'parse',
          backupPath,
          error: String(err.message || err),
        };
        console.warn('[config] recovered from corruption', recovery);
        console.info('[event] config_recovered', recovery.source);
        writeConfigRecovery(recovery);
      }
      configCache = null;
      configCacheKey = null;
      return {};
    }
  }

  function getConfigRecovery() {
    try {
      const raw = fssync.readFileSync(configRecoveryPath(), 'utf8');
      const data = JSON.parse(raw);
      return data && typeof data === 'object' ? data : null;
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        return null;
      }
      console.warn('[config] failed to read recovery notice', err.message);
      return null;
    }
  }

  function consumeConfigRecovery() {
    const recovery = getConfigRecovery();
    try {
      fssync.rmSync(configRecoveryPath(), { force: true });
    } catch (err) {
      console.warn('[config] failed to clear recovery notice', err.message);
    }
    return recovery;
  }

  function writeConfig(patch) {
    const next = { ...readConfig(), ...patch };
    const configPathFn = configPath();
    fssync.mkdirSync(path.dirname(configPathFn), { recursive: true });
    const temporary = path.join(path.dirname(configPathFn), `.tagline-config-${randomUUID()}.tmp`);
    const retryable = (error) => error && (error.code === 'EBUSY' || error.code === 'EPERM');
    let lastError;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        fssync.writeFileSync(temporary, JSON.stringify(next, null, 2));
        const fd = fssync.openSync(temporary, 'r+');
        try {
          fssync.fsyncSync(fd);
        } finally {
          fssync.closeSync(fd);
        }
        fssync.renameSync(temporary, configPathFn);
        lastError = null;
        break;
      } catch (error) {
        try {
          fssync.rmSync(temporary, { force: true });
        } catch {}
        lastError = error;
        if (retryable(error) && attempt < 4) {
          console.info('[event] config_write_retry', attempt + 1);
          const wait = 25 * (attempt + 1);
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
          continue;
        }
        throw error;
      }
    }
    if (lastError) {
      throw lastError;
    }
    configCache = next;
    configCacheKey = configStatKey(configPathFn);
    return { ...next };
  }

  function cleanupConfigTemps() {
    const directory = path.dirname(configPath());
    let entries;
    try {
      entries = fssync.readdirSync(directory);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('[config] failed to scan temporary files', error.message);
      }
      return;
    }
    const cutoff = Date.now() - 60_000;
    for (const name of entries) {
      if (!/^\.tagline-config-.+\.tmp$/.test(name)) {
        continue;
      }
      const temporary = path.join(directory, name);
      try {
        const stat = fssync.statSync(temporary);
        if (stat.isFile() && stat.mtimeMs < cutoff) {
          fssync.unlinkSync(temporary);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.warn('[config] failed to remove stale temporary file', temporary, error.message);
        }
      }
    }
  }

  // Resolve a vault-relative path and refuse anything that escapes the vault.
  function resolveInVault(rel = '') {
    if (typeof rel !== 'string') {
      throw new Error('Invalid file path.');
    }
    if (!state.vaultRoot) {
      throw new Error('No vault open');
    }
    const full = path.resolve(state.vaultRoot, rel);
    const relCheck = path.relative(state.vaultRoot, full);
    if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
      throw new Error('Path escapes vault: ' + rel);
    }
    return full;
  }

  const toPosix = (p) => p.split(path.sep).join('/');

  function uniquePath(rel, folder = false, underscoreFolders = false) {
    const ext = folder ? '' : path.extname(rel);
    const stem = rel.slice(0, rel.length - ext.length);
    for (let i = 0; i < 10; i++) {
      const candidate = i === 0 ? rel : `${stem}${underscoreFolders ? '_' : ' '}${i}${ext}`;
      if (!fssync.existsSync(resolveInVault(candidate))) {
        return candidate;
      }
    }
    throw new Error(`Could not find an available path for "${rel}" after 10 attempts.`);
  }

  async function openVault(dir) {
    const accepted = await prepareVault(dir, {
      showMessageBox:
        dialog &&
        ((options) =>
          state.win ? dialog.showMessageBox(state.win, options) : dialog.showMessageBox(options)),
    });
    if (!accepted) {
      return null;
    }
    state.vaultRoot = path.resolve(dir);
    const saved = readConfig().recentVaults;
    const key = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
    const recentVaults = [
      state.vaultRoot,
      ...(Array.isArray(saved)
        ? saved.filter(
            (item) => typeof item === 'string' && key(path.resolve(item)) !== key(state.vaultRoot)
          )
        : []),
    ].slice(0, 20);
    writeConfig({ lastVault: state.vaultRoot, recentVaults });
    return { root: state.vaultRoot, name: path.basename(state.vaultRoot) };
  }

  async function validateRecentVault(root) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) {
      return false;
    }
    const resolved = path.resolve(root);
    const key = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
    const keyRoot = key(resolved);
    const recent = await listRecentVaults();
    return recent.some((item) => item.exists && key(item.root) === keyRoot);
  }

  async function listRecentVaults() {
    const config = readConfig();
    const candidates = [
      ...(Array.isArray(config.recentVaults) ? config.recentVaults : []),
      ...(typeof config.lastVault === 'string' ? [config.lastVault] : []),
    ];
    const key = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
    const unique = [
      ...new Map(
        candidates
          .filter((item) => typeof item === 'string' && path.isAbsolute(item))
          .map((item) => [key(path.resolve(item)), path.resolve(item)])
      ).values(),
    ].slice(0, 20);
    return Promise.all(
      unique.map(async (root) => {
        let exists = false;
        try {
          exists = (await fs.stat(root)).isDirectory();
        } catch (error) {
          if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') {
            throw error;
          }
          exists = fssync.existsSync(`${root}.tagline-migration.json`);
        }
        return { root, name: path.basename(root), exists };
      })
    );
  }

  return {
    readConfig,
    writeConfig,
    cleanupConfigTemps,
    getConfigRecovery,
    consumeConfigRecovery,
    resolveInVault,
    openVault,
    listRecentVaults,
    validateRecentVault,
    uniquePath,
    toPosix,
  };
}

module.exports = { createVault };
