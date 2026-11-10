const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MANIFEST = path.join('.tagline', 'vault.json');
// Append one step for every persisted format change. Never edit released steps.
const migrations = [
  {
    version: 1,
    title: 'Enable vault format tracking',
    description:
      'Record the vault format so future upgrades can migrate all vault data safely. Existing documents stay unchanged.',
    async up() {},
    async validate() {},
  },
];
const active = new Set();
const journalPath = (root) => `${root}.tagline-migration.json`;

async function exists(file) {
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function regularPath(file, directory = false) {
  const stat = await fs.lstat(file);
  if (directory ? !stat.isDirectory() : !stat.isFile()) {
    throw new Error(`Migration requires a regular ${directory ? 'directory' : 'file'}: ${file}`);
  }
}

async function assertTree(root) {
  await regularPath(root, true);
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await assertTree(file);
    } else {
      await regularPath(file);
    }
  }
}

async function readManifest(root) {
  if (await exists(path.join(root, '.tagline'))) {
    await regularPath(path.join(root, '.tagline'), true);
  }
  const file = path.join(root, MANIFEST);
  if (!(await exists(file))) {
    return { version: 0 };
  }
  await regularPath(file);
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!manifest || !Number.isSafeInteger(manifest.version) || manifest.version < 0) {
    throw new Error(
      'Invalid vault format version. Restore vault.json from a backup before opening.'
    );
  }
  return manifest;
}

function migrationPlan(version, steps = migrations) {
  for (const [index, step] of steps.entries()) {
    if (
      step.version !== index + 1 ||
      typeof step.up !== 'function' ||
      typeof step.validate !== 'function'
    ) {
      throw new Error(
        'Vault migration registry must contain consecutive versions with upgrade and validation functions.'
      );
    }
  }
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new Error('Invalid vault format version.');
  }
  if (version > steps.length) {
    throw new Error('This vault uses a newer format. Update Tagline before opening it.');
  }
  return steps.filter((step) => step.version > version);
}

async function writeManifest(root, manifest) {
  await fs.mkdir(path.join(root, '.tagline'), { recursive: true });
  await fs.writeFile(path.join(root, MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
}

// A process can stop between the two directory renames. Restore the original
// before any caller creates a missing vault directory or exposes it to writers.
async function recoverMigration(root) {
  const journal = journalPath(root);
  if (!(await exists(journal))) {
    return;
  }
  await regularPath(journal);
  const { id } = JSON.parse(await fs.readFile(journal, 'utf8'));
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) {
    throw new Error(`Invalid migration recovery record: ${journal}`);
  }
  const backup = `${root}.tagline-backup-${id}`;
  if (!(await exists(root))) {
    await regularPath(backup, true);
    await fs.rename(backup, root);
  }
  // Keep interrupted staging folders for inspection rather than deleting data.
  await fs.unlink(journal);
}

async function migrateVault(root, steps = migrations) {
  const manifest = await readManifest(root);
  const plan = migrationPlan(manifest.version, steps);
  if (!plan.length) {
    return null;
  }
  await assertTree(root);
  const id = randomUUID();
  const stage = `${root}.tagline-stage-${id}`;
  const backup = `${root}.tagline-backup-${id}`;
  const journal = journalPath(root);
  const record = await fs.open(journal, 'wx');
  let moved = false;
  try {
    try {
      await record.writeFile(JSON.stringify({ id }));
      await record.sync();
    } finally {
      await record.close();
    }
    await fs.cp(root, stage, {
      recursive: true,
      preserveTimestamps: true,
      errorOnExist: true,
      force: false,
    });
    for (const step of plan) {
      await step.up(stage);
      await assertTree(stage);
      await step.validate(stage);
      await writeManifest(stage, { ...(await readManifest(stage)), version: step.version });
    }
    await fs.rename(root, backup);
    moved = true;
    await fs.rename(stage, root);
  } catch (error) {
    if (moved) {
      try {
        await fs.rename(backup, root);
      } catch (restoreError) {
        throw new Error(
          `Migration failed: ${error.message}. Automatic recovery failed: ${restoreError.message}. Original vault is at ${backup}. Reopen to retry recovery.`,
          { cause: error }
        );
      }
    }
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
    await fs.unlink(journal).catch(() => {});
    throw new Error(`Vault upgrade failed; original data is unchanged. ${error.message}`, {
      cause: error,
    });
  }
  // Once committed, cleanup failure must not report a failed migration.
  await fs.unlink(journal).catch(() => {});
  return { backup, version: steps.length };
}

async function prepareVault(root, { showMessageBox, steps = migrations } = {}) {
  root = path.resolve(root);
  const key = process.platform === 'win32' ? root.toLowerCase() : root;
  if (active.has(key)) {
    throw new Error('A vault upgrade is already in progress.');
  }
  active.add(key);
  try {
    await recoverMigration(root);
    await fs.mkdir(root, { recursive: true });
    const manifest = await readManifest(root);
    const plan = migrationPlan(manifest.version, steps);
    if (!plan.length) {
      return true;
    }
    if (!(await fs.readdir(root)).length) {
      await writeManifest(root, { version: steps.length });
      return true;
    }
    if (!showMessageBox) {
      throw new Error(
        'This vault needs an upgrade. Open it in Tagline to run the migration wizard.'
      );
    }
    const { response } = await showMessageBox({
      type: 'question',
      title: 'Vault migration wizard',
      message: `Upgrade ${path.basename(root)} from format ${manifest.version} to ${steps.length}?`,
      detail:
        plan.map((step) => `${step.version}. ${step.title}\n${step.description}`).join('\n\n') +
        '\n\nAll required upgrades run in order on a separate copy. The original vault is retained as a backup beside this folder. Close other apps editing this vault and pause cloud sync before continuing. Cancel leaves this vault unopened and unchanged.',
      buttons: ['Back up and upgrade', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) {
      return false;
    }
    const result = await migrateVault(root, steps);
    await showMessageBox({
      type: 'info',
      title: 'Vault upgrade complete',
      message: 'Your vault is ready to open.',
      detail: `Format ${result?.version ?? steps.length}. Original backup: ${result?.backup ?? 'No changes were needed.'}\n\nTo restore, close Tagline and replace the upgraded folder with the backup. Keep the backup until you have checked your data.`,
      buttons: ['Open vault'],
    });
    return true;
  } finally {
    active.delete(key);
  }
}

module.exports = {
  migrations,
  migrationPlan,
  readManifest,
  migrateVault,
  recoverMigration,
  prepareVault,
  journalPath,
};
