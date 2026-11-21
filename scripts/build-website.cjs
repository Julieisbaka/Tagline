const fs = require('node:fs');
const path = require('node:path');

const TOKEN_PATTERN = /\{\{TAGLINE:([A-Z][A-Z0-9_]*)\}\}/g;

function getTemplateValues(packageVersion) {
  if (!/^\d+\.\d+\.\d+(?:-dev)?$/.test(packageVersion)) {
    throw new Error(`Unsupported package version for website templates: ${packageVersion}`);
  }

  const isDevelopment = packageVersion.endsWith('-dev');
  const version = isDevelopment ? packageVersion.slice(0, -4) : packageVersion;

  return {
    VERSION: version,
    VERSION_ANCHOR: `v${version.replace(/\./g, '-')}`,
    RELEASE_STATUS: isDevelopment ? 'In development' : 'Released',
  };
}

function renderHtml(html, values) {
  return html.replace(TOKEN_PATTERN, (token, name) => {
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      throw new Error(`Unknown website template token: ${token}`);
    }

    return values[name];
  });
}

function copyWebsite(sourceDir, outputDir, values) {
  fs.mkdirSync(outputDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const outputPath = path.join(outputDir, entry.name);

    if (entry.isDirectory()) {
      copyWebsite(sourcePath, outputPath, values);
    } else if (entry.isFile()) {
      if (path.extname(entry.name).toLowerCase() === '.html') {
        const html = fs.readFileSync(sourcePath, 'utf8');
        fs.writeFileSync(outputPath, renderHtml(html, values), 'utf8');
      } else {
        fs.copyFileSync(sourcePath, outputPath);
      }
    } else {
      throw new Error(`Unsupported website entry: ${sourcePath}`);
    }
  }
}

function buildWebsite(sourceDir, outputDir, packageVersion) {
  copyWebsite(sourceDir, outputDir, getTemplateValues(packageVersion));
}

if (require.main === module) {
  const rootDir = path.resolve(__dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const outputDir = path.join(rootDir, 'website-build');

  buildWebsite(path.join(rootDir, 'website'), outputDir, packageJson.version);
  console.log(`Built website for Tagline ${packageJson.version} in ${outputDir}`);
}

module.exports = { buildWebsite, getTemplateValues, renderHtml };
