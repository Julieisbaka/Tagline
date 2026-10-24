const os = require('node:os');
const { version } = require('../package.json');

function installationInfo(app) {
  return {
    version: app.isPackaged ? app.getVersion() : version,
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    osVersion: os.release(),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    executable: app.getPath('exe'),
    profile: app.getPath('userData'),
  };
}

module.exports = { installationInfo };
