const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { NOTE_EXTS, listVault, readVaultSnapshot } = require('./vaultFiles.cjs');

// A minimal Model Context Protocol server (Streamable HTTP, JSON responses) that lets agents work
// with the open vault. It listens on loopback only, requires a bearer token, and is off by default.
const DEFAULT_PORT = 38419;
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_NOTE_CHARACTERS = 2_000_000;
const MAX_RESOURCES = 500;
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
const MAX_EVIDENCE_FILES = 1000;
const MAX_EVIDENCE_HEADINGS = 5000;
const MAX_CITATION_CHARACTERS = 100_000;
const URI_PREFIX = 'tagline://note/';

class ToolError extends Error {}

function flatten(nodes, out = []) {
  for (const node of nodes) {
    if (node.type === 'folder') {
      flatten(node.children, out);
    } else {
      out.push(node);
    }
  }
  return out;
}

function outline(text) {
  const headings = [];
  let fence = false;
  text.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
    }
    const match = !fence && /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (match) {
      headings.push({ level: match[1].length, text: match[2], line: index + 1 });
    }
  });
  return headings;
}

function createMcpService({
  getVaultRoot,
  getAllowWrites = () => true,
  writeNote,
  renamePath,
  trashItem,
  notifyChanged = () => {},
  openNote = () => {},
  version = '0.0.0',
}) {
  const root = () => {
    const value = getVaultRoot();
    if (!value) {
      throw new ToolError('No vault is open in Tagline. Open a vault first.');
    }
    return value;
  };

  // Vault-relative, forward-slash path that stays inside the vault and out of hidden folders.
  function resolve(rel, { note = false, allowRoot = false } = {}) {
    if (typeof rel !== 'string' || (!rel.trim() && !allowRoot)) {
      throw new ToolError('A vault-relative path is required.');
    }
    const clean = rel
      .replaceAll('\\', '/')
      .replace(/^\.?\/+/, '')
      .replace(/\/+$/, '');
    const segments = clean.split('/').filter(Boolean);
    if (
      path.win32.isAbsolute(rel) ||
      path.posix.isAbsolute(rel) ||
      segments.some((segment) => segment === '..' || segment.startsWith('.'))
    ) {
      throw new ToolError(`Path must stay inside the vault and avoid hidden folders: ${rel}`);
    }
    let name = segments.join('/');
    if (note && name && !NOTE_EXTS.includes(path.posix.extname(name).toLowerCase())) {
      name += '.md';
    }
    const base = root();
    const full = path.resolve(base, name);
    const relative = path.relative(base, full);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new ToolError(`Path escapes the vault: ${rel}`);
    }
    return { rel: name, full };
  }

  const requireWrites = () => {
    if (!getAllowWrites()) {
      throw new ToolError(
        'Tagline is in read-only mode for agents. Enable "Allow agents to change notes" in Settings > Integrations.'
      );
    }
  };
  const exists = (full) =>
    fs.stat(full).then(
      () => true,
      (error) => {
        if (error.code === 'ENOENT') {
          return false;
        }
        throw error;
      }
    );
  const checkContent = (content) => {
    if (typeof content !== 'string') {
      throw new ToolError('content must be a string.');
    }
    if (content.length > MAX_NOTE_CHARACTERS) {
      throw new ToolError(`content exceeds ${MAX_NOTE_CHARACTERS} characters.`);
    }
  };
  const readNote = async (rel) => {
    const target = resolve(rel, { note: true });
    try {
      return { ...target, text: await fs.readFile(target.full, 'utf8') };
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') {
        throw new ToolError(`Note not found: ${target.rel}`);
      }
      throw error;
    }
  };

  const pathProperty = (description) => ({ type: 'string', description });
  // Use the same parsers as the UI, including in packaged builds.
  const evidence = () => import('../src/lib/evidenceCheckup.js');
  const citations = () => import('../src/lib/citationExtraction.js');
  async function readEvidenceNote(full, base, remaining) {
    const realBase = await fs.realpath(base);
    const realFile = await fs.realpath(full);
    const relative = path.relative(realBase, realFile);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new ToolError('Evidence note resolves outside the vault.');
    }
    const handle = await fs.open(realFile, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) {
        throw new ToolError('Evidence scanning requires a regular Markdown file.');
      }
      if (stat.size > remaining) {
        throw new ToolError('Evidence scan exceeds the size limit. Specify a smaller note.');
      }
      // Check the limit while reading too, in case the file grows after stat().
      const parts = [];
      let total = 0;
      for (;;) {
        const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining - total + 1));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
        if (!bytesRead) {
          break;
        }
        total += bytesRead;
        if (total > remaining) {
          throw new ToolError('Evidence scan exceeds the size limit. Specify a smaller note.');
        }
        parts.push(chunk.subarray(0, bytesRead));
      }
      return { text: Buffer.concat(parts, total).toString('utf8'), bytes: total };
    } finally {
      await handle.close();
    }
  }
  async function evidenceCards(rel) {
    let files;
    if (rel !== undefined) {
      const note = resolve(rel, { note: true });
      if (!note.rel.toLowerCase().endsWith('.md')) {
        throw new ToolError('Evidence scanning requires a Markdown note.');
      }
      const content = await readEvidenceNote(note.full, root(), MAX_EVIDENCE_BYTES);
      files = { [note.rel]: content.text };
    } else {
      const base = root();
      const notes = flatten(await listVault(base)).filter((file) =>
        file.path.toLowerCase().endsWith('.md')
      );
      if (notes.length > MAX_EVIDENCE_FILES) {
        throw new ToolError('Too many notes to scan at once. Specify a note path.');
      }
      files = {};
      let bytes = 0;
      for (const note of notes) {
        const content = await readEvidenceNote(
          path.join(base, note.path),
          base,
          MAX_EVIDENCE_BYTES - bytes
        );
        bytes += content.bytes;
        files[note.path] = content.text;
      }
    }
    let apparentHeadings = 0;
    for (const content of Object.values(files)) {
      // Conservative preflight also counts headings inside fences; avoid parsing huge card sets.
      const headings = /(?:^|[\r\n]) {0,3}####(?=[ \t\r\n]|$)/g;
      while (headings.test(content)) {
        apparentHeadings++;
        if (apparentHeadings > MAX_EVIDENCE_HEADINGS) {
          throw new ToolError('Too many apparent card headings to scan. Specify a smaller note.');
        }
      }
    }
    return (await evidence()).scanCards(files);
  }
  function pageArgs(offset, limit, max) {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > max
    ) {
      throw new ToolError(`offset must be nonnegative and limit must be from 1 to ${max}.`);
    }
  }
  const tools = [
    {
      name: 'get_status',
      title: 'Tagline status',
      description:
        'Report the Tagline version, the open vault, and whether agents may change notes.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      run: async () => {
        const base = getVaultRoot();
        return {
          app: 'Tagline',
          version,
          vaultOpen: !!base,
          vaultName: base ? path.basename(base) : null,
          allowWrites: !!getAllowWrites(),
          noteExtensions: NOTE_EXTS,
        };
      },
    },
    {
      name: 'list_notes',
      title: 'List notes',
      description:
        'List notes, flows (.flow), canvases (.canvas) and JSON files in the vault, optionally within a folder.',
      inputSchema: {
        type: 'object',
        properties: { folder: pathProperty('Vault-relative folder. Omit for the whole vault.') },
      },
      annotations: { readOnlyHint: true },
      run: async ({ folder } = {}) => {
        const { rel } = resolve(folder ?? '', { allowRoot: true });
        const prefix = rel ? `${rel}/` : '';
        const files = flatten(await listVault(root())).filter((file) =>
          file.path.startsWith(prefix)
        );
        return {
          count: files.length,
          notes: files
            .slice(0, 2000)
            .map((file) => ({ path: file.path, modified: new Date(file.mtime).toISOString() })),
          truncated: files.length > 2000,
        };
      },
    },
    {
      name: 'read_note',
      title: 'Read note',
      description: 'Read the full text of a note, flow, or canvas file.',
      inputSchema: {
        type: 'object',
        properties: { path: pathProperty('Vault-relative path. ".md" is assumed when omitted.') },
        required: ['path'],
      },
      annotations: { readOnlyHint: true },
      run: async ({ path: rel } = {}) => {
        const note = await readNote(rel);
        return { path: note.rel, content: note.text };
      },
    },
    {
      name: 'get_outline',
      title: 'Note outline',
      description: 'List the Markdown headings of a note with their levels and line numbers.',
      inputSchema: {
        type: 'object',
        properties: { path: pathProperty('Vault-relative note path.') },
        required: ['path'],
      },
      annotations: { readOnlyHint: true },
      run: async ({ path: rel } = {}) => {
        const note = await readNote(rel);
        return { path: note.rel, headings: outline(note.text) };
      },
    },
    {
      name: 'search_notes',
      title: 'Search notes',
      description:
        'Case-insensitive text search across all notes. Returns matching lines with their line numbers.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to find.' },
          limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum matches.' },
        },
        required: ['query'],
      },
      annotations: { readOnlyHint: true },
      run: async ({ query, limit = 25 } = {}) => {
        if (typeof query !== 'string' || !query.trim()) {
          throw new ToolError('query is required.');
        }
        const max = Math.min(Math.max(Number.isInteger(limit) ? limit : 25, 1), 100);
        const needle = query.toLowerCase();
        const matches = [];
        const { contents } = await readVaultSnapshot(root());
        for (const [file, text] of Object.entries(contents)) {
          if (file.toLowerCase().includes(needle)) {
            matches.push({ path: file, line: 0, text: '(file name)' });
          }
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length && matches.length < max; i++) {
            if (lines[i].toLowerCase().includes(needle)) {
              matches.push({ path: file, line: i + 1, text: lines[i].trim().slice(0, 300) });
            }
          }
          if (matches.length >= max) {
            break;
          }
        }
        return { query, count: matches.length, matches: matches.slice(0, max) };
      },
    },
    {
      name: 'list_cards',
      title: 'List evidence cards',
      description:
        'Find Markdown evidence cards and their extracted citations in one note or the open vault.',
      inputSchema: {
        type: 'object',
        properties: {
          path: pathProperty('Optional vault-relative Markdown note path.'),
          offset: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 1000 },
        },
      },
      annotations: { readOnlyHint: true },
      run: async ({ path: rel, offset = 0, limit = 100 } = {}) => {
        pageArgs(offset, limit, 1000);
        const cards = await evidenceCards(rel);
        return {
          count: cards.length,
          offset,
          cards: cards.slice(offset, offset + limit),
          truncated: offset + limit < cards.length,
        };
      },
    },
    {
      name: 'extract_citation',
      title: 'Extract citation',
      description:
        'Extract a citation candidate and uncertain fields from Markdown card text. Does not verify the source.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', maxLength: MAX_CITATION_CHARACTERS } },
        required: ['text'],
      },
      annotations: { readOnlyHint: true },
      run: async ({ text } = {}) => {
        if (typeof text !== 'string' || text.length > MAX_CITATION_CHARACTERS) {
          throw new ToolError(
            `text must be a string of at most ${MAX_CITATION_CHARACTERS} characters.`
          );
        }
        return (await citations()).extractCardCitation(text);
      },
    },
    {
      name: 'validate_isbn',
      title: 'Validate ISBN',
      description: 'Validate an ISBN-10 or ISBN-13 checksum. This does not look up the book.',
      inputSchema: {
        type: 'object',
        properties: { isbn: { type: 'string', maxLength: 100 } },
        required: ['isbn'],
      },
      annotations: { readOnlyHint: true },
      run: async ({ isbn } = {}) => {
        if (typeof isbn !== 'string' || isbn.length > 100) {
          throw new ToolError('isbn must be a string of at most 100 characters.');
        }
        return { isbn, valid: (await citations()).isValidIsbn(isbn) };
      },
    },
    {
      name: 'audit_evidence',
      title: 'Audit evidence',
      description:
        'Check cards for missing or uncertain citation fields and stale years. Offline only; does not check links or source accuracy.',
      inputSchema: {
        type: 'object',
        properties: {
          path: pathProperty('Optional vault-relative Markdown note path.'),
          staleYears: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 2000 },
        },
      },
      annotations: { readOnlyHint: true },
      run: async ({ path: rel, staleYears = 5, offset = 0, limit = 100 } = {}) => {
        if (!Number.isInteger(staleYears) || staleYears < 1 || staleYears > 100) {
          throw new ToolError('staleYears must be an integer from 1 to 100.');
        }
        pageArgs(offset, limit, 2000);
        const cards = await evidenceCards(rel);
        const issues = (await evidence()).auditCards(cards, {
          staleYears,
          checks: { links: false },
        });
        return {
          cardsScanned: cards.length,
          count: issues.length,
          offset,
          issues: issues.slice(offset, offset + limit),
          truncated: offset + limit < issues.length,
        };
      },
    },
    {
      name: 'write_note',
      title: 'Write note',
      description:
        'Create a note, or replace an existing one when overwrite is true. Replaced text is kept in revision history.',
      inputSchema: {
        type: 'object',
        properties: {
          path: pathProperty(
            'Vault-relative path. ".md" is added when no known extension is given.'
          ),
          content: { type: 'string' },
          overwrite: { type: 'boolean', description: 'Replace the note if it already exists.' },
        },
        required: ['path', 'content'],
      },
      annotations: { destructiveHint: true },
      run: async ({ path: rel, content, overwrite = false } = {}) => {
        requireWrites();
        checkContent(content);
        const target = resolve(rel, { note: true });
        const existed = await exists(target.full);
        if (existed && overwrite !== true) {
          throw new ToolError(`${target.rel} already exists. Pass overwrite: true to replace it.`);
        }
        await fs.mkdir(path.dirname(target.full), { recursive: true });
        await writeNote(target.rel, content);
        notifyChanged();
        return { path: target.rel, created: !existed };
      },
    },
    {
      name: 'append_to_note',
      title: 'Append to note',
      description: 'Append text to the end of a note, creating the note when it does not exist.',
      inputSchema: {
        type: 'object',
        properties: {
          path: pathProperty('Vault-relative note path.'),
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
      annotations: { destructiveHint: false },
      run: async ({ path: rel, content } = {}) => {
        requireWrites();
        checkContent(content);
        const target = resolve(rel, { note: true });
        const current = (await exists(target.full)) ? await fs.readFile(target.full, 'utf8') : '';
        const separator = current && !current.endsWith('\n') ? '\n' : '';
        const next = `${current}${separator}${content}`;
        checkContent(next);
        await fs.mkdir(path.dirname(target.full), { recursive: true });
        await writeNote(target.rel, next);
        notifyChanged();
        return { path: target.rel, characters: next.length };
      },
    },
    {
      name: 'create_folder',
      title: 'Create folder',
      description: 'Create a folder in the vault, including missing parent folders.',
      inputSchema: {
        type: 'object',
        properties: { path: pathProperty('Vault-relative folder path.') },
        required: ['path'],
      },
      annotations: { destructiveHint: false },
      run: async ({ path: rel } = {}) => {
        requireWrites();
        const target = resolve(rel);
        await fs.mkdir(target.full, { recursive: true });
        notifyChanged();
        return { path: target.rel };
      },
    },
    {
      name: 'rename_path',
      title: 'Rename or move',
      description:
        'Rename or move a note or folder. Revision history moves with it; existing destinations are never overwritten.',
      inputSchema: {
        type: 'object',
        properties: { from: pathProperty('Current path.'), to: pathProperty('New path.') },
        required: ['from', 'to'],
      },
      annotations: { destructiveHint: true },
      run: async ({ from, to } = {}) => {
        requireWrites();
        const source = resolve(from);
        const stat = await fs.stat(source.full).catch(() => null);
        if (!stat) {
          throw new ToolError(`Not found: ${source.rel}`);
        }
        const destination = resolve(to, { note: stat.isFile() });
        const result = await renamePath(source.rel, destination.rel);
        if (!result.ok) {
          throw new ToolError(`${destination.rel} already exists.`);
        }
        notifyChanged();
        return { from: source.rel, to: result.path };
      },
    },
    {
      name: 'delete_path',
      title: 'Delete (move to trash)',
      description: 'Move a note or folder to the operating system trash. It can be restored there.',
      inputSchema: {
        type: 'object',
        properties: { path: pathProperty('Vault-relative path to delete.') },
        required: ['path'],
      },
      annotations: { destructiveHint: true },
      run: async ({ path: rel } = {}) => {
        requireWrites();
        const target = resolve(rel);
        if (!(await exists(target.full))) {
          throw new ToolError(`Not found: ${target.rel}`);
        }
        await trashItem(target.full);
        notifyChanged();
        return { path: target.rel, trashed: true };
      },
    },
    {
      name: 'open_note',
      title: 'Open note in Tagline',
      description: 'Open a note in a Tagline tab so the user can see it.',
      inputSchema: {
        type: 'object',
        properties: { path: pathProperty('Vault-relative note path.') },
        required: ['path'],
      },
      annotations: { readOnlyHint: true },
      run: async ({ path: rel } = {}) => {
        const note = await readNote(rel);
        openNote(note.rel);
        return { path: note.rel, opened: true };
      },
    },
  ];

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

function tokensMatch(actual, expected) {
  const a = crypto.createHash('sha256').update(String(actual)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

function createMcpHttpServer({ service, getToken }) {
  let server = null;
  let port = 0;

  const reply = (res, status, body, headers = {}) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...headers,
    });
    res.end(payload);
  };

  async function onRequest(req, res) {
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
    if (!hosts.includes(String(req.headers.host).toLowerCase()) || req.headers.origin) {
      return reply(res, 403, { error: 'Forbidden.' });
    }
    if (new URL(req.url, 'http://localhost').pathname !== '/mcp') {
      return reply(res, 404, { error: 'Not found. Use /mcp.' });
    }
    const authorization = String(req.headers.authorization || '');
    if (!authorization.startsWith('Bearer ') || !tokensMatch(authorization.slice(7), getToken())) {
      return reply(
        res,
        401,
        { error: 'Missing or invalid bearer token.' },
        {
          'WWW-Authenticate': 'Bearer realm="tagline"',
        }
      );
    }
    if (req.method !== 'POST') {
      return reply(res, 405, { error: 'Use POST.' }, { Allow: 'POST' });
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        return reply(res, 413, { error: 'Request too large.' });
      }
      chunks.push(chunk);
    }
    let message;
    try {
      message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return reply(res, 400, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error.' },
      });
    }
    if (Array.isArray(message)) {
      const responses = (await Promise.all(message.map((item) => service.handle(item)))).filter(
        Boolean
      );
      return responses.length ? reply(res, 200, responses) : reply(res, 202);
    }
    const response = await service.handle(message);
    return response ? reply(res, 200, response) : reply(res, 202);
  }

  return {
    get port() {
      return port;
    },
    listen: (requestedPort) =>
      new Promise((resolve, reject) => {
        const next = http.createServer((req, res) => {
          onRequest(req, res).catch(() => {
            if (!res.headersSent) {
              reply(res, 500, { error: 'Internal error.' });
            }
          });
        });
        next.once('error', reject);
        next.listen(requestedPort, '127.0.0.1', () => {
          next.removeListener('error', reject);
          server = next;
          port = next.address().port;
          resolve(port);
        });
      }),
    close: () =>
      new Promise((resolve) => {
        if (!server) {
          resolve();
          return;
        }
        const closing = server;
        server = null;
        port = 0;
        closing.close(() => resolve());
        closing.closeAllConnections();
      }),
  };
}

function normalizeConfig(value) {
  const config = value && typeof value === 'object' ? value : {};
  return {
    enabled: config.enabled === true,
    keepRunning: config.keepRunning === true,
    allowWrites: config.allowWrites !== false,
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
