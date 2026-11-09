const { listVault } = require('../vaultFiles.cjs');
const { ToolError, flatten, createVaultContext } = require('./vault.cjs');
const { createEvidenceTools } = require('./evidence.cjs');
const { createTools } = require('./tools.cjs');

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_RESOURCES = 500;
const URI_PREFIX = 'tagline://note/';

function createMcpService({
  getVaultRoot,
  getAllowWrites = () => true,
  getAllowModels = () => false,
  getLocalModels = () => null,
  writeNote,
  renamePath,
  trashItem,
  notifyChanged = () => {},
  openNote = () => {},
  version = '0.0.0',
}) {
  const context = createVaultContext({
    getVaultRoot,
    getAllowWrites,
    getAllowModels,
    getLocalModels,
  });
  const { root, readNote } = context;
  const evidenceTools = createEvidenceTools(context);
  const tools = createTools(
    {
      getVaultRoot,
      getAllowWrites,
      getAllowModels,
      getLocalModels,
      writeNote,
      renamePath,
      trashItem,
      notifyChanged,
      openNote,
      version,
      ...context,
    },
    evidenceTools
  );

  const text = (value, isError = false) => ({
    content: [
      { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
    ],
    ...(isError ? { isError: true } : {}),
  });

  async function callTool(params) {
    const tool = tools.find((item) => item.name === params?.name);
    if (!tool) {
      throw rpcError(-32602, `Unknown tool: ${params?.name}`);
    }
    try {
      return text(await tool.run(params.arguments ?? {}));
    } catch (error) {
      if (error instanceof ToolError || error.code === 'ENOENT' || error.code === 'EACCES') {
        return text(error instanceof ToolError ? error.message : `File error: ${error.code}`, true);
      }
      return text(`Tool failed: ${error.message}`, true);
    }
  }

  async function listResources() {
    const files = flatten(await listVault(root()))
      .filter((file) => file.path.toLowerCase().endsWith('.md'))
      .slice(0, MAX_RESOURCES);
    return {
      resources: files.map((file) => ({
        uri: URI_PREFIX + encodeURI(file.path),
        name: file.path,
        mimeType: 'text/markdown',
      })),
    };
  }

  async function readResource(params) {
    const uri = params?.uri;
    if (typeof uri !== 'string' || !uri.startsWith(URI_PREFIX)) {
      throw rpcError(-32602, 'Unknown resource URI.');
    }
    try {
      const note = await readNote(decodeURI(uri.slice(URI_PREFIX.length)));
      return { contents: [{ uri, mimeType: 'text/markdown', text: note.text }] };
    } catch (error) {
      throw rpcError(-32002, error.message);
    }
  }

  async function dispatch(method, params) {
    switch (method) {
      case 'initialize': {
        const requested = params?.protocolVersion;
        return {
          protocolVersion: PROTOCOLS.includes(requested) ? requested : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
          serverInfo: { name: 'tagline', title: 'Tagline', version },
          instructions:
            'Tagline is a local debate research vault of Markdown notes, .flow and .canvas files. Paths are vault-relative.',
        };
      }
      case 'ping':
        return {};
      case 'tools/list':
        return {
          tools: tools.map(({ name, title, description, inputSchema, annotations }) => ({
            name,
            title,
            description,
            inputSchema,
            annotations,
          })),
        };
      case 'tools/call':
        return callTool(params);
      case 'resources/list':
        return listResources();
      case 'resources/templates/list':
        return {
          resourceTemplates: [
            {
              uriTemplate: `${URI_PREFIX}{path}`,
              name: 'Tagline note',
              description: 'A Markdown note by vault-relative path.',
              mimeType: 'text/markdown',
            },
          ],
        };
      case 'resources/read':
        return readResource(params);
      case 'prompts/list':
        return { prompts: [] };
      default:
        throw rpcError(-32601, `Method not found: ${method}`);
    }
  }

  // Returns a JSON-RPC response, or null for notifications that need no reply.
  async function handle(message) {
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') {
      return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request.' } };
    }
    const isRequest = typeof message.method === 'string' && message.id !== undefined;
    if (!isRequest) {
      return null;
    }
    try {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: await dispatch(message.method, message.params),
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: error.rpcCode ?? -32603,
          message: error.rpcCode ? error.message : 'Internal error.',
        },
      };
    }
  }

  return { handle, tools };
}

function rpcError(code, message) {
  return Object.assign(new Error(message), { rpcCode: code });
}

module.exports = { createMcpService };
