const { readdirSync } = require('node:fs');
const path = require('node:path');

let nativeModule;

function loadNativeModule() {
  if (nativeModule) {
    return nativeModule;
  }
  const directory = path.join(__dirname, '..', 'experiments', 'rust-vault', 'dist');
  const binary = readdirSync(directory).find((file) => file.endsWith('.node'));
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
