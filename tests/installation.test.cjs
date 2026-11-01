const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { uninstallApplication } = require('../electron/uninstall.cjs');
const { checkForUpdates, compareVersions } = require('../electron/installation.cjs');
const { createUpdateManager, launchInstaller } = require('../electron/appUpdates.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');

test('release comparison handles numeric versions, prereleases, prefixes and build metadata', () => {
  for (const [left, right, order] of [
    ['v1.10.0', '1.9.9', 1], ['1.0.0', 'v1.0.0', 0], ['1.0.0+build.2', '1.0.0+build.1', 0],
    ['1.0.0-beta.10', '1.0.0-beta.2', 1], ['1.0.0', '1.0.0-rc.1', 1],
    ['1.0.0-alpha', '1.0.0-alpha.1', -1], ['1.0.0-1', '1.0.0-alpha', -1],
    ['0.9.0', '1.0.0', -1],
  ]) assert.equal(compareVersions(left, right), order);
  for (const invalid of ['latest', '1.0', '01.0.0', '1.0.0-beta.01', null]) {
    assert.throws(() => compareVersions(invalid, '1.0.0'), /semantic version/);
  }
});

test('manual release checks use the public GitHub endpoint and report failures explicitly', async () => {
  let request;
  const result = await checkForUpdates('1.0.0', async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ tag_name: 'v1.1.0', draft: false, prerelease: false }) };
  });
  assert.equal(request.url, 'https://api.github.com/repos/Julieisbaka/Tagline/releases/latest');
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.redirect, 'error');
  assert.ok(request.options.signal);
  assert.deepEqual(result, { currentVersion: '1.0.0', latestVersion: 'v1.1.0', updateAvailable: true });
  const current = await checkForUpdates('2.0.0', async () => ({ ok: true, json: async () => ({ tag_name: 'v1.0.0' }) }));
  assert.equal(current.updateAvailable, false, 'a development build ahead of releases is not an update');
  for (const [status, message] of [[404, /accessible without signing in.*HTTP 404.*repository may be private/], [403, /rate limit/], [429, /rate limit/], [500, /HTTP 500/]]) {
    await assert.rejects(checkForUpdates('1.0.0', async () => ({ ok: false, status })), message);
  }
  await assert.rejects(checkForUpdates('1.0.0', async () => ({ ok: true, json: async () => ({ tag_name: 'broken' }) })), /semantic/);
  await assert.rejects(checkForUpdates('1.0.0', async () => { throw new Error('Network unavailable'); }), /Network unavailable/);
});

test('release downloads select the exact platform and architecture without trusting asset URLs', async () => {
  for (const [platform, arch, suffix] of [
    ['win32', 'x64', 'win-x64.exe'], ['darwin', 'arm64', 'mac-arm64.dmg'], ['darwin', 'x64', 'mac-x64.dmg'],
    ['win32', 'arm64', null], ['linux', 'x64', null],
  ]) {
    const name = `Tagline-2.0.0-${suffix}`;
    const result = await checkForUpdates('1.0.0', async () => ({
      ok: true, json: async () => ({
        tag_name: 'v2.0.0', assets: [{ name, size: 42, browser_download_url: 'https://untrusted.test/app.exe' },
        { name: 'SHA256SUMS.txt' }],
      }),
    }), platform, arch);
    if (!suffix) assert.equal(result.download, undefined);
    else assert.deepEqual(result.download, {
      name, size: 42, url: `https://github.com/Julieisbaka/Tagline/releases/download/v2.0.0/${name}`,
      checksumsUrl: 'https://github.com/Julieisbaka/Tagline/releases/download/v2.0.0/SHA256SUMS.txt',
    });
  }
});

async function updateHarness(t, { checksum, payload, size, packaged = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-update-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const data = Buffer.from('simulated installer bytes');
  const name = 'Tagline-2.0.0-win-x64.exe';
  const digest = createHash('sha256').update(data).digest('hex');
  const requests = [], states = [], installs = [];
  const manager = createUpdateManager({
    app: { isPackaged: packaged, getPath: () => root }, shell: {}, platform: 'win32', arch: 'x64',
    notify: (state) => states.push(state),
    install: async (options) => { installs.push(options); return { manual: false }; },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/latest')) return new Response(JSON.stringify({
        tag_name: 'v2.0.0', assets: [{ name, size: size ?? data.length }, { name: 'SHA256SUMS.txt' }],
      }));
      if (url.endsWith('SHA256SUMS.txt')) return new Response(checksum ?? `${digest}  ${name}\n`);
      return new Response(payload ?? data);
    },
  });
  return { root, manager, requests, states, installs, name, data };
}

