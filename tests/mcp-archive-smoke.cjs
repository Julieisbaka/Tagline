if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const path = require('node:path');
  const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tagline-mcp-asar-'));
  try {
    const result = spawnSync(require('electron'), [__filename], {
      env: { ...process.env, TAGLINE_MCP_ASAR_TEMP: temp },
      stdio: 'inherit',
      timeout: 120000,
    });
    if (result.error) {
      throw result.error;
    }
    process.exitCode = result.status ?? 1;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  return;
}

const { app } = require('electron');
const asar = require('@electron/asar');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const temp = process.env.TAGLINE_MCP_ASAR_TEMP;
  if (!temp) {
    throw new Error('Run through npm run test:mcp.');
  }
  const root = path.join(__dirname, '..');
  const stage = path.join(temp, 'stage');
  const vault = path.join(temp, 'vault');
  const config = require('../package.json');
  await fs.mkdir(path.join(stage, 'electron'), { recursive: true });
  await fs.mkdir(path.join(stage, 'src', 'lib'), { recursive: true });
  await fs.mkdir(path.join(stage, 'node_modules'), { recursive: true });
  await fs.mkdir(vault);
  await fs.writeFile(path.join(vault, 'Card.md'), '#### Impact\n**Smith 2001** — "Example"\n');
  await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify({ type: 'module' }));
  for (const file of ['mcp.cjs', 'vaultFiles.cjs']) {
    await fs.copyFile(path.join(root, 'electron', file), path.join(stage, 'electron', file));
  }
  await fs.cp(path.join(root, 'electron', 'mcp'), path.join(stage, 'electron', 'mcp'), {
    recursive: true,
  });
  for (const file of [
    'cardDetection.js',
    'citationExtraction.js',
    'evidenceCheckup.js',
    'calendar.js',
    'frontmatter.js',
    'vault.js',
  ]) {
    assert.ok(config.build.files.includes(`src/lib/${file}`), `Missing packaged file: ${file}`);
    await fs.copyFile(path.join(root, 'src', 'lib', file), path.join(stage, 'src', 'lib', file));
  }
  assert.ok(config.build.files.includes('src/lib/citationExtraction/**/*'));
  await fs.cp(
    path.join(root, 'src', 'lib', 'citationExtraction'),
    path.join(stage, 'src', 'lib', 'citationExtraction'),
    { recursive: true }
  );
  for (const dep of ['marked', 'yaml']) {
    await fs.cp(path.join(root, 'node_modules', dep), path.join(stage, 'node_modules', dep), {
      recursive: true,
    });
  }
  const archive = path.join(temp, 'app.asar');
  await asar.createPackage(stage, archive);
  const { createMcpService } = require(path.join(archive, 'electron', 'mcp.cjs'));
  const service = createMcpService({ getVaultRoot: () => vault, getAllowWrites: () => false });
  for (const [name, args, check] of [
    ['list_cards', {}, (value) => assert.equal(value.count, 1)],
    [
      'extract_citation',
      { text: '**Smith 2001**' },
      (value) => assert.equal(value.citation.author, 'Smith'),
    ],
    ['validate_isbn', { isbn: '9780201896831' }, (value) => assert.equal(value.valid, true)],
    [
      'audit_evidence',
      {},
      (value) => assert.ok(value.issues.some((issue) => issue.kind === 'stale_date')),
    ],
  ]) {
    const { result } = await service.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    });
    assert.equal(result.isError, undefined, result.content[0].text);
    check(JSON.parse(result.content[0].text));
  }
  console.log('PASS: MCP evidence tools load and run from an Electron ASAR archive.');
  app.exit(0);
})().catch((error) => {
  console.error(error);
  app.exit(1);
});
