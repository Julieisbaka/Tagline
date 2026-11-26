const { test } = require('node:test');
const assert = require('node:assert/strict');

test('frontmatter edits are isolated in the visual editor history', async () => {
  const { Schema } = await import('@tiptap/pm/model');
  const { EditorState } = await import('@tiptap/pm/state');
  const { history, undo, redo } = await import('@tiptap/pm/history');
  const { recordFrontmatter, FrontmatterStep } =
    await import('../src/lib/editor/frontmatterHistory.js');
  const schema = new Schema({
    nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} },
  });
  let state = EditorState.create({ schema, plugins: [history()] });
  let prefix = 'old';
  const editor = {
    get state() {
      return state;
    },
    view: {
      dispatch(tr) {
        for (const step of tr.steps) {
          if (step instanceof FrontmatterStep) {
            prefix = step.after;
          }
        }
        state = state.apply(tr);
      },
    },
  };
  editor.view.dispatch(state.tr.insertText('body', 1));
  recordFrontmatter(editor, 'old', 'new');
  editor.view.dispatch(state.tr.insertText('!', 5));
  assert.equal(undo(state, editor.view.dispatch), true);
  assert.equal(state.doc.textContent, 'body');
  assert.equal(prefix, 'new');
  assert.equal(undo(state, editor.view.dispatch), true);
  assert.equal(prefix, 'old');
  assert.equal(state.doc.textContent, 'body');
  assert.equal(redo(state, editor.view.dispatch), true);
  assert.equal(prefix, 'new');
  assert.equal(redo(state, editor.view.dispatch), true);
  assert.equal(state.doc.textContent, 'body!');
});