test('platform: in-app updates are explicit, verified, progress-reporting, and saved before installation', async (t) => {
  const h = await updateHarness(t);
  assert.equal(h.requests.length, 0);
  await assert.rejects(h.manager.download(), /Check for/);
  await h.manager.check('1.0.0');
  assert.equal(h.requests.length, 1, 'checking does not download');
  const downloaded = await h.manager.download();
  assert.equal(downloaded.status, 'ready');
  assert.equal(downloaded.received, h.data.length);
  assert.ok(h.states.some((state) => state.status === 'downloading'));
  const file = path.join(h.root, (await fs.readdir(h.root))[0], h.name);
  assert.deepEqual(await fs.readFile(file), h.data);
  await assert.rejects(h.manager.installUpdate(async () => { throw new Error('Save failed'); }), /Save failed/);
  assert.equal(h.installs.length, 0, 'save failures must not start installation');
  await h.manager.download();
  let saved = false;
  assert.deepEqual(await h.manager.installUpdate(async () => { saved = true; }), { manual: false });
  assert.equal(saved, true);
  assert.equal(h.installs[0].file, file);
  assert.ok(h.requests.every(({ options }) => options.credentials === 'omit'));
});

test('platform: invalid, oversized, truncated and tampered update downloads never install', async (t) => {
  for (const options of [
    { checksum: 'invalid' }, { checksum: 'a'.repeat(64) + '  Tagline-2.0.0-win-x64.exe\n' },
    { payload: 'short' }, { payload: 'long'.repeat(100) }, { size: 1024 * 1024 * 1024 + 1 },
    { checksum: 'x'.repeat(65537) },
  ]) {
    const h = await updateHarness(t, options);
    await h.manager.check('1.0.0');
    await assert.rejects(h.manager.download());
    await assert.rejects(h.manager.installUpdate(async () => { }));
    assert.equal(h.installs.length, 0);
    assert.deepEqual(await fs.readdir(h.root), [], 'failed downloads are cleaned up');
  }
  const h = await updateHarness(t);
  await h.manager.check('1.0.0');
  await h.manager.download();
  const file = path.join(h.root, (await fs.readdir(h.root))[0], h.name);
  await fs.writeFile(file, 'tampered');
  await assert.rejects(h.manager.installUpdate(async () => { }), /installer changed/);
  assert.equal(h.installs.length, 0);
  await h.manager.download();
  await h.manager.installUpdate(async () => { });
  assert.deepEqual(await fs.readFile(h.installs[0].file), h.data);
  const dev = await updateHarness(t, { packaged: false });
  await dev.manager.check('1.0.0');
  await assert.rejects(dev.manager.download(), /packaged/);
});

test('platform: update operations reject overlapping work and do not launch a missing installer', async (t) => {
  let releaseCheck;
  const manager = createUpdateManager({
    app: { isPackaged: true }, shell: {},
    fetchImpl: () => new Promise((resolve) => { releaseCheck = resolve; }),
  });
  const checking = manager.check('1.0.0');
  await assert.rejects(manager.check('1.0.0'), /already in progress/);
  await assert.rejects(manager.download(), /already in progress/);
  releaseCheck(new Response(JSON.stringify({ tag_name: 'v1.0.0' })));
  await checking;
  const h = await updateHarness(t);
  await h.manager.check('1.0.0');
  await h.manager.download();
  const file = path.join(h.root, (await fs.readdir(h.root))[0], h.name);
  await fs.unlink(file);
  await assert.rejects(h.manager.installUpdate(async () => { }), /installer is missing/);
  assert.equal(h.installs.length, 0);
  await h.manager.download();
  assert.equal(h.manager.getState().status, 'ready', 'missing installers can be downloaded again');
});

