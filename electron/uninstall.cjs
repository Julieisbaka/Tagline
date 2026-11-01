const path = require('node:path');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');

function startDetached(spawnProcess, command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, { ...options, detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function uninstallApplication({
  app,
  shell,
  removeProfile,
  platform = process.platform,
  processId = process.pid,
  spawnProcess = spawn,
  fileSystem = fs,
  environment = process.env,
}) {
  if (typeof removeProfile !== 'boolean') throw new Error('Invalid profile removal choice.');
  if (!app.isPackaged) throw new Error('Uninstall is only available in packaged builds.');

  const executable = app.getPath('exe');
  const profile = app.getPath('userData');
  const options = { detached: true, stdio: 'ignore', windowsHide: true };

  if (platform === 'win32') {
    const uninstaller = path.join(path.dirname(executable), 'Uninstall Tagline.exe');
    try {
      await fileSystem.access(uninstaller);
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error('The Tagline uninstaller could not be found.');
      throw error;
    }
    const script = [
      '$ErrorActionPreference = "Stop"',
      '$parentId = [int]$env:TAGLINE_PARENT_PID',
      'while (Get-Process -Id $parentId -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 250 }',
      'Set-Location -LiteralPath $env:TEMP',
      '$uninstall = Start-Process -FilePath $env:TAGLINE_UNINSTALLER -ArgumentList "/S" -Wait -PassThru',
      'if ($uninstall.ExitCode -ne 0) { throw "The Tagline uninstaller failed with exit code $($uninstall.ExitCode)." }',
      'if ($env:TAGLINE_REMOVE_PROFILE -eq "1" -and -not (Test-Path -LiteralPath $env:TAGLINE_APP_EXECUTABLE)) {',
      '  Remove-Item -LiteralPath $env:TAGLINE_PROFILE -Recurse -Force -ErrorAction Stop',
      '}',
    ].join('; ');
    await startDetached(spawnProcess, 'powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script,
    ], {
      ...options,
      env: {
        ...environment,
        TAGLINE_PARENT_PID: String(processId),
        TAGLINE_UNINSTALLER: uninstaller,
        TAGLINE_APP_EXECUTABLE: executable,
        TAGLINE_PROFILE: profile,
        TAGLINE_REMOVE_PROFILE: removeProfile ? '1' : '0',
      },
    });
    return { manual: false };
  }

  if (removeProfile) {
    await startDetached(spawnProcess, 'sh', [
      '-c',
      'while kill -0 "$1" 2>/dev/null; do sleep 1; done; if [ "$2" = "1" ]; then rm -rf "$3"; fi',
      'tagline-profile-cleanup',
      String(processId),
      '1',
      profile,
    ], options);
  }
  let revealTarget = environment.APPIMAGE || executable;
  if (platform === 'darwin') {
    let parent = path.posix.resolve(executable);
    while (path.posix.dirname(parent) !== parent && path.posix.extname(parent) !== '.app')
      parent = path.posix.dirname(parent);
    if (path.posix.extname(parent) !== '.app') parent = executable;
    revealTarget = parent;
  }
  shell.showItemInFolder(revealTarget);
  return { manual: true };
}

module.exports = { uninstallApplication };
