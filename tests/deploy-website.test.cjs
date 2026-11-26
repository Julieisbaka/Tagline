const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const workflowPath = path.join(
  __dirname,
  '..',
  '.github',
  'workflows',
  'deploy-website.yml'
);
const workflow = yaml.load(fs.readFileSync(workflowPath, 'utf8'));

test('website deployment waits for artifact metadata and retries transient failures', () => {
  assert.equal(workflow.permissions.actions, 'read');
  assert.equal(
    workflow.jobs.deploy.environment.url,
    '${{ steps.deployment_retry_2.outputs.page_url || steps.deployment_retry_1.outputs.page_url || steps.deployment.outputs.page_url }}'
  );

  const steps = workflow.jobs.deploy.steps;
  const waitForArtifact = steps.find(
    (step) => step.name === 'Wait for Pages artifact metadata'
  );
  assert.ok(waitForArtifact);
  assert.equal(waitForArtifact.uses, 'actions/github-script@v7');

  const deploy = steps.find((step) => step.name === 'Deploy to GitHub Pages');
  assert.ok(steps.indexOf(waitForArtifact) < steps.indexOf(deploy));
  assert.equal(deploy['continue-on-error'], true);
  assert.equal(deploy.uses, 'actions/deploy-pages@v4');

  const retries = steps.filter((step) =>
    step.name?.startsWith('Retry GitHub Pages deployment')
  );
  assert.equal(retries.length, 2);
  assert.ok(retries.every((step) => step.uses === 'actions/deploy-pages@v4'));
  assert.ok(retries.every((step) => step['continue-on-error'] === true));
  assert.equal(
    retries.find((step) => step.id === 'deployment_retry_1')?.if,
    "steps.deployment.outcome == 'failure'"
  );
  assert.equal(
    retries.find((step) => step.id === 'deployment_retry_2')?.if,
    "steps.deployment_retry_1.outcome == 'failure'"
  );

  const failureGate = steps.find(
    (step) => step.name === 'Fail if Pages deployment could not start'
  );
  assert.ok(failureGate);
  assert.match(failureGate.run, /failed after the readiness check and retry attempts/);
});

test('artifact readiness polls the Actions Results service before deployment', async () => {
  const step = workflow.jobs.deploy.steps.find(
    (item) => item.name === 'Wait for Pages artifact metadata'
  );
  const run = new (Object.getPrototypeOf(async function () {}).constructor)(
    'process', 'fetch', 'setTimeout', 'console', step.with.script
  );
  const token = `header.${Buffer.from(JSON.stringify({
    scp: 'Actions.Other Actions.Results:run-id:job-id'
  })).toString('base64url')}.signature`;
  const env = { ACTIONS_RUNTIME_TOKEN: token, ACTIONS_RESULTS_URL: 'https://results.example/' };
  const requests = [];
  const fetch = async (url, options) => {
    requests.push({ url: url.href, ...options });
    const artifacts = [
      [{ name: 'other' }],
      [{ name: 'github-pages' }, { name: 'github-pages' }],
      [{ name: 'github-pages' }]
    ];
    return {
      ok: true,
      json: async () => ({ artifacts: artifacts[requests.length - 1] })
    };
  };
  await run({ env }, fetch, (callback) => callback(), { log() {} });
  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, 'https://results.example/twirp/github.actions.results.api.v1.ArtifactService/ListArtifacts');
  assert.equal(requests[0].headers.authorization, 'Bearer' + ' ' + token);
  assert.deepEqual(JSON.parse(requests[0].body), {
    workflowRunBackendId: 'run-id',
    workflowJobRunBackendId: 'job-id'
  });

  let attempts = 0;
  await assert.rejects(
    run({ env }, async () => {
      attempts++;
      return { ok: true, json: async () => ({ artifacts: [] }) };
    }, (callback) => callback(), { log() {} }),
    /after 12 attempts/
  );
  assert.equal(attempts, 12);
  await assert.rejects(
    run({ env }, async () => ({ ok: false, status: 403 }), (callback) => callback(), { log() {} }),
    /Artifact service returned HTTP 403/
  );
});
