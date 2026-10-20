// Verifies the Debate Vault -> Tagline profile migration, including the safeStorage-encrypted token.
// Node orchestrates two Electron runs: one seeds a legacy profile, one launches Tagline against it.
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const phase = process.env.TAGLINE_MIGRATION_PHASE;
const TOKEN = 'hf_MigrationTest123';

if (!phase) {
  const { spawnSync } = require('node:child_process');
  const electron = require('electron');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tagline-migrate-'));
  const run = (name) => {
    const r = spawnSync(electron, [__filename], {
      env: { ...process.env, TAGLINE_MIGRATION_PHASE: name, TAGLINE_MIGRATION_ROOT: root },
      encoding: 'utf8', timeout: 60000,
    });
    process.stdout.write(r.stdout || '');
    if (r.status !== 0) {
      process.stderr.write(r.stderr || '');
      throw new Error(`${name} phase failed (${r.status})`);
    }
  };
  try {
    run('seed');
    run('check');
    console.log('PASS: legacy profile migrated (config, settings storage, encrypted token).');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  return;
}

const { app, safeStorage } = require('electron');
const root = process.env.TAGLINE_MIGRATION_ROOT;
const vault = path.join(root, 'vault');
app.setPath('appData', root);

if (phase === 'seed') {
  app.setPath('userData', path.join(root, 'debate-vault'));
  app.whenReady().then(() => {
    fs.mkdirSync(vault, { recursive: true });
    fs.writeFileSync(path.join(vault, 'Note.md'), '# Note');
    const legacy = app.getPath('userData');
    fs.writeFileSync(path.join(legacy, 'config.json'), JSON.stringify({ lastVault: vault }));
    fs.mkdirSync(path.join(legacy, 'semantic-search'), { recursive: true });
    fs.writeFileSync(path.join(legacy, 'semantic-search', 'huggingface-token.bin'), safeStorage.encryptString(TOKEN));
    app.quit();
  });
} else {
  app.setPath('userData', path.join(root, 'Tagline'));
  app.on('browser-window-created', (_e, win) => {
    win.webContents.once('did-finish-load', () => {
      try {
        const current = app.getPath('userData');
        const config = JSON.parse(fs.readFileSync(path.join(current, 'config.json'), 'utf8'));
        if (config.lastVault !== vault) throw new Error('config.json was not migrated');
        const encrypted = fs.readFileSync(path.join(current, 'semantic-search', 'huggingface-token.bin'));
        if (safeStorage.decryptString(encrypted) !== TOKEN) throw new Error('token did not decrypt');
        if (!fs.existsSync(path.join(root, 'debate-vault', 'config.json'))) throw new Error('legacy profile modified');
        app.exit(0);
      } catch (e) {
        console.error('FAIL:', e.message);
        app.exit(1);
      }
    });
  });
  require('../electron/main.cjs');
}
