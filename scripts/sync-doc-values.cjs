const fs = require('node:fs');
const path = require('node:path');
const { loadSources, renderHtml } = require('./build-website.cjs');

const VALUE_PATTERN = /\{\/\* TAGLINE:([^{}]+) \*\/\}([\s\S]*?)\{\/\* \/TAGLINE \*\/\}/g;

function syncValues(content, sources) {
  const updated = content.replace(VALUE_PATTERN, (match, token) => {
    const value = renderHtml(`{{TAGLINE:${token}}}`, sources);
    return `{/* TAGLINE:${token} */}${value}{/* /TAGLINE */}`;
  });
  const withoutValues = updated.replace(VALUE_PATTERN, '');
  if (
    withoutValues.includes('/* TAGLINE:') ||
    withoutValues.includes('/* /TAGLINE') ||
    withoutValues.includes('{{TAGLINE:')
  ) {
    throw new Error('Malformed or unrendered documentation value marker.');
  }
  return updated;
}

async function syncDocs(rootDir, check = false) {
  const sources = await loadSources(rootDir);
  const docsDir = path.join(rootDir, 'docs');
  const stale = [];
  for (const file of fs.readdirSync(docsDir).filter((name) => name.endsWith('.mdx'))) {
    const filePath = path.join(docsDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const updated = syncValues(content, sources);
    if (updated !== content) {
      stale.push(file);
      if (!check) {
        fs.writeFileSync(filePath, updated, 'utf8');
      }
    }
  }
  if (check && stale.length) {
    throw new Error(`Stale documentation values: ${stale.join(', ')}. Run npm run sync:docs.`);
  }
  return stale;
}

if (require.main === module) {
  syncDocs(path.resolve(__dirname, '..'), process.argv.includes('--check')).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { syncValues, syncDocs };
