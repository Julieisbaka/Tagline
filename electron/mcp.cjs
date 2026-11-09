const { createMcpHttpServer } = require('./mcp/transport.cjs');
const { ToolError } = require('./mcp/vault.cjs');
const crypto = require('node:crypto');
const { createMcpService } = require('./mcp/service.cjs');

// A minimal Model Context Protocol server (Streamable HTTP, JSON responses) that lets agents work
// with the open vault. It listens on loopback only, requires a bearer token, and is off by default.
const DEFAULT_PORT = 38419;

function normalizeConfig(value) {
  const config = value && typeof value === 'object' ? value : {};
  return {
    enabled: config.enabled === true,
    keepRunning: config.keepRunning === true,
    allowWrites: config.allowWrites !== false,
    allowModels: config.allowModels === true,
    port:
      Number.isInteger(config.port) && config.port >= 1024 && config.port <= 65535
        ? config.port
        : DEFAULT_PORT,
    token: typeof config.token === 'string' && config.token.length >= 32 ? config.token : '',
  };
}

function registerMcp({
  app,
  ipcMain,
  getWindow,
  getVaultRoot,
  readConfig,
  writeConfig,
  ...operations
}) {
  const config = () => normalizeConfig(readConfig().mcp);
  const save = (patch) => {
    const current = config();
    const next = { ...current, ...patch };
    if (!next.token) {
      next.token = crypto.randomBytes(32).toString('hex');
    }
    writeConfig({ mcp: next });
    return next;
  };
  const send = (channel, ...args) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  };
  const service = createMcpService({
    getVaultRoot,
    getAllowWrites: () => config().allowWrites,
    getAllowModels: () => config().allowModels,
    version: app.getVersion(),
    notifyChanged: () => send('mcp:vaultChanged'),
    openNote: (rel) => {
      const win = getWindow();
      if (!win || win.isDestroyed()) {
        throw new ToolError(
          'Cannot open a note while the Tagline window is closed. Reopen the app first.'
        );
      }
      send('mcp:open', rel);
    },
    ...operations,
  });
  const server = createMcpHttpServer({ service, getToken: () => config().token });
  let error = '';

  async function apply() {
    await server.close();
    error = '';
    if (!config().enabled) {
      return;
    }
    try {
      await server.listen(config().port);
    } catch (listenError) {
      error =
        listenError.code === 'EADDRINUSE'
          ? `Port ${config().port} is already in use. Choose another port.`
          : listenError.message;
    }
  }
  const status = () => {
    const current = config();
    return {
      enabled: current.enabled,
      keepRunning: current.keepRunning,
      running: server.port > 0,
      port: current.port,
      url: `http://127.0.0.1:${current.port}/mcp`,
      token: current.token,
      allowWrites: current.allowWrites,
      allowModels: current.allowModels,
      vaultRoot: getVaultRoot(),
      error,
    };
  };
  const authorize = (event) => {
    const win = getWindow();
    if (!win || event.sender !== win.webContents || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('MCP settings are only available to the application.');
    }
  };

  ipcMain.handle('mcp:status', (event) => {
    authorize(event);
    save({});
    return status();
  });
  ipcMain.handle('mcp:configure', async (event, options) => {
    authorize(event);
    const patch = {};
    if (options?.enabled !== undefined) {
      if (typeof options.enabled !== 'boolean') {
        throw new Error('Invalid MCP setting.');
      }
      patch.enabled = options.enabled;
    }
    if (options?.allowWrites !== undefined) {
      if (typeof options.allowWrites !== 'boolean') {
        throw new Error('Invalid MCP setting.');
      }
      patch.allowWrites = options.allowWrites;
    }
    if (options?.allowModels !== undefined) {
      if (typeof options.allowModels !== 'boolean') {
        throw new Error('Invalid MCP setting.');
      }
      patch.allowModels = options.allowModels;
    }
    if (options?.keepRunning !== undefined) {
      if (typeof options.keepRunning !== 'boolean') {
        throw new Error('Invalid MCP setting.');
      }
      patch.keepRunning = options.keepRunning;
    }
    if (options?.port !== undefined) {
      if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
        throw new Error('Choose a port between 1024 and 65535.');
      }
      patch.port = options.port;
    }
    const previous = config();
    save(patch);
    if (
      (patch.enabled !== undefined && patch.enabled !== previous.enabled) ||
      (patch.port !== undefined && patch.port !== previous.port)
    ) {
      await apply();
    }
    return status();
  });
  ipcMain.handle('mcp:background', (event) => {
    authorize(event);
    if (!config().enabled || !config().keepRunning || !server.port || !getVaultRoot()) {
      throw new Error(
        'Open a vault and enable the running MCP server and background option first.'
      );
    }
    const win = getWindow();
    setImmediate(() => {
      if (!win.isDestroyed()) {
        win.close();
      }
    });
    return true;
  });
  ipcMain.handle('mcp:regenerateToken', (event) => {
    authorize(event);
    save({ token: crypto.randomBytes(32).toString('hex') });
    return status();
  });

  apply();
  return {
    close: () => server.close(),
    shouldKeepRunning: () =>
      config().enabled && config().keepRunning && server.port > 0 && !!getVaultRoot(),
  };
}

module.exports = {
  DEFAULT_PORT,
  createMcpService,
  createMcpHttpServer,
  normalizeConfig,
  registerMcp,
};
