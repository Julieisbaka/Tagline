const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  createMcpHttpServer,
  createMcpService,
  normalizeConfig,
  registerMcp,
} = require('../electron/mcp.cjs');
const { registerExtensions } = require('../electron/extensions.cjs');

async function withMcp(run, { allowWrites = true, getAllowModels, getLocalModels } = {}) {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-mcp-'));
  await fs.mkdir(path.join(vault, 'Case'), { recursive: true });
  await fs.writeFile(
    path.join(vault, 'Case', 'Plan.md'),
    '# Plan\n\nText about Nuclear war\n## Solvency\n'
  );
  const events = [];
  const service = createMcpService({
    getVaultRoot: () => vault,
    getAllowWrites: () => allowWrites,
    getAllowModels,
    getLocalModels,
    writeNote: (rel, content) => fs.writeFile(path.join(vault, rel), content),
    renamePath: async (from, to) => {
      await fs.rename(path.join(vault, from), path.join(vault, to));
      return { ok: true, path: to };
    },
    trashItem: (full) => fs.rm(full, { recursive: true }),
    notifyChanged: () => events.push('changed'),
    openNote: (rel) => events.push(`open:${rel}`),
  });
  const server = createMcpHttpServer({ service, getToken: () => 'a'.repeat(32) });
  const port = await server.listen(0);
  const post = (body, headers = {}) =>
    fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${'a'.repeat(32)}`,
        ...headers,
      },
      body: JSON.stringify(body),
    });
  let id = 0;
  const call = async (name, args) => {
    const response = await (
      await post({
        jsonrpc: '2.0',
        id: ++id,
        method: 'tools/call',
        params: { name, arguments: args },
      })
    ).json();
    return response.result;
  };
  try {
    await run({ vault, port, post, call, events });
  } finally {
    await server.close();
    await fs.rm(vault, { recursive: true, force: true });
  }
}

test('MCP server requires the bearer token and rejects browser origins', async () => {
  await withMcp(async ({ port, post }) => {
    const body = { jsonrpc: '2.0', id: 1, method: 'ping' };
    assert.equal((await post(body, { Authorization: 'Bearer wrong' })).status, 401);
    assert.equal((await post(body, { Origin: 'https://example.com' })).status, 403);
    const hostStatus = await new Promise((resolve, reject) => {
      const req = require('node:http').request(
        {
          host: '127.0.0.1',
          port,
          path: '/mcp',
          method: 'POST',
          headers: { Host: 'evil.example' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        }
      );
      req.on('error', reject);
      req.end('{}');
    });
    assert.equal(hostStatus, 403);
    assert.equal((await fetch(`http://127.0.0.1:${port}/mcp`)).status, 401);
    assert.equal((await post(body)).status, 200);
    assert.equal((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
  });
});

test('MCP initialize negotiates protocol and lists tools and resources', async () => {
  await withMcp(async ({ post }) => {
    const init = await (
      await post({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test' } },
      })
    ).json();
    assert.equal(init.result.protocolVersion, '2025-03-26');
    assert.equal(init.result.serverInfo.name, 'tagline');
    const tools = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
    assert.ok(tools.result.tools.some((tool) => tool.name === 'write_note'));
    const resources = await (
      await post({ jsonrpc: '2.0', id: 3, method: 'resources/list' })
    ).json();
    const uri = resources.result.resources[0].uri;
    const read = await (
      await post({ jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri } })
    ).json();
    assert.match(read.result.contents[0].text, /Solvency/);
    const unknown = await (await post({ jsonrpc: '2.0', id: 5, method: 'nope' })).json();
    assert.equal(unknown.error.code, -32601);
  });
});

