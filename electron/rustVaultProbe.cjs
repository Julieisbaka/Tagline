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
  const binary = files.find((file) => file.endsWith('.node'));
  if (!binary) {
    throw new Error(`Rust vault probe is not built. Run "npm run experiment:rust-vault".`);
  }
  nativeModule = require(path.join(directory, binary));
  return nativeModule;
}

function listNotePaths(root) {
  return loadNativeModule().listNotePaths(root);
}

module.exports = { listNotePaths };
