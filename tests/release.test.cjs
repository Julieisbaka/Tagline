const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const workflow = require('js-yaml').load(fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8'));
const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
const context = { repo: { owner: 'test', repo: 'tagline' }, sha: 'selected-commit' };
const missing = () => { throw Object.assign(new Error('Not found'), { status: 404 }); };
const core = { setOutput() { }, summary: { addLink() { return this; }, write() { } } };

test('release workflow runs only manually, packages all architectures and publishes only after every build', () => {
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(workflow.jobs.publish.needs, ['version', 'build']);
  assert.equal(workflow.jobs.publish.permissions.contents, 'write');
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.deepEqual(workflow.jobs.build.strategy.matrix.include.map(({ platform, arch }) => `${platform}-${arch}`),
    ['win-x64', 'mac-x64', 'mac-arm64']);
  assert.ok(workflow.jobs.build.steps.some((step) => step.run?.includes('--publish never')));
  assert.ok(workflow.jobs.build.steps.some((step) => step.run === 'npm run test:installation'));
});

function preflight({ version = '1.2.3', lockVersion = version, tagCommit, release, status = 404 } = {}) {
  const script = workflow.jobs.version.steps.find((step) => step.id === 'version').with.script;
  const outputs = {};
  return new AsyncFunction('require', 'github', 'context', 'core', script)((name) => {
    if (name === 'node:fs') return {
      readFileSync: (file) => JSON.stringify(file === 'package.json'
        ? { version } : { version: lockVersion, packages: { '': { version: lockVersion } } })
    };
    if (name === 'node:child_process') return {
      execFileSync: (_file, args) => args[0] === 'tag'
        ? tagCommit ? `v${version}\n` : '' : tagCommit
    };
    throw new Error(`Unexpected import: ${name}`);
  }, {
    rest: {
      repos: {
        getReleaseByTag: async () => {
          if (!release) throw Object.assign(new Error('API error'), { status });
          return { data: release };
        }
      }
    }
  }, context, { setOutput: (key, value) => { outputs[key] = value; } }).then(() => outputs);
}

test('release preflight uses package version and refuses mismatched locks, tags and published releases', async () => {
  assert.deepEqual(await preflight(), { version: '1.2.3', tag: 'v1.2.3' });
  assert.deepEqual(await preflight({ tagCommit: context.sha, release: { draft: true } }),
    { version: '1.2.3', tag: 'v1.2.3' });
  await assert.rejects(preflight({ lockVersion: '1.2.2' }), /package-lock/);
  await assert.rejects(preflight({ tagCommit: 'another-commit' }), /another commit/);
  await assert.rejects(preflight({ release: { draft: false } }), /already published/);
  await assert.rejects(preflight({ release: { draft: true, target_commitish: 'another-commit' } }), /draft for another commit/);
  await assert.rejects(preflight({ status: 403 }), /API error/);
});

async function publish({ draft, failUpload, extraFile, previous = true } = {}) {
  const script = workflow.jobs.publish.steps.find((step) => step.with?.script).with.script;
  const files = Object.fromEntries(['win-x64.exe', 'mac-x64.dmg', 'mac-arm64.dmg']
    .map((suffix) => [`Tagline-1.2.3-${suffix}`, Buffer.from(suffix)]));
  if (extraFile) files[extraFile] = Buffer.from('unexpected');
  const calls = [];
  const repos = {
    getReleaseByTag: async () => draft === undefined ? missing() : { data: {
      id: 10, draft, html_url: 'https://example.test/release',
      body: 'Handwritten release notes.\n\n<!-- tagline-release-commits -->\nOutdated commit list',
    } },
    generateReleaseNotes: async () => ({ data: { body: 'Changes' } }),
    createRelease: async (options) => {
      calls.push(['create', options]);
      return { data: { id: 10, draft: true, html_url: 'https://example.test/release' } };
    },
    listReleaseAssets() { },
    listReleases() { },
    deleteReleaseAsset: async (options) => { calls.push(['delete', options]); },
    uploadReleaseAsset: async (options) => {
      if (failUpload) throw new Error('Upload failed');
      calls.push(['upload', options]);
    },
    updateRelease: async (options) => { calls.push(['publish', options]); },
  };
  const execute = () => new AsyncFunction('require', 'github', 'context', 'core', 'process', script)((name) => {
    if (name === 'node:crypto') return { createHash };
    if (name === 'node:child_process') return {
      execFileSync: (_file, args) => {
        if (args[0] === 'merge-base') {
          if (args[2] === 'refs/tags/v9.9.9') throw Object.assign(new Error('Unrelated branch'), { status: 1 });
          return '';
        }
        calls.push(['log', args]);
        return 'abc123456789\0Fix a setting\nfed987654321\0Add [links] and *formatting*\n';
      }
    };
    if (name === 'node:fs') return {
      readdirSync: () => Object.keys(files),
      readFileSync: (file) => files[file.replace('artifacts/', '')],
      writeFileSync: (file, text) => { files[file.replace('artifacts/', '')] = Buffer.from(text); },
    };
    throw new Error(`Unexpected import: ${name}`);
  }, { rest: { repos }, paginate: async (method) => method === repos.listReleases
    ? previous ? [{ draft: true, tag_name: 'v1.2.4' }, { draft: false, tag_name: 'v9.9.9' },
      { draft: false, tag_name: 'v1.2.2' }] : []
    : draft ? [{ id: 99 }] : [] }, context, core,
    { env: { VERSION: '1.2.3', TAG: 'v1.2.3' } });
  return { execute, files, calls };
}

test('release uploads exactly three installers and correct checksums before publishing', async () => {
  const { execute, files, calls } = await publish();
  await execute();
  const created = calls.find(([name]) => name === 'create')[1];
  assert.equal(created.draft, true);
  assert.equal(created.target_commitish, context.sha);
  assert.match(created.body, /What's changed.*commits/);
  assert.match(created.body, /Fix a setting.*https:\/\/github.com\/test\/tagline\/commit\/abc123456789/);
  assert.ok(created.body.includes('Add \\[links\\] and \\*formatting\\*'));
  assert.ok(calls.find(([name]) => name === 'log')[1].includes('refs/tags/v1.2.2..selected-commit'));
  assert.equal(calls.filter(([name]) => name === 'upload').length, 4);
  const checksums = files['SHA256SUMS.txt'].toString();
  for (const [file, data] of Object.entries(files)) {
    if (file !== 'SHA256SUMS.txt')
      assert.ok(checksums.includes(`${createHash('sha256').update(data).digest('hex')}  ${file}\n`));
  }
  assert.equal(calls.at(-1)[0], 'publish');
  assert.equal(calls.at(-1)[1].draft, false);
});

test('release resumes drafts and never publishes partial, unexpected or already published builds', async () => {
  const resumed = await publish({ draft: true });
  await resumed.execute();
  assert.ok(resumed.calls.some(([name]) => name === 'delete'));
  assert.equal(resumed.calls.some(([name]) => name === 'create'), false);
  assert.match(resumed.calls.at(-1)[1].body, /Fix a setting/);
  assert.match(resumed.calls.at(-1)[1].body, /Handwritten release notes/);
  assert.doesNotMatch(resumed.calls.at(-1)[1].body, /Outdated commit list/);
  const initial = await publish({ previous: false });
  await initial.execute();
  assert.ok(initial.calls.find(([name]) => name === 'log')[1].includes(context.sha));
  for (const options of [{ failUpload: true }, { extraFile: 'extra.exe' }, { draft: false }]) {
    const attempt = await publish(options);
    await assert.rejects(attempt.execute());
    assert.equal(attempt.calls.some(([name]) => name === 'publish'), false);
  }
});
