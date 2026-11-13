'use strict';

function parseArgValue(argv, name) {
  const prefix = `--${name}=`;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (typeof arg === 'string' && arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
    if (arg === `--${name}` && i + 1 < argv.length) {
      return argv[i + 1];
    }
  }
  return undefined;
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function parseCli(argv = process.argv, env = process.env) {
  const isDev = argv.includes('--dev');
  const safeMode = argv.includes('--safe-mode') || env.TAGLINE_SAFE_MODE === '1';
  const disableExtensions =
    safeMode || argv.includes('--disable-extensions') || env.TAGLINE_DISABLE_EXTENSIONS === '1';

  const delayRaw =
    parseArgValue(argv, 'update-check-delay') ??
    parseArgValue(argv, 'updateCheckDelay') ??
    env.TAGLINE_UPDATE_CHECK_DELAY ??
    env.TAGLINE_UPDATE_CHECK_TIMEOUT;
  const timeoutRaw =
    parseArgValue(argv, 'update-check-timeout') ??
    parseArgValue(argv, 'updateCheckTimeout') ??
    env.TAGLINE_UPDATE_CHECK_TIMEOUT;

  const updateCheckDelayMs = toNumber(delayRaw) ?? 8000;
  const updateCheckTimeoutMs = toNumber(timeoutRaw) ?? 8000;

  return {
    isDev,
    safeMode,
    disableExtensions,
    updateCheckDelayMs,
    updateCheckTimeoutMs,
  };
}

module.exports = { parseCli, parseArgValue };
