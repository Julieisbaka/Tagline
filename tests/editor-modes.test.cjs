const { test } = require('node:test');
const assert = require('node:assert/strict');

test('editor defaults migrate legacy settings and honor explicit per-type values', async () => {
  const { migrateEditorModes, defaultEditorMode } = await import('../src/lib/editorModes.js');
  assert.deepEqual(migrateEditorModes({ editorMode: 'edit' }), {
    editorMode: 'edit', flowEditorMode: 'edit', canvasEditorMode: 'edit',
  });
  const settings = migrateEditorModes({ editorMode: 'edit', flowEditorMode: 'visual', canvasEditorMode: 'invalid' });
  assert.equal(defaultEditorMode(settings, 'case.md'), 'edit');
  assert.equal(defaultEditorMode(settings, 'debate.FLOW'), 'visual');
  assert.equal(defaultEditorMode(settings, 'map.CANVAS'), 'edit');
  assert.equal(defaultEditorMode(settings, null), 'edit');
  assert.deepEqual(migrateEditorModes({ editorMode: 'read' }), {
    editorMode: 'visual', flowEditorMode: 'visual', canvasEditorMode: 'visual',
  });
});
