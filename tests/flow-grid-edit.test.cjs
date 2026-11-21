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
  assert.match(source, /registerPendingFlush\(\(\) => commitRef\.current\(\)\)/);
  assert.match(source, /onCommit=\{\(text\) => setCell\(r, c, text\)\}/);
  assert.doesNotMatch(source, /setCell\(r, c, e\.target\.value\)/);
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
  assert.match(source, /const undoFlow = \(\) => \{\s*flushPendingEdits\(\);/);
  assert.match(source, /const redoFlow = \(\) => \{\s*flushPendingEdits\(\);/);
});

test('removing the last flow row is guarded', async () => {
  const source = await fs.readFile(
    path.join(root, 'src', 'components', 'flow-editor', 'FlowEditor.jsx'),
    'utf8'
  );
  assert.match(source, /const removeRow = \(r\) => \{\s*if \(sheet\.rows\.length === 1\) \{\s*return;\s*\}/);
});
