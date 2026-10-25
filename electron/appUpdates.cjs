const fs = require('node:fs/promises');
const { createWriteStream, createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawn } = require('node:child_process');
const { checkForUpdates } = require('./installation.cjs');

const MAX_INSTALLER_BYTES = 1024 * 1024 * 1024;

async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function launchInstaller({ file, platform, shell, spawnProcess = spawn, processId = process.pid }) {
  if (platform === 'darwin') {
    const error = await shell.openPath(file);
    if (error) throw new Error(error);
    return { manual: true };
  }
  if (platform !== 'win32') throw new Error('In-app installation is not supported on this operating system.');
  const script = [
    '$ErrorActionPreference = "Stop"',
    'while (Get-Process -Id ([int]$env:TAGLINE_PARENT_PID) -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 250 }',
    'Start-Process -FilePath $env:TAGLINE_UPDATE_INSTALLER',
  ].join('; ');
  await new Promise((resolve, reject) => {
    const child = spawnProcess('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script,
    ], {
      detached: true, stdio: 'ignore', windowsHide: true, cwd: path.dirname(file),
      env: { ...process.env, TAGLINE_PARENT_PID: String(processId), TAGLINE_UPDATE_INSTALLER: file },
    });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
  return { manual: false };
}

function createUpdateManager({
  app, shell, notify = () => {}, fetchImpl = fetch, platform = process.platform, arch = process.arch,
  install = launchInstaller,
}) {
  let state = { status: 'idle', release: null, received: 0, total: 0, error: '' };
  let downloaded = null;
  const setState = (patch) => {
    state = { ...state, ...patch };
    notify({ ...state });
    return { ...state };
  };
  const busy = () => ['checking', 'downloading', 'installing'].includes(state.status);
  const getState = () => ({ ...state });
  async function check(currentVersion) {
    if (busy()) throw new Error('An update operation is already in progress.');
    setState({ status: 'checking', error: '' });
    try {
      const release = await checkForUpdates(currentVersion, fetchImpl, platform, arch);
      if (downloaded && downloaded.version !== release.latestVersion) {
        await fs.rm(downloaded.file, { force: true });
        downloaded = null;
      }
      setState({ status: downloaded ? 'ready' : 'idle', release, received: 0, total: 0 });
      return release;
    } catch (error) {
      setState({ status: 'error', error: error.message });
      throw error;
    }
  }
  async function download() {
    if (!app.isPackaged) throw new Error('Update downloads are available only in packaged installations.');
    if (busy()) throw new Error('An update operation is already in progress.');
    const release = state.release;
    const asset = release?.download;
    if (!release?.updateAvailable || !asset) throw new Error('Check for a compatible published update first.');
    if (asset.size > MAX_INSTALLER_BYTES) throw new Error('The update installer exceeds the download size limit.');
    if (downloaded?.version === release.latestVersion) return setState({ status: 'ready', error: '' });
    setState({ status: 'downloading', received: 0, total: asset.size, error: '' });
    let directory;
    try {
      const response = await fetchImpl(asset.checksumsUrl, { signal: AbortSignal.timeout(15000), credentials: 'omit' });
      if (!response.ok) throw new Error(`Could not download update checksums (HTTP ${response.status}).`);
      const chunks = [];
      let checksumBytes = 0;
      for await (const chunk of Readable.fromWeb(response.body)) {
        checksumBytes += chunk.length;
        if (checksumBytes > 65536) throw new Error('Update checksum file is too large.');
        chunks.push(chunk);
      }
      const matches = Buffer.concat(chunks).toString('utf8').split(/\r?\n/)
        .map((line) => /^([a-f0-9]{64}) {2}(.+)$/i.exec(line)).filter((match) => match?.[2] === asset.name);
      if (matches.length !== 1) throw new Error('The release does not contain a unique checksum for this installer.');
      const expectedHash = matches[0][1].toLowerCase();
      directory = await fs.mkdtemp(path.join(app.getPath('temp'), 'tagline-update-'));
      const file = path.join(directory, asset.name);
      const installer = await fetchImpl(asset.url, { signal: AbortSignal.timeout(10 * 60 * 1000), credentials: 'omit' });
      if (!installer.ok) throw new Error(`Could not download update installer (HTTP ${installer.status}).`);
      let received = 0;
      let notified = 0;
      const hash = createHash('sha256');
      const progress = new Transform({
        transform(chunk, _encoding, callback) {
          received += chunk.length;
          if (received > asset.size) return callback(new Error('Update download is larger than expected.'));
          hash.update(chunk);
          if (Date.now() - notified >= 100 || received === asset.size) {
            notified = Date.now();
            setState({ received });
          }
          callback(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(installer.body), progress, createWriteStream(`${file}.partial`, { flags: 'wx' }));
      if (received !== asset.size || hash.digest('hex') !== expectedHash) {
        throw new Error('Update verification failed. Download the update again.');
      }
      await fs.rename(`${file}.partial`, file);
      downloaded = { file, expectedHash, version: release.latestVersion };
      return setState({ status: 'ready', received: asset.size });
    } catch (error) {
      if (directory) await fs.rm(directory, { recursive: true, force: true });
      setState({ status: 'error', error: error.message, received: 0 });
      throw error;
    }
  }
  async function installUpdate(beforeInstall) {
    if (!app.isPackaged || busy() || !downloaded) throw new Error('Download and verify an update before installing.');
    setState({ status: 'installing', error: '' });
    try {
      await beforeInstall();
      let checksum;
      try { checksum = await fileHash(downloaded.file); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        downloaded = null;
        throw new Error('Downloaded installer is missing. Download the update again.');
      }
      if (checksum !== downloaded.expectedHash) {
        await fs.rm(downloaded.file, { force: true });
        downloaded = null;
        throw new Error('Downloaded installer changed. Download the update again.');
      }
      const result = await install({ file: downloaded.file, platform, shell });
      setState({ status: result.manual ? 'ready' : 'installing' });
      return result;
    } catch (error) {
      setState({ status: 'error', error: error.message });
      throw error;
    }
  }
  return { check, download, installUpdate, getState };
}

module.exports = { createUpdateManager, launchInstaller };
