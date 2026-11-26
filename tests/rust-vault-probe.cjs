const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { listVault } = require('../electron/vaultFiles.cjs');
const { listNotePaths } = require('../electron/rustVaultProbe.cjs');

function flatten(nodes, paths = []) {
  for (const node of nodes) {
    if (node.type === 'folder') {
      flatten(node.children, paths);
    } else {
      paths.push(node.path);
    }
  }
  return paths.sort();
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-rust-vault-'));
  try {
    await Promise.all([
      fs.mkdir(path.join(root, 'Nested'), { recursive: true }),
      fs.mkdir(path.join(root, '.hidden')),
      fs.writeFile(path.join(root, 'argument.md'), 'one'),
      fs.writeFile(path.join(root, 'ignored.txt'), 'two'),
      fs.writeFile(path.join(root, 'Nested', 'flow.json'), '{}'),
      fs.writeFile(path.join(root, '.hidden', 'secret.md'), 'three'),
    ]);
    const expected = flatten(await listVault(root));
    assert.deepEqual(listNotePaths(root), expected);
    console.log(`Rust probe matched JavaScript for ${expected.length} vault files.`);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
