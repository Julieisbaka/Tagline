const { performance } = require('node:perf_hooks');

async function waitFor(
  condition,
  { timeout = 10000, interval = 20, message = 'Timed out', details } = {}
) {
  const deadline = performance.now() + timeout;
  let lastError;
  do {
    try {
      const value = await condition();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(interval, remaining)));
  } while (true);

  let diagnostic = '';
  if (details) {
    try {
      diagnostic = await details();
    } catch (error) {
      diagnostic = `\nCould not collect diagnostics: ${error.message}`;
    }
  }
  throw new Error(`${message}${diagnostic}`, { cause: lastError });
}

function rendererWait(js, { timeout = 10000, details } = {}) {
  return (code, label = code) =>
    waitFor(() => js(code), {
      timeout,
      message: `Timed out: ${label}`,
      details: details && (() => details(code)),
    });
}

module.exports = { waitFor, rendererWait };
