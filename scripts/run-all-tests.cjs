const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const logPath = path.join(root, 'test-all.log');
const { scripts } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const subsets = new Set(['test:all', 'test:shared', 'test:platform']);
const suites = ['test', ...Object.keys(scripts).filter((name) =>
  name.startsWith('test:') && !subsets.has(name))];
const npmCli = process.env.npm_execpath;
const MAX_CAPTURED_OUTPUT = 10 * 1024 * 1024;
const startedAt = Date.now();
const results = [];
let currentChild = null;
let interrupted = false;
let runnerError = '';

function runSuite(name) {
  return new Promise((resolve) => {
    const suiteStartedAt = Date.now();
    let output = '';
    let outputTruncated = false;
    let settled = false;
    let child;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (currentChild === child) currentChild = null;
      resolve({ suite: name, durationMs: Date.now() - suiteStartedAt, output, outputTruncated, ...result });
    };
    try {
      child = spawn(process.execPath, [npmCli, 'run', name], {
        cwd: root,
        env: process.env,
        stdio: ['inherit', 'pipe', 'pipe'],
      });
    } catch (error) {
      finish({ status: 'failed', detail: error.message, counts: { tests: 1, passed: 0, failed: 1, skipped: 0, cancelled: 0 } });
      return;
    }
    currentChild = child;
    const capture = (stream) => stream.on('data', (chunk) => {
      if (output.length < MAX_CAPTURED_OUTPUT) {
        const remaining = MAX_CAPTURED_OUTPUT - output.length;
        output += chunk.toString('utf8', 0, remaining);
        if (chunk.length > remaining) outputTruncated = true;
      } else {
        outputTruncated = true;
      }
    });
    capture(child.stdout);
    capture(child.stderr);
    child.once('error', (error) => finish({
      status: 'failed',
      detail: error.message,
      counts: { tests: 1, passed: 0, failed: 1, skipped: 0, cancelled: 0 },
    }));
    child.once('close', (code, signal) => {
      if (interrupted) {
        finish({ status: 'interrupted', detail: signal || `exit ${code}`, counts: suiteCounts(name, output, 'interrupted') });
      } else if (code === 0) {
        finish({ status: 'passed', counts: suiteCounts(name, output, 'passed') });
      } else {
        finish({
          status: 'failed',
          detail: signal || `exit ${code}`,
          counts: suiteCounts(name, output, 'failed'),
        });
      }
    });
  });
}

