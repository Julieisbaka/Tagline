const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const asar = require('@electron/asar');

async function main() {
  const app = path.resolve(process.argv[2] || '');
  assert.ok(process.argv[2], 'Provide the packaged Tagline.app path.');
  const resources = path.join(app, 'Contents', 'Resources');
  const archive = path.join(resources, 'app.asar');
  const unpackedFilter = path.join(
    resources,
    'app.asar.unpacked',
    'electron',
    'highlightRoundTrip.lua'
  );
  assert.ok(fs.existsSync(archive), `Missing app archive: ${archive}`);
  assert.ok(fs.existsSync(unpackedFilter), `Missing unpacked filter: ${unpackedFilter}`);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tagline-packaged-pandoc-'));
  try {
    const source = await asar.extractFile(archive, 'electron/pandoc.cjs');
    const packagedPandocPath = path.join(temp, 'pandoc.cjs');
    fs.writeFileSync(packagedPandocPath, source);
    const { highlightFilterPath } = require(packagedPandocPath);
    const filterPath = highlightFilterPath(path.join(archive, 'electron'));
    assert.equal(filterPath, unpackedFilter);

    const html = '<p><span class="mark">highlighted</span></p>';
    const markdown = execFileSync(
      'pandoc',
      ['--from=html', '--to=markdown+mark', `--lua-filter=${filterPath}`, '--sandbox'],
      { encoding: 'utf8', input: html }
    );
    assert.match(markdown, /==highlighted==/);

    const rtf = execFileSync(
      'pandoc',
      ['--from=html', '--to=rtf', `--lua-filter=${filterPath}`, '--sandbox'],
      { encoding: 'utf8', input: html }
    );
    assert.match(rtf, /\\highlight99/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