test('MCP tools read, search, write, rename and delete inside the vault', async () => {
  await withMcp(async ({ vault, call, events }) => {
    const read = await call('read_note', { path: 'Case/Plan' });
    assert.match(read.content[0].text, /Nuclear war/);
    const outline = JSON.parse(
      (await call('get_outline', { path: 'Case/Plan.md' })).content[0].text
    );
    assert.deepEqual(
      outline.headings.map((heading) => [heading.level, heading.text]),
      [
        [1, 'Plan'],
        [2, 'Solvency'],
      ]
    );
    const found = JSON.parse((await call('search_notes', { query: 'nuclear' })).content[0].text);
    assert.equal(found.matches[0].line, 3);

    assert.equal(
      (await call('write_note', { path: 'Case/New', content: 'hello' })).isError,
      undefined
    );
    assert.equal(await fs.readFile(path.join(vault, 'Case', 'New.md'), 'utf8'), 'hello');
    const clash = await call('write_note', { path: 'Case/New', content: 'again' });
    assert.equal(clash.isError, true);
    await call('append_to_note', { path: 'Case/New', content: 'more' });
    assert.equal(await fs.readFile(path.join(vault, 'Case', 'New.md'), 'utf8'), 'hello\nmore');
    await call('rename_path', { from: 'Case/New.md', to: 'Case/Moved' });
    assert.equal(await fs.readFile(path.join(vault, 'Case', 'Moved.md'), 'utf8'), 'hello\nmore');
    await call('delete_path', { path: 'Case/Moved.md' });
    await assert.rejects(fs.access(path.join(vault, 'Case', 'Moved.md')));
    await call('open_note', { path: 'Case/Plan' });
    assert.ok(events.includes('open:Case/Plan.md'));
    assert.ok(events.filter((event) => event === 'changed').length >= 4);
  });
});

test('MCP tools refuse paths outside the vault and writes in read-only mode', async () => {
  await withMcp(async ({ call }) => {
    for (const bad of [
      '../outside.md',
      'C:\\Windows\\win.ini',
      '/etc/passwd',
      '.tagline/history.md',
    ]) {
      const result = await call('write_note', { path: bad, content: 'x' });
      assert.equal(result.isError, true, bad);
    }
    assert.equal((await call('read_note', { path: '../secret' })).isError, true);
  });
  await withMcp(
    async ({ call }) => {
      assert.equal((await call('write_note', { path: 'a', content: 'x' })).isError, true);
      assert.equal((await call('read_note', { path: 'Case/Plan' })).isError, undefined);
    },
    { allowWrites: false }
  );
});

test('MCP evidence tools share the app parsers and work in read-only mode', async () => {
  await withMcp(
    async ({ vault, call, post }) => {
      await fs.writeFile(
        path.join(vault, 'Case', 'Cards.md'),
        '#### Impact\n**Smith 2001** — "Example"\nEvidence.\n\n#### No citation\nEvidence.\n'
      );
      const listed = await (await post({ jsonrpc: '2.0', id: 8, method: 'tools/list' })).json();
      for (const name of ['list_cards', 'extract_citation', 'validate_isbn', 'audit_evidence']) {
        assert.equal(
          listed.result.tools.find((tool) => tool.name === name).annotations.readOnlyHint,
          true
        );
      }
      const cards = JSON.parse((await call('list_cards', {})).content[0].text);
      assert.equal(cards.count, 2);
      assert.equal(cards.cards[0].path, 'Case/Cards.md');
      assert.equal(cards.cards[0].citation.author, 'Smith');
      const audit = JSON.parse(
        (await call('audit_evidence', { path: 'Case/Cards', staleYears: 5 })).content[0].text
      );
      assert.equal(audit.cardsScanned, 2);
      assert.ok(audit.issues.some((issue) => issue.kind === 'stale_date'));
      assert.ok(audit.issues.some((issue) => issue.kind === 'missing_citation'));
      assert.ok(!audit.issues.some((issue) => issue.kind === 'dead_link'));
      const citation = JSON.parse(
        (await call('extract_citation', { text: '**Smith 2024** — "Example"' })).content[0].text
      );
      assert.equal(citation.citation.author, 'Smith');
      assert.equal(
        JSON.parse((await call('validate_isbn', { isbn: '978-0-201-89683-1' })).content[0].text)
          .valid,
        true
      );
      assert.equal(
        JSON.parse((await call('validate_isbn', { isbn: '978-0-201-89683-2' })).content[0].text)
          .valid,
        false
      );
      assert.equal((await call('list_cards', { path: '../secret.md' })).isError, true);
      assert.equal((await call('audit_evidence', { staleYears: 0 })).isError, true);
      assert.equal((await call('extract_citation', { text: 'a'.repeat(100001) })).isError, true);
      assert.equal((await call('list_cards', { offset: -1 })).isError, true);
      assert.equal((await call('list_cards', { path: 'example.flow' })).isError, true);
      const page = JSON.parse((await call('list_cards', { limit: 1, offset: 1 })).content[0].text);
      assert.equal(page.count, 2);
      assert.equal(page.cards[0].title, 'No citation');
      assert.equal(page.truncated, false);
      const first = JSON.parse((await call('list_cards', { limit: 1 })).content[0].text);
      assert.equal(first.truncated, true);
    },
    { allowWrites: false }
  );
});

