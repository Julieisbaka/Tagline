const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { temporaryDirectory } = require('./helpers/temporary.cjs');

async function fixture(t) {
  const root = await temporaryDirectory(t, 'tagline-test-runner-');
  await fs.mkdir(path.join(root, 'scripts'));
  await fs.copyFile(
    path.join(__dirname, '../scripts/run-all-tests.cjs'),
    path.join(root, 'scripts/run-all-tests.cjs')
  );
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      scripts: { test: '', 'test:all': '', 'test:a': '', 'test:b': '', 'test:c': '' },
    })
  );
  const cli = path.join(root, 'fake-npm.cjs');
  await fs.writeFile(
    cli,
    `
    const fs = require('node:fs');
    const name = process.argv[3];
    const event = (phase) => fs.appendFileSync(process.env.EVENT_LOG, phase + ':' + name + '\\n');
    event('start');
    const finish = () => {
      event('end');
      if (name === 'test') console.log('# tests 1\\n# pass 1\\n# fail 0\\n# skipped 0\\n# cancelled 0');
      if (name === process.env.FAIL_SUITE) {
        if (process.env.SCENARIO_FAILURE) console.error('Error: Scenario failed: flow card links\\nCaused by: AssertionError: expected a link');
        process.exitCode = 1;
      }
    };
    const barrier = process.env.TEST_BARRIER && (name === 'build' ? 'test' : name === 'test' ? 'test:a' : '');
    if (barrier) {
      const timer = setInterval(() => {
        if (fs.readFileSync(process.env.EVENT_LOG, 'utf8').includes('start:' + barrier + '\\n')) {
          clearInterval(timer);
          finish();
        }
      }, 10);
    } else {
      setTimeout(finish, Number(process.env.SMOKE_DELAY || 30));
    }
  `
  );
  const run = (args, env = {}) =>
    spawnSync(process.execPath, [path.join(root, 'scripts/run-all-tests.cjs'), ...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, npm_execpath: cli, EVENT_LOG: path.join(root, 'events'), ...env },
    });
  return {
    root,
    run,
    events: async () => (await fs.readFile(path.join(root, 'events'), 'utf8')).trim().split('\n'),
  };
}

test('unit suite overlaps the build and smoke suites', async (t) => {
  const f = await fixture(t);
  const result = f.run([], { TAGLINE_TEST_DIST_READY: '0', TEST_BARRIER: '1' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const events = await f.events();
  assert.ok(events.indexOf('start:test') < events.indexOf('end:build'));
  assert.ok(events.indexOf('start:test:a') < events.indexOf('end:test'));
  assert.ok(events.indexOf('end:test:a') < events.indexOf('start:test:b'));
});

test('bail stops scheduling after a failure and skips an already prepared build', async (t) => {
  const f = await fixture(t);
  const result = f.run(['--skip-unit', '--bail'], {
    TAGLINE_TEST_DIST_READY: '1',
    FAIL_SUITE: 'test:a',
  });
  assert.equal(result.status, 1);
  assert.deepEqual(await f.events(), ['start:test:a', 'end:test:a']);
  assert.match(result.stdout, /Suites not run: 2/);
});

test('jobs option runs independent smoke suites concurrently', async (t) => {
  const f = await fixture(t);
  const result = f.run(['--skip-unit', '--jobs=2'], {
    TAGLINE_TEST_DIST_READY: '1',
    SMOKE_DELAY: '500',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const events = await f.events();
  assert.ok(events.indexOf('start:test:b') < events.indexOf('end:test:a'));
});

test('shards cover different suites and invalid options fail', async (t) => {
  const f = await fixture(t);
  const result = f.run(['--skip-unit', '--shard=2/2'], { TAGLINE_TEST_DIST_READY: '1' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(await f.events(), ['start:test:b', 'end:test:b']);
  assert.equal(f.run(['--shard=0/2']).status, 2);
  assert.equal(f.run(['--jobs=0']).status, 2);
});

test('failure log retains the scenario description and its assertion cause', async (t) => {
  const f = await fixture(t);
  const result = f.run(['--skip-unit', '--bail'], {
    TAGLINE_TEST_DIST_READY: '1',
    FAIL_SUITE: 'test:a',
    SCENARIO_FAILURE: '1',
  });
  assert.equal(result.status, 1);
  const log = await fs.readFile(path.join(f.root, 'test-all.log'), 'utf8');
  assert.match(log, /Scenario failed: flow card links/);
  assert.match(log, /AssertionError: expected a link/);
});
