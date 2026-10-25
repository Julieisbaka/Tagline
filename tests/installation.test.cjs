const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { uninstallApplication } = require('../electron/uninstall.cjs');
const { checkForUpdates, compareVersions } = require('../electron/installation.cjs');

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
  for (const [status, message] of [[404, /No published/], [403, /rate limit/], [429, /rate limit/], [500, /HTTP 500/]]) {
    await assert.rejects(checkForUpdates('1.0.0', async () => ({ ok: false, status })), message);
  }
  await assert.rejects(checkForUpdates('1.0.0', async () => ({ ok: true, json: async () => ({ tag_name: 'broken' }) })), /semantic/);
  await assert.rejects(checkForUpdates('1.0.0', async () => { throw new Error('Network unavailable'); }), /Network unavailable/);
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

test('Windows uninstall waits for app exit and removes profile only after successful uninstall', async () => {
  const state = harness();
  const result = await uninstallApplication({
    ...state,
    removeProfile: true,
    platform: 'win32',
    processId: 4321,
    fileSystem: { access: async () => {} },
    environment: {},
  });

  assert.deepEqual(result, { manual: false });
  const [, command, args, options] = state.calls.find(([kind]) => kind === 'spawn');
  assert.equal(command, 'powershell.exe');
  assert.ok(args.includes('-Command'));
  assert.match(args[args.indexOf('-Command') + 1], /Start-Process -FilePath.*-Wait/);
  assert.match(args[args.indexOf('-Command') + 1], /-not \(Test-Path/);
  assert.equal(options.env.TAGLINE_PARENT_PID, '4321');
  assert.equal(options.env.TAGLINE_REMOVE_PROFILE, '1');
  assert.equal(options.env.TAGLINE_PROFILE, state.app.getPath('userData'));
  assert.deepEqual(state.calls.some(([kind]) => kind === 'reveal'), false);
});

test('Windows uninstall reports a missing uninstaller without starting cleanup', async () => {
  const state = harness();
  await assert.rejects(uninstallApplication({
    ...state,
    removeProfile: false,
    platform: 'win32',
    fileSystem: { access: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } },
  }), /uninstaller could not be found/i);
  assert.equal(state.calls.some(([kind]) => kind === 'spawn'), false);
});

test('macOS reveals the app and schedules only profile removal when requested', async () => {
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
