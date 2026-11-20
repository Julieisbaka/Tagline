const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

test('smoke jobs install Electron before configuring its sandbox', () => {
  const workflow = yaml.load(
    fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8')
  );
  const steps = workflow.jobs.smoke.steps;
  const installIndex = steps.findIndex((step) => step.name === 'Install Electron binary');
  const sandboxIndex = steps.findIndex((step) => step.name === 'Configure Electron sandbox');
  assert.ok(installIndex >= 0 && installIndex < sandboxIndex);
  assert.equal(steps[installIndex].run, 'npx --no install-electron');
  assert.equal(steps[installIndex].if, undefined);
  assert.match(steps[sandboxIndex].run, /node_modules\/electron\/dist\/chrome-sandbox/);
});
