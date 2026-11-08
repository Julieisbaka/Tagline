const fs = require('node:fs/promises');
const path = require('node:path');

let pathsBusy = false;
async function withModelPathsLock(action) {
  if (pathsBusy) {
    throw new Error('Another model storage operation is in progress. Please wait.');
  }
  pathsBusy = true;
  try {
    return await action();
  } finally {
    pathsBusy = false;
  }
}

// Only inspect or remove the app's fixed model-cache directory, never a selected model folder.
function modelCache(userData, storage) {
  const parent = path.join(userData, storage);
  const root = path.join(parent, 'models');
  async function exists() {
    for (const dir of [parent, root]) {
      try {
        const stat = await fs.lstat(dir);
        if (stat.isSymbolicLink() || !stat.isDirectory()) {
          throw new Error('Model cache path is not a regular directory.');
        }
      } catch (error) {
        if (error.code === 'ENOENT') {
          return false;
        }
        throw error;
      }
    }
    return true;
  }
  async function size(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    let bytes = 0;
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        bytes += await size(file);
      } else if (entry.isFile()) {
        bytes += (await fs.lstat(file)).size;
      }
    }
    return bytes;
  }
  const contains = (parentDir, child) => {
    const relative = path.relative(parentDir, child);
    return (
      !relative ||
      (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
  };
  return {
    size: async () => ((await exists()) ? size(root) : 0),
    remove: (protectedFolder) =>
      withModelPathsLock(async () => {
        if (!(await exists())) {
          return;
        }
        if (typeof protectedFolder === 'string' && path.isAbsolute(protectedFolder)) {
          const realRoot = await fs.realpath(root);
          const realFolder = await fs.realpath(protectedFolder).catch((error) => {
            if (error.code === 'ENOENT') {
              return protectedFolder;
            }
            throw error;
          });
          if (
            contains(root, protectedFolder) ||
            contains(protectedFolder, root) ||
            contains(realRoot, realFolder) ||
            contains(realFolder, realRoot)
          ) {
            throw new Error(
              'The selected local model folder overlaps this cache. Choose another source before removing it.'
            );
          }
        }
        await fs.rm(root, { recursive: true });
      }),
  };
}

module.exports = { modelCache, withModelPathsLock };
