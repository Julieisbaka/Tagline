const { readdirSync } = require('node:fs');
const path = require('node:path');

let nativeModule;

function loadNativeModule() {
  if (nativeModule) {
    return nativeModule;
  }
  const directory = path.join(__dirname, '..', 'experiments', 'rust-vault', 'dist');
  let files;
  try {
    files = readdirSync(directory);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    files = [];
  }
  const binaries = files.filter((file) => file.endsWith('.node'));
  if (binaries.length === 0) {
    throw new Error(`Rust vault probe is not built. Run "npm run experiment:rust-vault".`);
  }
  if (binaries.length > 1) {
    throw new Error(`Multiple Rust vault probe addons found. Remove stale .node files from ${directory} and rebuild.`);
  }
  nativeModule = require(path.join(directory, binaries[0]));
  return nativeModule;
}

function listNotePaths(root) {
  return loadNativeModule().listNotePaths(root);
}

module.exports = { listNotePaths };