test('MCP evidence scans reject oversized notes, excessive headings and links outside the vault', async () => {
  await withMcp(
    async ({ vault, call }) => {
      const big = path.join(vault, 'Huge.md');
      await fs.writeFile(big, '');
      await fs.truncate(big, 10 * 1024 * 1024 + 1);
      assert.equal((await call('list_cards', { path: 'Huge.md' })).isError, true);
      assert.equal((await call('audit_evidence', {})).isError, true);
      await fs.unlink(big);
      await fs.writeFile(path.join(vault, 'Many.md'), '#### card\n'.repeat(5001));
      assert.equal((await call('list_cards', { path: 'Many.md' })).isError, true);
      await fs.writeFile(path.join(vault, 'Many.md'), '#### card\r'.repeat(5001));
      assert.equal((await call('list_cards', { path: 'Many.md' })).isError, true);
      await fs.unlink(path.join(vault, 'Many.md'));
      // Windows may require developer mode or elevated privileges to create symlinks.
      const outside = path.join(path.dirname(vault), `${path.basename(vault)}-outside.md`);
      await fs.writeFile(outside, '#### Private\n');
      try {
        try {
          await fs.symlink(outside, path.join(vault, 'Outside.md'));
        } catch (error) {
          if (error.code !== 'EPERM' && error.code !== 'EACCES') {
            throw error;
          }
          return;
        }
        assert.equal((await call('list_cards', { path: 'Outside.md' })).isError, true);
        assert.equal((await call('audit_evidence', {})).isError, true);
      } finally {
        await fs.unlink(outside);
      }
    },
    { allowWrites: false }
  );
});

test('MCP configuration is normalized', () => {
  assert.deepEqual(normalizeConfig({ port: 80, allowWrites: false }), {
    enabled: false,
    keepRunning: false,
    allowWrites: false,
    allowModels: false,
    port: 38419,
    token: '',
  });
});

test('MCP model tools require independent permission and return local results', async () => {
  let allowed = false;
  const calls = [];
  const models = {
    embeddings: {
      status: () => ({ ready: true, busy: false }),
      embed: async (text) => (calls.push(text), [0.6, 0.8]),
    },
    summary: {
      status: () => ({ ready: true, busy: false }),
      summarize: async (text) => (calls.push(text), 'short'),
    },
    nli: {
      status: () => ({ ready: false, busy: false }),
      analyze: async (input) => (calls.push(input), { scores: [0.7] }),
    },
  };
  await withMcp(
    async ({ call, post }) => {
      const listed = (await (await post({ jsonrpc: '2.0', id: 8, method: 'tools/list' })).json())
        .result.tools;
      for (const name of [
        'local_model_status',
        'embed_text',
        'summarize_text',
        'analyze_hypotheses',
      ]) {
        assert.ok(listed.some((tool) => tool.name === name));
      }
      const args = [
        ['embed_text', { text: 'query' }],
        ['summarize_text', { text: 'document' }],
        ['analyze_hypotheses', { premise: 'evidence', hypotheses: ['claim'] }],
      ];
      for (const [name, input] of args) {
        assert.equal((await call(name, input)).isError, true);
      }
      assert.equal(calls.length, 0);
      assert.equal(
        JSON.parse((await call('local_model_status', {})).content[0].text).allowed,
        false
      );
      allowed = true;
      assert.deepEqual(JSON.parse((await call(...args[0])).content[0].text).vector, [0.6, 0.8]);
      assert.equal(JSON.parse((await call(...args[1])).content[0].text).summary, 'short');
      assert.deepEqual(JSON.parse((await call(...args[2])).content[0].text).scores, [0.7]);
      for (const hypotheses of [[], [''], Array(11).fill('x'), ['x'.repeat(401)], [42]]) {
        assert.equal(
          (await call('analyze_hypotheses', { premise: 'text', hypotheses })).isError,
          true
        );
      }
      assert.equal(calls.length, 3);
      allowed = false;
      assert.equal((await call(...args[0])).isError, true);
    },
    { allowWrites: false, getAllowModels: () => allowed, getLocalModels: () => models }
  );
});

