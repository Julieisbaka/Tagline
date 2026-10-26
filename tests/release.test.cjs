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

test('packaging retains only target ONNX binaries and preserves runtime dependencies', () => {
  const { getNodeModuleFileMatcher } = require('app-builder-lib/out/fileMatcher');
  const { build } = require('../package.json');
  const root = path.resolve(__dirname, '..');
  const platforms = { win: 'win32', mac: 'darwin', linux: 'linux' };
  const architectures = ['x64', 'arm64'];
  const fileStat = { isDirectory: () => false };
  const directoryStat = { isDirectory: () => true };
  for (const [target, platform] of Object.entries(platforms)) {
    for (const arch of architectures) {
      const matcher = getNodeModuleFileMatcher(root, root, (pattern) => pattern.replaceAll('${arch}', arch),
        build[target], { config: build, debugLogger: { isEnabled: false } });
      const accepts = matcher.createFilter();
      for (const os of Object.values(platforms)) {
        for (const cpu of architectures) {
          for (const napi of ['napi-v6', 'napi-v7']) {
            for (const file of ['onnxruntime_binding.node', 'onnxruntime.dll', 'libonnxruntime.so.1',
              'libonnxruntime.dylib', 'DirectML.dll', 'dxcompiler.dll', 'dxil.dll']) {
              const relative = path.join('node_modules', 'onnxruntime-node', 'bin', napi, os, cpu, file);
              assert.equal(accepts(path.join(root, relative), fileStat), os === platform && cpu === arch,
                `${target}-${arch}: ${relative}`);
            }
          }
        }
      }
      for (const relative of [
        'node_modules/onnxruntime-node/package.json',
        'node_modules/onnxruntime-node/dist/binding.js',
        'node_modules/onnxruntime-common/dist/cjs/index.js',
        'node_modules/@huggingface/transformers/dist/transformers.node.mjs',
        'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
      ]) {
        assert.ok(accepts(path.resolve(root, relative), fileStat), `${target}-${arch}: keep ${relative}`);
      }
      const nativeDir = path.join(root, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', platform, arch);
      for (let dir = nativeDir; dir !== root; dir = path.dirname(dir)) {
        if (path.basename(dir) !== 'node_modules') {
          assert.ok(accepts(dir, directoryStat), `${target}-${arch}: traverse ${dir}`);
        }
      }
    }
  }
});

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

test('release tests shared logic once and gates every platform build on it', () => {
  const { scripts } = require('../package.json');
  assert.equal(scripts.test, 'node --test "tests/*.test.cjs"');
  assert.equal(scripts['test:shared'], 'node --test --test-skip-pattern=^platform: "tests/*.test.cjs"');
  assert.equal(scripts['test:platform'], 'node --test --test-name-pattern=^platform: "tests/*.test.cjs"');
  assert.equal(workflow.jobs.test.needs, 'version');
  assert.equal(workflow.jobs.test['runs-on'], 'ubuntu-latest');
  assert.deepEqual(workflow.jobs.build.needs, ['version', 'test']);
  for (const [job, command] of [[workflow.jobs.test, 'npm run test:shared'], [workflow.jobs.build, 'npm run test:platform']]) {
    const commands = job.steps.map((step) => step.run).filter(Boolean);
    assert.equal(commands.filter((run) => run === command).length, 1);
    assert.ok(commands.indexOf('npm ci') < commands.indexOf(command));
    assert.ok(!commands.includes('npm test'), 'the full suite must not repeat inside the release matrix');
    assert.equal(job.steps.find((step) => step.uses === 'actions/setup-node@v4').with['node-version'], '24');
  }
  assert.ok(!workflow.jobs.test.strategy, 'shared tests do not use a platform matrix');
  const builds = workflow.jobs.build.steps.map((step) => step.run).filter(Boolean);
  assert.ok(builds.indexOf('npm run test:platform') < builds.indexOf('npm run build'));
  assert.ok(builds.indexOf('npm run test:installation') < builds.findIndex((run) => run.includes('electron-builder')));
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

async function publish({ draft, failUpload, extraFile, previous = true,
  records = [
    { sha: 'abc123456789', subject: 'Fix a setting', email: 'existing@example.test' },
    { sha: 'fed987654321', subject: 'Add [links] and *formatting*', email: 'existing@example.test' },
  ], notes = 'Changes', oldEmails = ['existing@example.test'], authors = {}, earlierAuthors = [],
  pulls = {}, apiError, draftBody = 'Handwritten release notes.\n\n<!-- tagline-release-commits -->\nOutdated commit list',
} = {}) {
  const script = workflow.jobs.publish.steps.find((step) => step.with?.script).with.script;
  const files = Object.fromEntries(['win-x64.exe', 'mac-x64.dmg', 'mac-arm64.dmg']
    .map((suffix) => [`Tagline-1.2.3-${suffix}`, Buffer.from(suffix)]));
  if (extraFile) files[extraFile] = Buffer.from('unexpected');
  const calls = [];
  const repos = {
    getReleaseByTag: async () => draft === undefined ? missing() : { data: {
      id: 10, draft, html_url: 'https://example.test/release',
      body: draftBody,
    } },
    generateReleaseNotes: async () => ({ data: { body: notes } }),
    listPullRequestsAssociatedWithCommit() { },
    getCommit: async ({ ref }) => {
      if (apiError) throw new Error(apiError);
      return { data: { author: authors[ref] || null } };
    },
    listCommits: async ({ author, sha, per_page }) => {
      calls.push(['earlier', { author, sha, per_page }]);
      return { data: earlierAuthors.includes(author) ? [{ sha: 'old-commit' }] : [] };
    },
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
        if (args.includes('--format=%aE')) return oldEmails.join('\n');
        assert.ok(args.includes('--no-merges'));
        return records.map(({ sha, subject, email }) => `${sha}\0${subject}\0${email}`).join('\n') + '\n';
      }
    };
    if (name === 'node:fs') return {
      readdirSync: () => Object.keys(files),
      readFileSync: (file) => files[file.replace('artifacts/', '')],
      writeFileSync: (file, text) => { files[file.replace('artifacts/', '')] = Buffer.from(text); },
    };
    throw new Error(`Unexpected import: ${name}`);
  }, { rest: { repos }, paginate: async (method, options) => method === repos.listReleases
    ? previous ? [{ draft: true, tag_name: 'v1.2.4' }, { draft: false, tag_name: 'v9.9.9' },
      { draft: false, tag_name: 'v1.2.2' }] : []
    : method === repos.listPullRequestsAssociatedWithCommit
      ? (() => {
        if (apiError) throw new Error(apiError);
        calls.push(['pulls', options.commit_sha]);
        return pulls[options.commit_sha] || [];
      })()
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

test('release lists only direct user-facing commits not already represented by merged pull requests', async () => {
  const subjects = [
    'test: internal', 'refactor: internal', 'test(editor): internal', 'refactor!: internal',
    'Merge pull request #12 from topic', "Merge branch 'main'", 'Merge remote-tracking branch origin/main',
    'Merged feature', 'Squashed feature (#12)', 'Rebased feature', 'Direct fix', 'Unmerged work',
    'Other repository association', 'Unlisted pull request',
  ];
  const records = subjects.map((subject, i) => ({ sha: `sha${i}`, subject, email: 'existing@example.test' }));
  const h = await publish({
    records,
    notes: "## What's Changed\n* Feature https://github.com/test/tagline/pull/12\n"
      + '* Other https://github.com/other/tagline/pull/13\n',
    pulls: {
      sha7: [{ number: 12, merged_at: 'today' }],
      sha8: [{ number: 12, merged_at: 'today' }],
      sha9: [{ number: 12, merged_at: 'today' }],
      sha11: [{ number: 12, merged_at: null }],
      sha12: [{ number: 13, merged_at: 'today' }],
      sha13: [{ number: 14, merged_at: 'today' }],
    },
  });
  await h.execute();
  const body = h.calls.find(([name]) => name === 'create')[1].body;
  const section = body.split("## What's changed - commits")[1];
  for (const subject of subjects.slice(0, 10)) assert.ok(!section.includes(subject), subject);
  for (const subject of subjects.slice(10)) assert.ok(section.includes(subject), subject);
  assert.ok(body.includes('https://github.com/test/tagline/pull/12'), 'generated pull request notes remain intact');
});

test('release limits displayed commits to the latest 20 after filtering and links the full comparison', async () => {
  const records = Array.from({ length: 27 }, (_, i) => ({
    sha: `commit${i}`, subject: `Change ${i}`, email: 'existing@example.test',
  }));
  records.push({ sha: 'internal', subject: 'test: not counted', email: 'existing@example.test' });
  for (const previous of [true, false]) {
    const h = await publish({ records, previous });
    await h.execute();
    const body = h.calls.find(([name]) => name === 'create')[1].body;
    assert.equal([...body.matchAll(/^\* Change /gm)].length, 20);
    assert.ok(!body.includes('* Change 6 ('));
    assert.ok(body.includes('* Change 7 ('));
    assert.ok(body.includes('* Change 26 ('));
    assert.match(body, /Showing the latest 20 of 27 direct commits/);
    assert.ok(body.includes(previous
      ? 'https://github.com/test/tagline/compare/v1.2.2...selected-commit'
      : 'https://github.com/test/tagline/commits/selected-commit'));
  }
});

test('new contributors use all prior history, include PR authors, exclude bots and appear last', async () => {
  const records = [
    { sha: 'returning', subject: 'Fix existing feature', email: 'different@example.test' },
    { sha: 'new', subject: 'Add feature', email: 'new@example.test' },
    { sha: 'new-again', subject: 'Another feature', email: 'new-alias@example.test' },
    { sha: 'bot', subject: 'Update dependencies', email: 'bot@example.test' },
    { sha: 'unlinked', subject: 'Other change', email: 'unknown@example.test' },
  ];
  const h = await publish({
    records,
    notes: "## What's Changed\n* Feature https://github.com/test/tagline/pull/12\n\n"
      + '## New Contributors\n* @Returning made their first contribution\n\n**Full Changelog**: old-link\n',
    authors: {
      returning: { login: 'Returning', type: 'User' },
      new: { login: 'NewPerson', type: 'User' },
      'new-again': { login: 'NewPerson', type: 'User' },
      bot: { login: 'automation[bot]', type: 'Bot' },
    },
    earlierAuthors: ['Returning'],
    pulls: { new: [{ number: 12, merged_at: 'today', user: { login: 'NewPerson' } }] },
  });
  await h.execute();
  const body = h.calls.find(([name]) => name === 'create')[1].body;
  assert.ok(!body.includes('@Returning'));
  assert.ok(body.includes('**Full Changelog**: old-link'));
  assert.ok(!body.includes('@automation'));
  assert.equal([...body.matchAll(/@NewPerson/g)].length, 1);
  assert.ok(body.indexOf('## New Contributors') > body.indexOf("## What's changed - commits"));
  assert.match(body, /@NewPerson made their first contribution in https:\/\/github.com\/test\/tagline\/pull\/12\n$/);
  assert.ok(!body.includes('* Add feature ('), 'the PR contribution is not repeated as a direct commit');
  assert.deepEqual(h.calls.find(([name, args]) => name === 'earlier' && args.author === 'Returning')[1],
    { author: 'Returning', sha: 'refs/tags/v1.2.2', per_page: 1 });
});

test('release removes incorrect generated contributors and safely regenerates draft contributor sections', async () => {
  const h = await publish({
    notes: 'Changes\n\n## New Contributors\n* @Existing is new\n\n## Other notes\nKeep this.',
  });
  await h.execute();
  const body = h.calls.find(([name]) => name === 'create')[1].body;
  assert.ok(!body.includes('## New Contributors'));
  assert.ok(body.includes('## Other notes\nKeep this.'));
  const draft = await publish({
    draft: true, previous: false,
    records: [{ sha: 'first', subject: 'First feature', email: 'first@example.test' }],
    authors: { first: { login: 'First', type: 'User' } },
    draftBody: 'Handwritten notes.\n\n## New Contributors\n* @Wrong\n\n'
      + '<!-- tagline-release-commits -->\nOld generated content',
  });
  await draft.execute();
  const updated = draft.calls.find(([name]) => name === 'publish')[1].body;
  assert.ok(updated.startsWith('Handwritten notes.'));
  assert.ok(!updated.includes('@Wrong'));
  assert.ok(!updated.includes('Old generated content'));
  assert.equal([...updated.matchAll(/## New Contributors/g)].length, 1);
  assert.match(updated, /@First made their first contribution in https:\/\/github.com\/test\/tagline\/commit\/first\n$/);
});

test('release metadata lookup failures stop publishing instead of silently misreporting notes', async () => {
  const h = await publish({ apiError: 'GitHub unavailable' });
  await assert.rejects(h.execute(), /GitHub unavailable/);
  assert.ok(!h.calls.some(([name]) => ['create', 'upload', 'publish'].includes(name)));
});

test('draft commit filtering uses the pull requests in the retained release text', async () => {
  const h = await publish({
    draft: true,
    records: [{ sha: 'feature', subject: 'PR feature', email: 'existing@example.test' }],
    notes: "## What's Changed\nhttps://github.com/test/tagline/pull/99",
    draftBody: "Edited changes\nhttps://github.com/test/tagline/pull/12\n\n<!-- tagline-release-commits -->\nOld list",
    pulls: { feature: [{ number: 12, merged_at: 'today' }] },
  });
  await h.execute();
  const body = h.calls.find(([name]) => name === 'publish')[1].body;
  assert.ok(body.includes('Edited changes'));
  assert.ok(!body.includes('* PR feature ('));
  assert.ok(!body.includes('/pull/99'));
  assert.ok(body.includes('No additional direct commits.'));
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