test('update launch waits for Windows app exit and macOS reports open failures', async () => {
  let launched;
  const result = await launchInstaller({
    file: 'C:\\Temp\\Tagline update.exe', platform: 'win32', processId: 42,
    spawnProcess: (command, args, options) => {
      launched = { command, args, options };
      const child = new EventEmitter();
      child.unref = () => { };
      process.nextTick(() => child.emit('spawn'));
      return child;
    },
  });
  assert.deepEqual(result, { manual: false });
  assert.equal(launched.options.env.TAGLINE_UPDATE_INSTALLER, 'C:\\Temp\\Tagline update.exe');
  assert.equal(launched.options.env.TAGLINE_PARENT_PID, '42');
  assert.match(launched.args.at(-1), /while \(Get-Process/);
  assert.match(launched.args.at(-1), /Start-Process -FilePath \$env:TAGLINE_UPDATE_INSTALLER/);
  let opened;
  assert.deepEqual(await launchInstaller({
    file: '/tmp/Tagline.dmg', platform: 'darwin',
    shell: { openPath: async (file) => { opened = file; return ''; } }
  }), { manual: true });
  assert.equal(opened, '/tmp/Tagline.dmg');
  await assert.rejects(launchInstaller({
    file: '/tmp/Tagline.dmg', platform: 'darwin',
    shell: { openPath: async () => 'Cannot open disk image' }
  }), /Cannot open/);
});

function harness() {
  const calls = [];
  const app = {
    isPackaged: true,
    getPath: (name) => name === 'exe'
      ? 'C:\\Program Files\\Tagline\\Tagline.exe'
      : 'C:\\Users\\user\\AppData\\Roaming\\Tagline',
  };
  const shell = { showItemInFolder: (file) => calls.push(['reveal', file]) };
  const spawnProcess = (command, args, options) => {
    calls.push(['spawn', command, args, options]);
    const child = new EventEmitter();
    child.unref = () => calls.push(['unref']);
    process.nextTick(() => child.emit('spawn'));
    return child;
  };
  return { calls, app, shell, spawnProcess };
}

test('platform: Windows uninstall waits for app exit and removes profile only after successful uninstall', async () => {
  const state = harness();
  const result = await uninstallApplication({
    ...state,
    removeProfile: true,
    platform: 'win32',
    processId: 4321,
    fileSystem: { access: async () => { } },
    environment: {},
  });

  assert.deepEqual(result, { manual: false });
  const [, command, args, options] = state.calls.find(([kind]) => kind === 'spawn');
  assert.equal(command, 'powershell.exe');
  assert.ok(args.includes('-Command'));
  const script = args[args.indexOf('-Command') + 1];
  assert.match(script, /Start-Process -FilePath.*-ArgumentList "\/S" -Wait -PassThru/);
  assert.match(script, /ErrorActionPreference = "Stop"/);
  assert.match(script, /ExitCode -ne 0/);
  assert.ok(script.indexOf('ExitCode -ne 0') < script.indexOf('$env:TAGLINE_REMOVE_PROFILE'));
  assert.match(args[args.indexOf('-Command') + 1], /-not \(Test-Path/);
  assert.equal(options.env.TAGLINE_PARENT_PID, '4321');
  assert.equal(options.env.TAGLINE_REMOVE_PROFILE, '1');
  assert.equal(options.env.TAGLINE_PROFILE, state.app.getPath('userData'));
  assert.deepEqual(state.calls.some(([kind]) => kind === 'reveal'), false);
});

test('platform: Windows uninstall reports a missing uninstaller without starting cleanup', async () => {
  const state = harness();
  await assert.rejects(uninstallApplication({
    ...state,
    removeProfile: false,
    platform: 'win32',
    fileSystem: { access: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } },
  }), /uninstaller could not be found/i);
  assert.equal(state.calls.some(([kind]) => kind === 'spawn'), false);
});

test('platform: macOS reveals the app and schedules only profile removal when requested', async () => {
  const state = harness();
  state.app.getPath = (name) => name === 'exe'
    ? '/Applications/Tagline.app/Contents/MacOS/Tagline'
    : '/Users/user/Library/Application Support/Tagline';
  const result = await uninstallApplication({
    ...state,
    removeProfile: true,
    platform: 'darwin',
    processId: 987,
    environment: {},
  });

  assert.deepEqual(result, { manual: true });
  assert.deepEqual(state.calls.filter(([kind]) => kind === 'reveal'), [
    ['reveal', '/Applications/Tagline.app'],
  ]);
  const [, command, args] = state.calls.find(([kind]) => kind === 'spawn');
  assert.equal(command, 'sh');
  assert.equal(args[args.length - 1], state.app.getPath('userData'));
  assert.equal(args[args.length - 2], '1');
});

test('development builds and invalid choices cannot start uninstall', async () => {
  const state = harness();
  state.app.isPackaged = false;
  await assert.rejects(uninstallApplication({ ...state, removeProfile: false }), /packaged builds/i);
  state.app.isPackaged = true;
  await assert.rejects(uninstallApplication({ ...state, removeProfile: 'yes' }), /Invalid profile removal choice/);
  assert.equal(state.calls.length, 0);
});
