const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function nativeBinaries(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return nativeBinaries(full);
    }
    return /\.(node|dylib|so)$/.test(entry.name) ? [full] : [];
  });
}

// Unsigned arm64 apps are reported as damaged and mismatched signatures can hang launch,
// so builds without a Developer ID certificate get a consistent ad-hoc signature.
exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }
  if (process.env.CSC_LINK || process.env.CSC_NAME) {
    return;
  }
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const codesign = (...args) =>
    execFileSync('codesign', ['--force', '--sign', '-', ...args], { stdio: 'inherit' });
  for (const file of nativeBinaries(path.join(app, 'Contents', 'Resources', 'app.asar.unpacked'))) {
    codesign(file);
  }
  codesign('--deep', app);
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
