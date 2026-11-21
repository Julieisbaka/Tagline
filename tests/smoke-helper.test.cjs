const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runSmoke, scenario, formatFailure } = require('./helpers/smoke.cjs');
const { temporaryDirectory } = require('./helpers/temporary.cjs');

test('smoke launcher passes an isolated root and cleans it after successful and failing processes', async (t) => {
  const fixture = await temporaryDirectory(t, 'tagline-smoke-helper-');
  for (const exitCode of [0, 7]) {
    const rootFile = path.join(fixture, `root-${exitCode}`);
    const script = path.join(fixture, `child-${exitCode}.cjs`);
    fs.writeFileSync(
      script,
      `require('node:fs').writeFileSync(${JSON.stringify(rootFile)}, process.env.TEST_SMOKE_ROOT); process.exitCode = ${exitCode};`
    );
    assert.equal(
      runSmoke({
        script,
        prefix: 'tagline-helper-child-',
        rootEnv: 'TEST_SMOKE_ROOT',
        executable: process.execPath,
      }),
      exitCode,
      `child exit code ${exitCode}`
    );
    const root = fs.readFileSync(rootFile, 'utf8');
    assert.match(path.basename(root), /^tagline-helper-child-/);
    assert.equal(fs.existsSync(root), false, `root removed after exit ${exitCode}`);
  }
});

test('smoke launcher reports spawn errors and cleans the isolated root', async (t) => {
  const fixture = await temporaryDirectory(t, 'tagline-smoke-missing-');
  const prefix = `tagline-helper-error-${process.pid}-${Date.now()}-`;
  assert.throws(
    () =>
      runSmoke({
        script: path.join(fixture, 'child.cjs'),
        prefix,
        rootEnv: 'TEST_SMOKE_ROOT',
        executable: path.join(fixture, 'missing-executable'),
      }),
    (error) => {
      assert.match(error.message, /Could not run child\.cjs/);
      assert.equal(error.cause.code, 'ENOENT');
      return true;
    }
  );
  assert.deepEqual(
    fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(prefix)),
    []
  );
});

test('scenario failure includes its description and preserves the original assertion', async () => {
  const cause = new assert.AssertionError({ message: 'expected a link' });
  await assert.rejects(
    scenario('flow card links', () => {
      throw cause;
    }),
    (error) => {
      assert.match(error.message, /flow card links/);
      assert.equal(error.cause, cause);
      assert.match(formatFailure(error), /Scenario failed: flow card links/);
      assert.match(formatFailure(error), /AssertionError.*expected a link/);
      return true;
    }
  );
});
