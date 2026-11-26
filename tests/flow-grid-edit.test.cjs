const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('flow cells commit on blur as one edit instead of per keystroke', async () => {
  const source = await fs.readFile(
    path.join(root, 'src', 'components', 'flow-editor', 'FlowGrid.jsx'),
    'utf8'
  );
  assert.match(source, /function FlowCellEditor\(/);
  assert.match(source, /useDraft\(value, onCommit\)/);
  assert.match(source, /onCommit=\{\(text\) => setCell\(r, c, text\)\}/);
  assert.doesNotMatch(source, /setCell\(r, c, e\.target\.value\)/);
  assert.match(source, /onCommit=\{\(name\) => renameColumn\(c, name\)\}/);
  assert.doesNotMatch(source, /renameColumn\(c, e\.target\.value\)/);
});

test('blank column names do not take the negative side color', async () => {
  const source = await fs.readFile(
    path.join(root, 'src', 'components', 'flow-editor', 'FlowGrid.jsx'),
    'utf8'
  );
  assert.match(source, /if \(!col\.trim\(\)\) \{\s*return 'none';/);
});

test('switching sheets remounts the grid so the cursor resets', async () => {
  const source = await fs.readFile(
    path.join(root, 'src', 'components', 'flow-editor', 'FlowEditor.jsx'),
    'utf8'
  );
  assert.match(source, /<FlowGrid\s+key=\{idx\}/);
});

test('undo and redo commit pending cell drafts first', async () => {
  const source = await fs.readFile(
    path.join(root, 'src', 'components', 'flow-editor', 'FlowEditor.jsx'),
    'utf8'
  );
  assert.match(
    source,
    /const undoFlow = \(\) => \{\s*if \(!flushSync\(\(\) => flushPendingEdits\(\)\)\)/
  );
  assert.match(
    source,
    /const redoFlow = \(\) => \{\s*if \(!flushSync\(\(\) => flushPendingEdits\(\)\)\)/
  );
});

test('removing the last flow row is guarded and the controls show it', async () => {
  const { canRemoveRow } = await import('../src/lib/flow/flowRows.js');
  assert.equal(canRemoveRow(0), false);
  assert.equal(canRemoveRow(1), false, 'the only argument row must be kept');
  assert.equal(canRemoveRow(2), true);
  assert.equal(canRemoveRow(10), true);

  const editor = await fs.readFile(
    path.join(root, 'src', 'components', 'flow-editor', 'FlowEditor.jsx'),
    'utf8'
  );
  const grid = await fs.readFile(
    path.join(root, 'src', 'components', 'flow-editor', 'FlowGrid.jsx'),
    'utf8'
  );
  assert.match(editor, /if \(!canRemoveRow\(sheet\.rows\.length\)\)/);
  assert.match(grid, /disabled=\{!canRemoveRow\(sheet\.rows\.length\)\}/);
  assert.match(grid, /\.\.\.\(canRemoveRow\(sheet\.rows\.length\)/);
});