test('MCP model permission is opt-in, validated, persisted and restricted to the main frame', async () => {
  const handlers = {};
  const webContents = { mainFrame: {} };
  const event = { sender: webContents, senderFrame: webContents.mainFrame };
  let config = {};
  const service = registerMcp({
    app: { getVersion: () => 'test' },
    ipcMain: { handle: (name, handler) => (handlers[name] = handler) },
    getWindow: () => ({ webContents, isDestroyed: () => false }),
    getVaultRoot: () => null,
    getLocalModels: () => null,
    readConfig: () => config,
    writeConfig: (patch) => (config = { ...config, ...patch }),
  });
  try {
    assert.equal(handlers['mcp:status'](event).allowModels, false);
    await assert.rejects(handlers['mcp:configure'](event, { allowModels: 'true' }), /Invalid/);
    await assert.rejects(
      handlers['mcp:configure']({ ...event, senderFrame: {} }, { allowModels: true }),
      /only available/
    );
    assert.equal((await handlers['mcp:configure'](event, { allowModels: true })).allowModels, true);
    assert.equal(config.mcp.allowModels, true);
    assert.equal(handlers['mcp:status'](event).allowModels, true);
    assert.equal(
      (await handlers['mcp:configure'](event, { allowModels: false })).allowModels,
      false
    );
  } finally {
    await service.close();
  }
});

test('platform: dropping an extension folder installs and enables it, gating reviewed permissions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-install-'));
  try {
    const manifest = (extra) =>
      JSON.stringify({
        manifestVersion: 1,
        id: 'dropped',
        name: 'Dropped',
        version: '1.0.0',
        ...extra,
      });
    const source = path.join(root, 'downloads', 'dropped');
    await fs.mkdir(path.join(source, 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(source, 'manifest.json'), manifest({ main: 'main.js' }));
    await fs.writeFile(path.join(source, 'main.js'), 'void 0;');
    await fs.writeFile(path.join(source, 'node_modules', 'skip.js'), 'x');
    let config = {};
    const handlers = {};
    registerExtensions({
      app: { getPath: () => root },
      shell: {},
      ipcMain: { handle: (name, handler) => (handlers[name] = handler) },
      readConfig: () => config,
      writeConfig: (patch) => (config = { ...config, ...patch }),
      dialog: {},
      getWindow: () => null,
    });
    const result = await handlers['extensions:installFolder']({}, path.join(root, 'downloads'));
    assert.deepEqual(
      { id: result.id, enabled: result.enabled, replaced: result.replaced },
      { id: 'dropped', enabled: true, replaced: false }
    );
    assert.deepEqual(config.enabledExtensions, ['dropped']);
    await fs.access(path.join(root, 'extensions', 'dropped', 'main.js'));
    await assert.rejects(fs.access(path.join(root, 'extensions', 'dropped', 'node_modules')));

    await fs.writeFile(
      path.join(source, 'manifest.json'),
      manifest({
        main: 'main.js',
        version: '2.0.0',
        permissions: ['network'],
        networkHosts: ['example.com'],
      })
    );
    const updated = await handlers['extensions:installFolder'](
      {},
      path.join(source, 'manifest.json')
    );
    assert.equal(updated.replaced, true);
    assert.equal(updated.reviewRequired, true);
    assert.equal(updated.enabled, false);

    config = {};
    await fs.rm(path.join(root, 'extensions'), { recursive: true });
    await fs.writeFile(
      path.join(source, 'manifest.json'),
      manifest({ main: 'main.js', permissions: ['ui'] })
    );
    const gated = await handlers['extensions:installFolder']({}, source);
    assert.equal(gated.reviewRequired, true);
    assert.equal(config.enabledExtensions, undefined);

    await fs.rm(path.join(source, 'manifest.json'));
    await assert.rejects(handlers['extensions:installFolder']({}, source), /No manifest\.json/);
    await assert.rejects(handlers['extensions:installFolder']({}, 'relative'), /Choose a folder/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