function reporterCount(output, label) {
  const patterns = [
    new RegExp(`^ℹ ${label}\\s+(\\d+)\\s*$`, 'm'),
    new RegExp(`^# ${label}\\s+(\\d+)\\s*$`, 'm'),
  ];
  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function suiteCounts(name, output, status) {
  if (name === 'test') {
    const tests = reporterCount(output, 'tests');
    const passCount = reporterCount(output, 'pass');
    const failCount = reporterCount(output, 'fail');
    const skipped = reporterCount(output, 'skipped');
    const cancelled = reporterCount(output, 'cancelled');
    if ([tests, passCount, failCount, skipped, cancelled].every(Number.isInteger)) {
      return { tests, passed: passCount, failed: failCount, skipped, cancelled };
    }
  }
  if (status === 'interrupted') {
    return { tests: 1, passed: 0, failed: 0, skipped: 0, cancelled: 1 };
  }
  return {
    tests: 1,
    passed: status === 'passed' ? 1 : 0,
    failed: status === 'failed' ? 1 : 0,
    skipped: 0,
    cancelled: 0,
  };
}

function formatDuration(durationMs) {
  const seconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return [
    hours ? `${hours}h` : '',
    hours || minutes ? `${minutes}m` : '',
    `${remaining}s`,
  ].filter(Boolean).join(' ');
}

function totals() {
  return results.reduce((sum, result) => {
    for (const key of ['tests', 'passed', 'failed', 'skipped', 'cancelled']) sum[key] += result.counts[key];
    return sum;
  }, { tests: 0, passed: 0, failed: 0, skipped: 0, cancelled: 0 });
}

function reportText(logWriteError = '') {
  const count = totals();
  const notRun = interrupted ? suites.length - results.length : 0;
  const testsRan = count.passed + count.failed + count.cancelled;
  const durationMs = Date.now() - startedAt;
  const lines = [
    'Tagline full test run',
    `Started: ${new Date(startedAt).toISOString()}`,
    `Duration: ${formatDuration(durationMs)}`,
    `Test cases: ${count.tests} (individual node:test cases plus one case per smoke suite)`,
    `Tests run: ${testsRan}`,
    `Passed: ${count.passed}`,
    `Failed: ${count.failed}`,
    `Skipped: ${count.skipped}`,
    `Canceled: ${count.cancelled + (interrupted && currentChild ? 1 : 0)}`,
    `Suites completed: ${results.length}/${suites.length}`,
    ...(notRun ? [`Suites not run after interruption: ${notRun}`] : []),
    'Auth and password rejection cases are expected negative-path checks. They count as passing when their assertions pass.',
  ];

  if (runnerError) lines.push(`Runner error: ${runnerError}`);
  if (logWriteError) lines.push(`Could not write ${logPath}: ${logWriteError}`);
  return lines.join('\n');
}

function writeLog() {
  const failed = results.filter((result) => result.status !== 'passed');
  const lines = [
    reportText(),
    '',
    'Suite results:',
    ...results.map((result) =>
      `${result.status.toUpperCase()} ${result.suite} (${formatDuration(result.durationMs)})` +
      (result.detail ? `: ${result.detail}` : '')),
  ];
  for (const result of failed) {
    lines.push('', `===== ${result.suite} output${result.outputTruncated ? ' (truncated)' : ''} =====`);
    if (result.output) lines.push(result.output);
  }
  fs.writeFileSync(logPath, `${lines.join('\n')}\n`, 'utf8');
}

function printSummary(logWriteError = '') {
  const count = totals();
  const notRun = interrupted ? suites.length - results.length : 0;
  const testsRan = count.passed + count.failed + count.cancelled;
  console.log('\n=== Test run summary ===');
  console.log(`Execution time: ${formatDuration(Date.now() - startedAt)}`);
  console.log(`Test cases counted: ${count.tests}`);
  console.log(`Tests run: ${testsRan}`);
  console.log(`Passed: ${count.passed}`);
  console.log(`Failed: ${count.failed}`);
  console.log(`Skipped: ${count.skipped}`);
  console.log(`Canceled: ${count.cancelled + (interrupted && currentChild ? 1 : 0)}`);
  if (notRun) console.log(`Suites not run after interruption: ${notRun}`);
  console.log('Auth/password rejection scenarios are expected; they pass when the tests assert the errors.');
  if (logWriteError || count.failed || interrupted || runnerError) {
    console.log(`Failure details: ${logPath}`);
  } else {
    console.log(`Run log: ${logPath}`);
  }
  if (logWriteError) console.log(`Could not write the log: ${logWriteError}`);
  if (runnerError) console.log(`Runner error: ${runnerError}`);
}

function requestInterrupt() {
  if (interrupted) return;
  interrupted = true;
  currentChild?.kill('SIGINT');
}

process.on('SIGINT', requestInterrupt);
process.on('SIGTERM', requestInterrupt);

async function main() {
  if (!npmCli) runnerError = 'npm_execpath is missing; start this script with npm run test:all.';
  if (!runnerError) {
    for (const suite of suites) {
      if (interrupted) break;
      results.push(await runSuite(suite));
    }
  }

  let logWriteError = '';
  try { writeLog(); }
  catch (error) { logWriteError = error.message; }
  printSummary(logWriteError);
  if (runnerError || logWriteError || interrupted || totals().failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  runnerError = error.message;
  let logWriteError = '';
  try { writeLog(); }
  catch (writeError) { logWriteError = writeError.message; }
  printSummary(logWriteError);
  process.exitCode = 1;
});
