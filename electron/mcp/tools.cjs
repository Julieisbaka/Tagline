const fs = require('node:fs/promises');
const path = require('node:path');
const { NOTE_EXTS, listVault, readVaultSnapshot } = require('../vaultFiles.cjs');
const { ToolError, flatten, outline } = require('./vault.cjs');

function createTools(
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
    root,
    resolve,
    requireWrites,
    requireModels,
    exists,
    checkContent,
    readNote,
  },
  evidenceTools
) {
  const pathProperty = (description) => ({ type: 'string', description });
  return [
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
          allowModels: !!getAllowModels(),
          noteExtensions: NOTE_EXTS,
        };
      },
    },
    {
      name: 'local_model_status',
      title: 'Local model status',
      description:
        'Report whether agent model access is enabled and each local model is loaded or busy.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      run: async () => {
        const models = getLocalModels();
        return {
          allowed: !!getAllowModels(),
          models: models
            ? Object.fromEntries(
                Object.entries(models).map(([name, model]) => [name, model.status()])
              )
            : {},
        };
      },
    },
    {
      name: 'embed_text',
      title: 'Embed text locally',
      description:
        'Generate a normalized embedding with the loaded local semantic search model. Long text may be truncated by the model.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', minLength: 1, maxLength: 10000 } },
        required: ['text'],
      },
      annotations: { readOnlyHint: true },
      run: async ({ text } = {}) => ({
        model: 'Xenova/all-MiniLM-L6-v2',
        vector: await requireModels().embeddings.embed(text),
      }),
    },
    {
      name: 'summarize_text',
      title: 'Summarize text locally',
      description:
        'Summarize text with the loaded local summary model. Long inputs may be truncated.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', minLength: 1, maxLength: 500000 } },
        required: ['text'],
      },
      annotations: { readOnlyHint: true },
      run: async ({ text } = {}) => ({ summary: await requireModels().summary.summarize(text) }),
    },
    {
      name: 'analyze_hypotheses',
      title: 'Analyze hypotheses locally',
      description:
        'Score whether passages support hypotheses using the loaded Political DEBATE model. Scores are estimates, not verified facts.',
      inputSchema: {
        type: 'object',
        properties: {
          premise: { type: 'string', minLength: 1, maxLength: 200000 },
          hypotheses: {
            type: 'array',
            minItems: 1,
            maxItems: 10,
            items: { type: 'string', maxLength: 400 },
          },
        },
        required: ['premise', 'hypotheses'],
      },
      annotations: { readOnlyHint: true },
      run: async ({ premise, hypotheses } = {}) => {
        const models = requireModels();
        if (
          typeof premise !== 'string' ||
          premise.length > 200000 ||
          !Array.isArray(hypotheses) ||
          hypotheses.length < 1 ||
          hypotheses.length > 10 ||
          hypotheses.some((item) => typeof item !== 'string' || !item.trim() || item.length > 400)
        ) {
          throw new ToolError('Provide text and 1 to 10 hypotheses of up to 400 characters each.');
        }
        return models.nli.analyze({ premise, hypotheses });
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
    ...evidenceTools,
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
}

module.exports = { createTools };
