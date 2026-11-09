const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv');

const { reviewSignature, validateManifest } = require('../electron/extensions/manifest.cjs');

const root = path.join(__dirname, 'fixture');
const rawManifest = () => ({
  manifestVersion: 1,
  id: 'contrib-test',
  name: 'Contribution Test',
  version: '1.0',
  main: 'main.js',
  permissions: ['ui'],
  contributes: {
    commands: [{ id: 'open', title: 'Open' }],
    panels: [
      {
        id: 'panel',
        title: 'Panel',
        placement: 'sidebar-bottom',
        persistVisibility: true,
        when: { extensions: ['.md'], mode: 'edit' },
      },
    ],
    statusBarItems: [{ id: 'status', title: 'Ready', icon: 'check', command: 'open' }],
    contextMenus: [{ id: 'editor-menu', title: 'Run', context: 'editor', command: 'open' }],
    fileHandlers: [
      {
        id: 'markdown-handler',
        title: 'Preview',
        extensions: ['.md'],
        command: 'open',
        priority: 12,
      },
    ],
  },
});

test('manifest validates extension contributions and includes them in explicit review', () => {
  const raw = rawManifest();
  const manifest = validateManifest(raw, root);
  assert.deepEqual(manifest.contributes.panels[0], {
    id: 'panel',
    title: 'Panel',
    placement: 'sidebar-bottom',
    persistVisibility: true,
    when: { extensions: ['.md'], mode: 'edit' },
  });
  assert.equal(manifest.contributes.fileHandlers[0].priority, 12);
  assert.notEqual(
    reviewSignature(manifest),
    reviewSignature(
      validateManifest(
        {
          ...raw,
          contributes: {
            ...raw.contributes,
            fileHandlers: [{ ...raw.contributes.fileHandlers[0], priority: 13 }],
          },
        },
        root
      )
    )
  );
  assert.throws(
    () =>
      validateManifest(
        {
          ...raw,
          contributes: {
            ...raw.contributes,
            panels: [{ id: 'panel', title: 'Panel', when: { arbitrary: true } }],
          },
        },
        root
      ),
    /unsupported condition/
  );
  assert.throws(
    () =>
      validateManifest(
        {
          ...raw,
          contributes: {
            ...raw.contributes,
            fileHandlers: [
              { id: 'bad-handler', title: 'Preview', extensions: ['.pdf'], command: 'open' },
            ],
          },
        },
        root
      ),
    /supported extensions/
  );
});

test('manifest schema covers panel filters and the UI contribution declarations', () => {
  const schema = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'schemas', 'extension-manifest.schema.json'), 'utf8')
  );
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  assert.equal(validate(rawManifest()), true, JSON.stringify(validate.errors));
  const invalid = rawManifest();
  invalid.contributes.panels[0].when = { arbitrary: true };
  assert.equal(validate(invalid), false);
});

test('status bar updates and command contexts stay within declared UI capabilities', async () => {
  const { ExtensionHost } = await import('../src/lib/extensions.js');
  const updates = [];
  const sent = [];
  const manifest = validateManifest(rawManifest(), root);
  const host = new ExtensionHost(manifest, '', {
    updateStatusBar: (_host, items) => updates.push(items),
  });
  await host.handle('ui.statusBar.setText', ['status', '2 sources']);
  await host.handle('ui.statusBar.setIcon', ['status', 'search']);
  await host.handle('ui.statusBar.setTooltip', ['status', 'Open research']);
  await host.handle('ui.statusBar.setCommand', ['status', 'open']);
  assert.deepEqual(updates.at(-1), [
    { id: 'status', text: '2 sources', icon: 'search', tooltip: 'Open research', command: 'open' },
  ]);
  await assert.rejects(
    host.handle('ui.statusBar.setCommand', ['status', 'missing']),
    /declared command/
  );
  await assert.rejects(host.handle('ui.statusBar.setText', ['missing', 'x']), /Undeclared/);

  host.frame = {};
  host.port = { postMessage: (message) => sent.push(message) };
  host.registered.add('open');
  host.run('open', { path: 'Case.md', selection: 'selected text', uri: 'tagline://note/Case.md' });
  assert.deepEqual(sent.at(-1), {
    type: 'command',
    command: 'open',
    context: { path: 'Case.md', selection: 'selected text', uri: 'tagline://note/Case.md' },
  });
  assert.throws(
    () => host.run('open', { path: 'x.md', selection: 'x'.repeat(9000) }),
    /8,192 bytes/
  );
  assert.throws(() => host.run('missing'), /not registered/);
});
