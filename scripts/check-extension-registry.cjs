// Checks extensions/registry.json against the live GitHub manifests it points to.
// Used by the registry pull-request workflow: node scripts/check-extension-registry.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createExtensionRegistry, REGISTRY_URL } = require('../electron/extensionRegistry.cjs');
const { validateManifest } = require('../electron/extensions.cjs');

const file = path.join(__dirname, '..', 'extensions', 'registry.json');

(async () => {
  const local = fs.readFileSync(file);
  const registry = createExtensionRegistry({
    fetchImpl: (url, options) =>
      url === REGISTRY_URL ? Promise.resolve(new Response(local)) : fetch(url, options),
    stagingRoot: () => path.join(os.tmpdir(), 'tagline-registry-check'),
    validateManifest,
    limits: () => undefined,
    installFromFolder: () => {
      throw new Error('The registry check does not install extensions.');
    },
  });
  const { entries } = await registry.list(true);
  let failed = false;
  for (const entry of entries) {
    if (entry.error) {
      failed = true;
      console.error(`✖ ${entry.url}\n  ${entry.error}`);
    } else {
      console.log(`✔ ${entry.id} v${entry.version} — ${entry.url}`);
    }
  }
  console.log(`${entries.length} registry entr${entries.length === 1 ? 'y' : 'ies'} checked.`);
  process.exitCode = failed ? 1 : 0;
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
