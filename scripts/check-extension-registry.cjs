// Checks extensions/registry.json against the live GitHub manifests it points to.
// Used by the registry pull-request workflow: node scripts/check-extension-registry.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Ajv = require('ajv');
const { createExtensionRegistry, REGISTRY_URL } = require('../electron/extensionRegistry.cjs');
const { validateManifest } = require('../electron/extensions.cjs');

const root = path.join(__dirname, '..');
const file = path.join(root, 'extensions', 'registry.json');
const readSchema = (name) =>
  JSON.parse(fs.readFileSync(path.join(root, 'schemas', `${name}.schema.json`), 'utf8'));
const ajv = new Ajv({
  allErrors: true,
  strict: true,
  strictTypes: false,
  strictRequired: false,
  allowUnionTypes: true,
});
const schemaCheck = (name) => {
  const validate = ajv.compile(readSchema(name));
  return (value) => {
    if (!validate(value)) {
      throw new Error(`Does not match ${name}.schema.json: ${ajv.errorsText(validate.errors)}`);
    }
  };
};

(async () => {
  const local = fs.readFileSync(file);
  schemaCheck('extension-registry')(JSON.parse(local.toString('utf8')));
  const registry = createExtensionRegistry({
    fetchImpl: (url, options) =>
      url === REGISTRY_URL ? Promise.resolve(new Response(local)) : fetch(url, options),
    stagingRoot: () => path.join(os.tmpdir(), 'tagline-registry-check'),
    validateManifest,
    validateSchema: schemaCheck('extension-manifest'),
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
