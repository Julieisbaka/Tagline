// Temporary probe: give every smoke suite a versioned vault manifest.
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname);
const files = fs
  .readdirSync(dir)
  .filter((name) => name.endsWith('-smoke.cjs'))
  .map((name) => path.join(dir, name));

const manifestExpr =
  "JSON.stringify({ version: require('../electron/vaultMigrations.cjs').migrations.length })";

for (const file of files) {
  let text = fs.readFileSync(file, 'utf8');
  if (text.includes('.tagline') && text.includes('vault.json')) {
    console.log('skip (already has manifest):', path.basename(file));
    continue;
  }
  const lines = text.split('\n');
  const vaultDecl = lines.findIndex((line) => /const\s+(\w*[Vv]ault\w*)\s*=\s*path\.join/.test(line));
  if (vaultDecl < 0) {
    console.log('skip (no vault var):', path.basename(file));
    continue;
  }
  const varName = lines[vaultDecl].match(/const\s+(\w*[Vv]ault\w*)\s*=/)[1];
  const mkdirIdx = lines.findIndex(
    (line, index) =>
      index > vaultDecl && line.includes('mkdir') && line.includes(varName)
  );
  if (mkdirIdx < 0) {
    console.log('skip (no mkdir):', path.basename(file));
    continue;
  }
  const isAsync = /fs\/promises/.test(text) || /await fs\.mkdir/.test(text);
  const indent = (lines[mkdirIdx].match(/^\s*/) || [''])[0];
  const insert = isAsync
    ? [
        `${indent}await fs.mkdir(path.join(${varName}, '.tagline'), { recursive: true });`,
        `${indent}await fs.writeFile(path.join(${varName}, '.tagline', 'vault.json'), ${manifestExpr});`,
      ]
    : [
        `${indent}fs.mkdirSync(path.join(${varName}, '.tagline'), { recursive: true });`,
        `${indent}fs.writeFileSync(path.join(${varName}, '.tagline', 'vault.json'), ${manifestExpr});`,
      ];
  lines.splice(mkdirIdx + 1, 0, ...insert);
  fs.writeFileSync(file, lines.join('\n'));
  console.log('patched:', path.basename(file), 'line', mkdirIdx + 1);
}
