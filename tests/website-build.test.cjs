const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildWebsite } = require('../scripts/build-website.cjs');

function withWebsiteFixture(callback) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tagline-website-build-'));
  const sourceDir = path.join(rootDir, 'website');
  const outputDir = path.join(rootDir, 'website-build');
  fs.mkdirSync(sourceDir);

  try {
    callback({ sourceDir, outputDir });
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

test('website build renders development metadata without modifying source files', () => {
  withWebsiteFixture(({ sourceDir, outputDir }) => {
    const template = '<a href="#{{TAGLINE:VERSION_ANCHOR}}">{{TAGLINE:VERSION}} · {{TAGLINE:RELEASE_STATUS}}</a>';
    fs.writeFileSync(path.join(sourceDir, 'index.html'), template);
    fs.writeFileSync(path.join(sourceDir, 'site.css'), 'body { color: black; }');

    buildWebsite(sourceDir, outputDir, '0.2.0-dev');

    assert.equal(
      fs.readFileSync(path.join(outputDir, 'index.html'), 'utf8'),
      '<a href="#v0-2-0">0.2.0 · In development</a>'
    );
    assert.equal(fs.readFileSync(path.join(sourceDir, 'index.html'), 'utf8'), template);
    assert.equal(fs.readFileSync(path.join(outputDir, 'site.css'), 'utf8'), 'body { color: black; }');
  });
});

test('website build renders released metadata without a development suffix', () => {
  withWebsiteFixture(({ sourceDir, outputDir }) => {
    fs.writeFileSync(
      path.join(sourceDir, 'index.html'),
      '{{TAGLINE:VERSION}} · {{TAGLINE:RELEASE_STATUS}}'
    );

    buildWebsite(sourceDir, outputDir, '1.2.3');

    assert.equal(
      fs.readFileSync(path.join(outputDir, 'index.html'), 'utf8'),
      '1.2.3 · Released'
    );
  });
});

test('website build fails on unknown Tagline template tokens', () => {
  withWebsiteFixture(({ sourceDir, outputDir }) => {
    fs.writeFileSync(path.join(sourceDir, 'index.html'), '{{TAGLINE:UNKNOWN}}');

    assert.throws(
      () => buildWebsite(sourceDir, outputDir, '0.2.0-dev'),
      /Unknown website template token: \{\{TAGLINE:UNKNOWN\}\}/
    );
  });
});
