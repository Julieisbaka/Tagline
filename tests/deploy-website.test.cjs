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
  assert.match(
    workflow.jobs.deploy.environment.url,
    /steps\.deployment_retry_1\.outputs\.page_url/
  );

  const steps = workflow.jobs.deploy.steps;
  const waitForArtifact = steps.find(
    (step) => step.name === 'Wait for Pages artifact metadata'
  );
  assert.ok(waitForArtifact);
  assert.match(waitForArtifact.run, /github-pages/);
  assert.match(waitForArtifact.run, /\{1\.\.12\}/);

  const deploy = steps.find((step) => step.name === 'Deploy to GitHub Pages');
  assert.equal(deploy['continue-on-error'], true);
  assert.equal(deploy.uses, 'actions/deploy-pages@v4');

  const retries = steps.filter((step) =>
    step.name?.startsWith('Retry GitHub Pages deployment')
  );
  assert.equal(retries.length, 2);
  assert.ok(retries.every((step) => step.uses === 'actions/deploy-pages@v4'));
  assert.ok(retries.every((step) => step['continue-on-error'] === true));

  const failureGate = steps.find(
    (step) => step.name === 'Fail if Pages deployment could not start'
  );
  assert.ok(failureGate);
  assert.match(failureGate.run, /failed after the readiness check and retry attempts/);
});
