const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Run a single Electron smoke process with an isolated, automatically cleaned profile root.
function runSmoke({ script, prefix, rootEnv, timeout = 120000, executable }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    const result = spawnSync(executable || require('electron'), [script], {
      env: { ...process.env, [rootEnv]: root },
      stdio: 'inherit',
      timeout,
    });
    if (result.error) {
      throw new Error(`Could not run ${path.basename(script)}: ${result.error.message}`, {
        cause: result.error,
      });
    }
    if (result.signal) {
      console.error(`FAIL ${path.basename(script)}: process terminated by ${result.signal}`);
    }
    return result.status ?? 1;
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

// Keep the original assertion and stack as the cause so failures identify both the
// scenario and the precise assertion that failed.
async function scenario(description, run) {
  try {
    return await run();
  } catch (error) {
    throw new Error(`Scenario failed: ${description}`, { cause: error });
  }
}

// Electron's console and explicit stack logging do not always print Error causes.
function formatFailure(error) {
  const parts = [];
  const seen = new Set();
  while (error && !seen.has(error)) {
    seen.add(error);
    parts.push(error.stack || String(error));
    error = error.cause;
  }
  return parts.join('\nCaused by: ');
}

module.exports = { runSmoke, scenario, formatFailure };
