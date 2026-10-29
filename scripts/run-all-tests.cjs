const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const { scripts } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const subsets = new Set(['test:all', 'test:shared', 'test:platform']);
const suites = ['test', ...Object.keys(scripts).filter((name) =>
  name.startsWith('test:') && !subsets.has(name))];
const npmCli = process.env.npm_execpath;

if (!npmCli) throw new Error('Run the test suite with npm run test:all.');

const results = [];
let currentChild = null;
let interrupted = false;
const MAX_CAPTURED_OUTPUT = 2 * 1024 * 1024;

function runSuite(name) {
  return new Promise((resolve) => {
    const started = Date.now();
    let output = '';
    let outputTruncated = false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (currentChild === child) currentChild = null;
      resolve({ suite: name, durationMs: Date.now() - started, output, outputTruncated, ...result });
    };
    const child = spawn(process.execPath, [npmCli, 'run', name], {
      cwd: root,
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    currentChild = child;
    const forward = (stream, destination) => stream.on('data', (chunk) => {
      destination.write(chunk);
      if (output.length < MAX_CAPTURED_OUTPUT) {
        const remaining = MAX_CAPTURED_OUTPUT - output.length;
        output += chunk.toString('utf8', 0, remaining);
        if (chunk.length > remaining) outputTruncated = true;
      } else {
        outputTruncated = true;
      }
    });
    forward(child.stdout, process.stdout);
    forward(child.stderr, process.stderr);
    child.once('error', (error) => finish({ status: 'failed', detail: error.message }));
    child.once('close', (code, signal) => {
      if (interrupted) finish({ status: 'interrupted', detail: signal || `exit ${code}` });
      else if (code === 0) finish({ status: 'passed' });
      else finish({ status: 'failed', detail: signal || `exit ${code}` });
    });
  });
}

function formatDuration(durationMs) {
  const seconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function summarize() {
  const notRun = interrupted ? suites.slice(results.length) : [];
  console.log('\n=== Test suite summary ===');
  console.log(`${'Suite'.padEnd(28)} ${'Result'.padEnd(14)} Duration`);
  console.log(`${'-'.repeat(28)} ${'-'.repeat(14)} --------`);
  for (const result of results) {
    const status = result.status === 'passed' ? 'PASS' :
      result.status === 'interrupted' ? 'INTERRUPTED' : 'FAIL';
    console.log(`${result.suite.padEnd(28)} ${status.padEnd(14)} ${formatDuration(result.durationMs)}` +
      (result.detail ? ` (${result.detail})` : ''));
  }
  for (const suite of notRun) console.log(`${suite.padEnd(28)} ${'NOT RUN'.padEnd(14)} —`);

  const passed = results.filter((result) => result.status === 'passed').length;
  const failed = results.filter((result) => result.status === 'failed').length;
  const interruptedCount = results.filter((result) => result.status === 'interrupted').length;
  console.log(`\nTotal: ${passed} passed, ${failed} failed, ${interruptedCount} interrupted, ${notRun.length} not run.`);
  console.log('Auth and password rejection cases are expected negative-path checks; their enclosing suite passes when those errors are correctly asserted.');

  if (failed) {
    console.log('\nFailure details:');
    for (const result of results.filter((item) => item.status === 'failed')) {
      console.log(`\n--- ${result.suite}${result.outputTruncated ? ' (captured output truncated)' : ''} ---`);
      if (result.detail) console.log(result.detail);
      if (result.output) console.log(result.output.trimEnd());
    }
  }
}

process.on('SIGINT', () => {
  if (interrupted) return;
  interrupted = true;
  console.error('\nInterrupt received; stopping the current suite and summarizing completed results.');
  currentChild?.kill('SIGINT');
  if (!currentChild) {
    summarize();
    process.exitCode = 130;
  }
});

async function main() {
  for (const suite of suites) {
    if (interrupted) break;
    console.log(`\n=== Running ${suite} ===\n`);
    results.push(await runSuite(suite));
  }
  summarize();
  if (results.some((result) => result.status !== 'passed') || interrupted) process.exitCode = 1;
}

main().catch((error) => {
  console.error('Test runner failed:', error);
  process.exitCode = 1;
});
