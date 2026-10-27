import { translate } from './i18n.js';
import { binding, displayBinding, KEYBINDINGS } from './keybindings.js';
export { fillTemplate } from './template.js';

/** 
 * Build translated command-palette entries from app actions and keybinding overrides. 
 * @param {object} ctx 
 * @param {object} [overrides] 
 * @returns {object[]} 
 */
export function buildCommands(ctx, overrides = {}) {
  /** 
   * Create one translated palette entry with its current displayed shortcut. 
   * @param {string} id 
   * @param {string} label 
   * @param {function} run 
   * @returns {object} 
   */
  const c = (id, label, run) => ({ id, label: translate(label), run, hotkey: displayBinding(binding(id, overrides)) });
  const list = [
    c('switcher', 'Quick switcher: open file', ctx.openSwitcher, 'Ctrl+O'),
    c('search', 'Search vault', ctx.openSearch, 'Ctrl+Shift+F'),
    c('new-note', 'Create new note', ctx.newNote, 'Ctrl+N'),
    c('new-flow', 'Create new flow', ctx.newFlow),
    c('new-canvas', 'Create new canvas', ctx.newCanvas),
    c('new-folder', 'Create new folder', ctx.newFolder),
    c('from-template', 'Create new note from template', ctx.newFromTemplate),
    c('graph', 'Open graph view', ctx.openGraph, 'Ctrl+G'),
    c('settings', 'Open settings', ctx.openSettings, 'Ctrl+,'),
    c('toggle-left', 'Toggle left sidebar', ctx.toggleLeft),
    c('toggle-right', 'Toggle right sidebar', ctx.toggleRight),
    c('speech-open', 'Speech doc: open current speech doc', ctx.openSpeechDoc),
    c('speech-new', 'Speech doc: start a new speech doc', ctx.newSpeechDoc),
    c('vault-open', 'Open another vault', ctx.switchVault),
    c('vault-sample', 'Create sample vault', ctx.createSample),
    c('reload', 'Reload vault from disk', ctx.reload),
    c('import-document', 'Import document with Pandoc', ctx.importDocument),
    c('opencaselist', 'OpenCaselist: browse and manage disclosures', ctx.openCaselist),
    c('tabroom', 'Tabroom: view and save tournament data', ctx.openTabroom),
    c('citation', 'Create citation', ctx.createCitation),
  ];
  if (ctx.hasNote) {
    list.push(
      c('toggle-mode', 'Toggle reading / editing view', ctx.toggleMode, 'Ctrl+E'),
      c('source-mode', 'Editor: source mode (CodeMirror)', ctx.sourceMode),
      c('visual-mode', 'Editor: visual mode (Tiptap)', ctx.visualMode),
      c('export-note', 'Export note', ctx.exportNote),
      c('test-hypothesis', 'Test a hypothesis against this note (Political DEBATE)', ctx.testHypothesis),
      c('highlight-only', 'Toggle highlighted-only reading', ctx.toggleHighlightOnly, 'Ctrl+Shift+H'),
      c('send-card', 'Send card under cursor to speech doc', ctx.sendCard, 'Ctrl+Shift+S'),
      c('insert-template', 'Insert template at cursor', ctx.insertTemplate),
      c('set-speech', 'Speech doc: use current file as speech doc', ctx.setCurrentAsSpeechDoc),
      c('rename', 'Rename current file', ctx.renameCurrent),
      c('delete', 'Delete current file', ctx.deleteCurrent),
      c('reveal', 'Reveal current file in file explorer', ctx.revealCurrent),
      c('close-tab', 'Close current tab', ctx.closeTab, 'Ctrl+W'),
    );
  }
  const markdownOnly = ['export-note', 'test-hypothesis', 'highlight-only', 'send-card', 'insert-template', 'set-speech'];
  const available = list.filter((item) => ctx.isMarkdown || !markdownOnly.includes(item.id));
  for (const item of KEYBINDINGS) {
    if (available.some((command) => command.id === item.id)) continue;
    if (item.markdown && !ctx.isMarkdown) continue;
    if (item.scope === 'app' && (!item.note || ctx.hasNote) && ctx[item.action]) {
      available.push(c(item.id, item.label, ctx[item.action]));
    } else if ((item.scope === 'canvas' && ctx.canCanvas) || (item.scope === 'flow' && ctx.canFlow)) {
      available.push(c(item.id, item.label, () => ctx.workspaceAction(item.id)));
    }
  }
  return available;
}
