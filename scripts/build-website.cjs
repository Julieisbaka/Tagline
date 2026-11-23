const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// The documentation value sync uses {{TAGLINE:KIND:argument}} tokens resolved from code:
//   SETTING:key           default from src/lib/settings/defaultSettings.json
//   KEY:id                default shortcut from src/lib/commands/keybindings.json (Mod = Ctrl/Cmd)
//   KEY_WIN:id / KEY_MAC:id  the same shortcut with Mod written as Ctrl / Cmd
//   LIMIT:key[.min|.max]  customization limit from electron/customization.mjs (default if omitted)
//   CONST:path#NAME       numeric constant declared in a source file, relative to the repository root
const TOKEN_PATTERN = /\{\{TAGLINE:([^{}]*)\}\}/g;

async function loadSources(rootDir) {
  const readJson = (file) => JSON.parse(fs.readFileSync(path.join(rootDir, file), 'utf8'));
  const customization = await import(
    pathToFileURL(path.join(rootDir, 'electron', 'customization.mjs')).href
  );

  return {
    rootDir,
    settings: readJson('src/lib/settings/defaultSettings.json'),
    keybindings: readJson('src/lib/commands/keybindings.json'),
    limits: customization.LIMIT_DEFINITIONS,
  };
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatNumber(value) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 20 });
}

function formatPrimitive(value, token) {
  if (typeof value === 'number') {
    return formatNumber(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'on' : 'off';
  }
  if (typeof value === 'string') {
    return escapeHtml(value);
  }
  throw new Error(`Website template value is not a number, boolean, or string: ${token}`);
}

function formatKey(key, modifier) {
  return key
    .split('+')
    .map((part) => {
      if (part === 'Mod') {
        return modifier;
      }
      if (part === 'Escape') {
        return 'Esc';
      }
      return part.replace(/^Arrow/, '');
    })
    .join('+');
}

function resolveKey(id, sources, modifier, token) {
  const binding = sources.keybindings.find((entry) => entry.id === id);
  if (!binding) {
    throw new Error(`Unknown shortcut in website template: ${token}`);
  }
  if (!binding.key) {
    throw new Error(`Shortcut has no default key in website template: ${token}`);
  }
  return escapeHtml(formatKey(binding.key, modifier));
}

function resolveLimit(argument, sources, token) {
  const [name, field = 'default', ...extra] = argument.split('.');
  const definition = Object.hasOwn(sources.limits, name) ? sources.limits[name] : undefined;
  if (!definition || extra.length > 0 || !['default', 'min', 'max'].includes(field)) {
    throw new Error(`Unknown limit in website template: ${token}`);
  }
  return formatNumber(definition[field]);
}

function resolveConstant(argument, sources, token) {
  const [file, name] = argument.split('#');
  const filePath = path.resolve(sources.rootDir, file || '');
  const relative = path.relative(sources.rootDir, filePath);
  if (!file || !/^[A-Z][A-Z0-9_]*$/.test(name || '') || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Invalid constant in website template: ${token}`);
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`Unknown constant file in website template: ${token}`);
  }

  const declaration = new RegExp(
    `^(?:export\\s+)?const\\s+${name}\\s*=\\s*(\\d[\\d_]*(?:\\s*\\*\\s*\\d[\\d_]*)*)\\s*;`,
    'm'
  ).exec(fs.readFileSync(filePath, 'utf8'));
  if (!declaration) {
    throw new Error(`Numeric constant not found for website template: ${token}`);
  }

  const value = declaration[1]
    .split('*')
    .reduce((product, factor) => product * Number(factor.trim().replace(/_/g, '')), 1);
  return formatNumber(value);
}

function resolveToken(body, sources, token) {
  const separator = body.indexOf(':');
  const kind = separator === -1 ? body : body.slice(0, separator);
  const argument = separator === -1 ? '' : body.slice(separator + 1);

  switch (kind) {
    case 'SETTING':
      if (!Object.hasOwn(sources.settings, argument)) {
        throw new Error(`Unknown setting in website template: ${token}`);
      }
      return formatPrimitive(sources.settings[argument], token);
    case 'KEY':
      return resolveKey(argument, sources, 'Mod', token);
    case 'KEY_WIN':
      return resolveKey(argument, sources, 'Ctrl', token);
    case 'KEY_MAC':
      return resolveKey(argument, sources, 'Cmd', token);
    case 'LIMIT':
      return resolveLimit(argument, sources, token);
    case 'CONST':
      return resolveConstant(argument, sources, token);
    default:
      throw new Error(`Unknown website template token: ${token}`);
  }
}

function renderHtml(html, sources) {
  return html.replace(TOKEN_PATTERN, (token, body) => resolveToken(body, sources, token));
}

function copyWebsite(sourceDir, outputDir, sources) {
  fs.mkdirSync(outputDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const outputPath = path.join(outputDir, entry.name);

    if (entry.isDirectory()) {
      copyWebsite(sourcePath, outputPath, sources);
    } else if (entry.isFile()) {
      if (path.extname(entry.name).toLowerCase() === '.html') {
        const html = fs.readFileSync(sourcePath, 'utf8');
        fs.writeFileSync(outputPath, renderHtml(html, sources), 'utf8');
      } else {
        fs.copyFileSync(sourcePath, outputPath);
      }
    } else {
      throw new Error(`Unsupported website entry: ${sourcePath}`);
    }
  }
}

function buildWebsite(sourceDir, outputDir, sources) {
  copyWebsite(sourceDir, outputDir, sources);
}

if (require.main === module) {
  const rootDir = path.resolve(__dirname, '..');
  const outputDir = path.join(rootDir, 'website-build');

  loadSources(rootDir)
    .then((sources) => {
      fs.rmSync(outputDir, { recursive: true, force: true });
      buildWebsite(path.join(rootDir, 'website'), outputDir, sources);
      console.log(`Built website in ${outputDir}`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = { buildWebsite, loadSources, renderHtml };
