function createVault({ app, path, fs, fssync, randomUUID, process }, state) {
  const configPath = () => path.join(app.getPath('userData'), 'config.json');

  function readConfig() {
    try {
      return JSON.parse(fssync.readFileSync(configPath(), 'utf8'));
    } catch (err) {
      const configPathFn = configPath();
      console.warn('[config] failed to read/parse', configPathFn, err.message);
      const corruptPath = configPathFn + '.corrupt.' + Date.now();
      try {
        fssync.renameSync(configPathFn, corruptPath);
      } catch {}
      return {};
    }
  }

  function writeConfig(patch) {
    const next = { ...readConfig(), ...patch };
    const configPathFn = configPath();
    fssync.mkdirSync(path.dirname(configPathFn), { recursive: true });
    const temporary = path.join(path.dirname(configPathFn), `.tagline-config-${randomUUID()}.tmp`);
    try {
      fssync.writeFileSync(temporary, JSON.stringify(next, null, 2));
      fssync.renameSync(temporary, configPathFn);
    } catch (error) {
      try {
        fssync.rmSync(temporary, { force: true });
      } catch {}
      throw error;
    }
    return next;
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
    let candidate = rel;
    let i = 1;
    while (fssync.existsSync(resolveInVault(candidate))) {
      candidate = `${stem}${underscoreFolders ? '_' : ' '}${i++}${ext}`;
    }
    return candidate;
  }

  async function openVault(dir) {
    await fs.mkdir(dir, { recursive: true });
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
        }
        return { root, name: path.basename(root), exists };
      })
    );
  }

  return {
    readConfig,
    writeConfig,
    resolveInVault,
    openVault,
    listRecentVaults,
    uniquePath,
    toPosix,
  };
}

module.exports = { createVault };
