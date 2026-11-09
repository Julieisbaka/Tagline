const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ID } = require('./manifest.cjs');

const MAX_SECRET_KEY = 200;
const MAX_SECRET_VALUE = 10000;
const MAX_SECRETS = 50;

function registerStorageHandlers(context) {
  const { app, ipcMain, safeStorage, scan, limits } = context;
  const secretsDir = () => path.join(app.getPath('userData'), 'extension-secrets');
  const secretQueues = new Map();
  const storageDir = () => path.join(app.getPath('userData'), 'extension-storage');
  const storageQueues = new Map();
  const readExtensionStorage = async (id) => {
    const file = path.join(storageDir(), `${id}.bin`);
    let encrypted;
    try {
      encrypted = await fs.readFile(file);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
    try {
      const parsed = JSON.parse((await safeStorage.decryptStringAsync(encrypted)).result);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      throw new Error('Cannot decrypt this extension’s storage.');
    }
  };
  const writeExtensionStorage = async (id, data) => {
    const file = path.join(storageDir(), `${id}.bin`);
    if (!Object.keys(data).length) {
      await fs.rm(file, { force: true });
      return;
    }
    await fs.mkdir(storageDir(), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, await safeStorage.encryptStringAsync(JSON.stringify(data)), {
      mode: 0o600,
    });
    await fs.rename(tmp, file);
  };
  const serializeStorage = (id, task) => {
    const run = (storageQueues.get(id) || Promise.resolve()).catch(() => {}).then(task);
    storageQueues.set(id, run);
    return run;
  };
  ipcMain.handle('extensions:storage', async (_event, id, action, key, value) => {
    if (typeof id !== 'string' || !ID.test(id) || !['get', 'set', 'replace'].includes(action)) {
      throw new Error('Invalid extension request.');
    }
    const item = (await scan()).find((extension) => extension.id === id && !extension.error);
    if (!item || !item.enabled) {
      throw new Error('Extension is no longer enabled.');
    }
    if (!safeStorage || !(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('Secure storage is not available on this system.');
    }
    return serializeStorage(id, async () => {
      const data = await readExtensionStorage(id);
      if (action === 'get') {
        return data;
      }
      let next;
      if (action === 'set') {
        if (typeof key !== 'string' || !key || key.length > MAX_SECRET_KEY) {
          throw new Error(`Key must be 1-${MAX_SECRET_KEY} characters.`);
        }
        next = { ...(data || {}), [key]: value };
        if (value === undefined || value === null) {
          delete next[key];
        }
      } else {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('Invalid extension storage.');
        }
        next = value;
      }
      if (JSON.stringify(next).length > limits().extensionStorageCharacters) {
        throw new Error('Extension storage exceeds the configured limit.');
      }
      await writeExtensionStorage(id, next);
      return true;
    });
  });
  const readSecrets = async (id) => {
    const file = path.join(secretsDir(), `${id}.bin`);
    let encrypted;
    try {
      encrypted = await fs.readFile(file);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {};
      }
      throw error;
    }
    try {
      const parsed = JSON.parse((await safeStorage.decryptStringAsync(encrypted)).result);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      throw new Error('Cannot decrypt this extension’s secrets. Clear them and set them again.');
    }
  };
  const writeSecrets = async (id, data) => {
    const file = path.join(secretsDir(), `${id}.bin`);
    if (!Object.keys(data).length) {
      await fs.rm(file, { force: true });
      return;
    }
    await fs.mkdir(secretsDir(), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, await safeStorage.encryptStringAsync(JSON.stringify(data)), {
      mode: 0o600,
    });
    await fs.rename(tmp, file);
  };
  const serialize = (id, task) => {
    const run = (secretQueues.get(id) || Promise.resolve()).catch(() => {}).then(task);
    secretQueues.set(id, run);
    return run;
  };

  ipcMain.handle('extensions:secret', async (_event, id, action, key, value) => {
    if (typeof id !== 'string' || !ID.test(id) || !['get', 'set', 'has'].includes(action)) {
      throw new Error('Invalid extension request.');
    }
    const item = (await scan()).find((extension) => extension.id === id && !extension.error);
    if (!item || !item.enabled) {
      throw new Error('Extension is no longer enabled.');
    }
    if (!item.allowedPermissions.includes('secrets')) {
      throw new Error('Secrets permission is required.');
    }
    if (typeof key !== 'string' || !key || key.length > MAX_SECRET_KEY) {
      throw new Error(`Key must be 1-${MAX_SECRET_KEY} characters.`);
    }
    if (!safeStorage || !(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('Secure storage is not available on this system.');
    }
    return serialize(id, async () => {
      const data = await readSecrets(id);
      if (action === 'get') {
        return Object.hasOwn(data, key) ? data[key] : null;
      }
      if (action === 'has') {
        return Object.hasOwn(data, key);
      }
      const next = { ...data };
      if (value === null || value === undefined) {
        delete next[key];
      } else {
        if (typeof value !== 'string' || value.length > MAX_SECRET_VALUE) {
          throw new Error(`Secret values must be strings up to ${MAX_SECRET_VALUE} characters.`);
        }
        if (!Object.hasOwn(next, key) && Object.keys(next).length >= MAX_SECRETS) {
          throw new Error(`Extensions can store at most ${MAX_SECRETS} secrets.`);
        }
        next[key] = value;
      }
      await writeSecrets(id, next);
      return true;
    });
  });

  ipcMain.handle('extensions:clearSecrets', (_event, id) => {
    if (typeof id !== 'string' || !ID.test(id)) {
      throw new Error('Invalid extension request.');
    }
    return serialize(id, async () => {
      await fs.rm(path.join(secretsDir(), `${id}.bin`), { force: true });
      return true;
    });
  });

  Object.assign(context, { secretsDir, storageDir, serialize, serializeStorage });
}

module.exports = { registerStorageHandlers };
