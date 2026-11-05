import { isCanvas, isFlow } from './vault.js';

const valid = (value) => value === 'visual' || value === 'edit';

export function migrateEditorModes(saved = {}) {
  const note = valid(saved.editorMode) ? saved.editorMode : 'visual';
  return {
    editorMode: note,
    flowEditorMode: valid(saved.flowEditorMode) ? saved.flowEditorMode : note,
    canvasEditorMode: valid(saved.canvasEditorMode) ? saved.canvasEditorMode : note,
  };
}

export function defaultEditorMode(settings, path) {
  const key = typeof path === 'string' && isFlow(path)
    ? 'flowEditorMode'
    : typeof path === 'string' && isCanvas(path)
      ? 'canvasEditorMode'
      : 'editorMode';
  return valid(settings[key]) ? settings[key] : 'visual';
}
