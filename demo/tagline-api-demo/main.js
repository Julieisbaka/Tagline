// Tagline API demo extension.
// This file is evaluated as the body of an async function with a `tagline`
// parameter: top-level await works, but import/export/require do not.

const EXTENSION_ID = 'tagline-api-demo';
const CUSTOM_EVENT = `ext.${EXTENSION_ID}.ping`;
const PANEL = 'dashboard';
const WEBVIEW = 'inspector';
const SCRATCH_NOTE = 'Tagline API Demo - Scratch.md';
const RENAMED_NOTE = 'Tagline API Demo - Renamed.md';
const INDEX_NOTE = 'Tagline API Demo - Index.md';
const BUILTIN_EVENTS = [
  'vault.changed',
  'vault.fileChanged',
  'note.changed',
  'editor.updated',
  'editor.selectionChanged',
  'editor.ready',
];
const TIPTAP_COMMANDS = [
  'toggleBold', 'toggleItalic', 'toggleUnderline', 'toggleHighlight', 'toggleStrike',
  'toggleHeading', 'setParagraph', 'toggleBulletList', 'toggleOrderedList',
  'toggleBlockquote', 'undo', 'redo', 'unsetAllMarks',
];
const LEAF_NODES = new Set(['hardBreak', 'image', 'horizontalRule']);

const log = [];
let panelReady = false;
let inspectorReady = false;
let panelUpdateTimer = null;
let eventSubscriptions = null;
let stopActiveNoteTracking = null;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const truncate = (text, max) => (text.length > max ? text.slice(0, max - 1) + '…' : text);
const describe = (value) => (typeof value === 'string' ? value : JSON.stringify(value));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function record(kind, detail) {
  log.unshift({ time: new Date().toISOString().slice(11, 19), kind, detail: truncate(describe(detail) ?? '', 300) });
  if (log.length > 50) log.length = 50;
  schedulePanelUpdate();
}

// Batch log updates so busy events (typing, selection) stay far below the
// extension message-rate limit.
function schedulePanelUpdate() {
  if (!panelReady || panelUpdateTimer) return;
  panelUpdateTimer = setTimeout(async () => {
    panelUpdateTimer = null;
    await postToPanel({ type: 'log', entries: log });
  }, 250);
}

async function postToPanel(message) {
  if (!panelReady) return;
  try {
    await tagline.panels.postMessage(PANEL, message);
  } catch {
    // Posting to an unmounted surface rejects; wait for the next ready message.
    panelReady = false;
  }
}

async function requireMarkdownEditor() {
  const note = await tagline.editor.getActiveNote();
  if (!note || !/\.md$/i.test(note.path) || note.mode === 'read') {
    throw new Error('Open a Markdown note in Visual or Edit mode first.');
  }
  return note;
}

async function requireVisualEditor() {
  const note = await requireMarkdownEditor();
  if (note.editorKind !== 'tiptap') {
    throw new Error('Switch to Visual mode; Tiptap commands are unavailable in the source editor.');
  }
  return note;
}

function nodeSize(node) {
  if (node.type === 'text') return node.text.length;
  if (LEAF_NODES.has(node.type)) return 1;
  return 2 + (node.content || []).reduce((sum, child) => sum + nodeSize(child), 0);
}

// Converts a Tiptap JSON document into the ProseMirror position range of its
// first word. Positions count node boundaries, so text usually starts at 1.
function firstWordInDoc(doc) {
  function walk(node, start) {
    let pos = start;
    for (const child of node.content || []) {
      if (child.type === 'text') {
        const match = /\S+/.exec(child.text);
        if (match) return { from: pos + match.index, to: pos + match.index + match[0].length };
      } else if (!LEAF_NODES.has(child.type)) {
        const found = walk(child, pos + 1);
        if (found) return found;
      }
      pos += nodeSize(child);
    }
    return null;
  }
  return walk(doc, 0);
}

// ---------------------------------------------------------------------------
// Commands and notifications
// ---------------------------------------------------------------------------

async function demoNotify() {
  const greeting = await tagline.settings.get('greeting');
  await tagline.notify(greeting);
  return `Notified: ${greeting}`;
}

// ---------------------------------------------------------------------------
// Editor (requires `editor`)
// ---------------------------------------------------------------------------

async function demoDescribeNote() {
  const note = await tagline.editor.getActiveNote();
  if (!note) return 'No active note.';
  const isFlow = /\.flow$/i.test(note.path);
  const words = isFlow
    ? null
    : (await tagline.helpers.markdown.toText(note.content.slice(0, 100000))).split(/\s+/).filter(Boolean).length;
  return [
    note.path,
    `mode=${note.mode}`,
    `editor=${note.editorKind}`,
    isFlow ? `${note.content.length} chars (flow)` : `${words} words`,
    `selectionRange=${JSON.stringify(note.selectionRange)}`,
    note.selection ? `selected "${truncate(note.selection, 60)}"` : 'no selected text',
  ].join(' · ');
}

async function demoInsertText() {
  const note = await requireMarkdownEditor();
  const style = await tagline.settings.get('insert-style');
  const stamp = new Date().toLocaleString();
  const text = style === 'quote'
    ? `\n\n> **Tagline API demo:** inserted into *${note.path}* at ${stamp}.\n`
    : `\n\nTagline API demo: inserted into ${note.path} at ${stamp}.\n`;
  await tagline.editor.insertText(text);
  return `Inserted ${style} text into ${note.path} (${note.editorKind} editor).`;
}

async function demoSelectFirstWord() {
  const note = await requireMarkdownEditor();
  let range;
  if (note.editorKind === 'source') {
    // Source mode: 0-based character offsets into the Markdown source.
    const match = /[A-Za-z0-9][^\s]*/.exec(note.content);
    if (!match) throw new Error('The note has no words to select.');
    range = { from: match.index, to: match.index + match[0].length };
  } else {
    // Visual mode: ProseMirror document positions.
    const snapshot = await tagline.editor.tiptap.getSnapshot();
    range = firstWordInDoc(snapshot.doc);
    if (!range || range.to > snapshot.size) throw new Error('The note has no words to select.');
  }
  await tagline.editor.setSelection(range);
  const after = await tagline.editor.getActiveNote();
  return `Selected ${JSON.stringify(after.selectionRange)} "${after.selection}" using ${note.editorKind} coordinates.`;
}

// ---------------------------------------------------------------------------
// Tiptap bridge (requires `editor` and the visual editor)
// ---------------------------------------------------------------------------

async function demoTiptap(command, options) {
  if (!TIPTAP_COMMANDS.includes(command)) throw new Error(`Unsupported Tiptap command: ${command}`);
  await requireVisualEditor();
  const before = await tagline.editor.tiptap.getSnapshot();
  if (command === 'toggleHeading') await tagline.editor.tiptap.runCommand(command, { level: options?.level ?? 2 });
  else await tagline.editor.tiptap.runCommand(command);
  const after = await tagline.editor.tiptap.getSnapshot();
  const blocks = (after.doc.content || []).map((node) => node.type);
  return `${command} ran on ${after.path}; selection ${JSON.stringify(before.selection)} → ${JSON.stringify(after.selection)}; ` +
    `size ${before.size} → ${after.size}; top-level blocks: ${truncate(blocks.join(', '), 120)}`;
}

// ---------------------------------------------------------------------------
// Active-note changes (requires `editor:active-note`)
// ---------------------------------------------------------------------------

async function demoToggleActiveNoteTracking() {
  if (stopActiveNoteTracking) {
    const stop = stopActiveNoteTracking;
    stopActiveNoteTracking = null;
    await stop();
    return 'Stopped tracking active-note changes.';
  }
  stopActiveNoteTracking = await tagline.editor.onActiveNoteChanged(async ({ path }) => {
    record('editor.onActiveNoteChanged', { path });
    if (!path) return;
    const recent = (await tagline.storage.get('recentNotes')) || [];
    await tagline.storage.set('recentNotes', [path, ...recent.filter((item) => item !== path)].slice(0, 10));
  });
  const recent = (await tagline.storage.get('recentNotes')) || [];
  return `Tracking active-note changes (path only). Previously recorded: ${recent.length ? recent.join(', ') : 'none'}.`;
}

// ---------------------------------------------------------------------------
// Application event bus (requires `events` plus each event's data permission)
// ---------------------------------------------------------------------------

async function startEventLog() {
  if (eventSubscriptions) return;
  const group = tagline.helpers.createDisposables();
  try {
    for (const name of [...BUILTIN_EVENTS, CUSTOM_EVENT]) {
      group.add(await tagline.events.on(name, (payload) => record(name, payload)));
    }
  } catch (error) {
    await group.dispose();
    throw error;
  }
  eventSubscriptions = group;
}

async function stopEventLog() {
  if (!eventSubscriptions) return;
  const group = eventSubscriptions;
  eventSubscriptions = null;
  await group.dispose();
}

async function demoToggleEventLog() {
  const enable = !eventSubscriptions;
  if (enable) await startEventLog();
  else await stopEventLog();
  await tagline.settings.set('log-events', enable);
  return enable
    ? `Listening to ${BUILTIN_EVENTS.length} application events and ${CUSTOM_EVENT}.`
    : 'Stopped listening to events.';
}

async function demoEmitEvent() {
  const count = ((await tagline.storage.get('pingCount')) || 0) + 1;
  await tagline.storage.set('pingCount', count);
  await tagline.events.emit(CUSTOM_EVENT, { count, at: new Date().toISOString() });
  return `Emitted ${CUSTOM_EVENT} #${count}${eventSubscriptions ? ' (see the event log)' : '; enable the event log to see it'}.`;
}

// ---------------------------------------------------------------------------
// Helpers (no permission)
// ---------------------------------------------------------------------------

async function demoHelpers() {
  const { path } = tagline.helpers;
  const joined = await path.join('Research', 'Energy', '..', 'Card.md');
  const results = [
    `join → ${joined}`,
    `normalize → ${await path.normalize('Research/./Energy//Card.md')}`,
    `basename → ${await path.basename(joined)}`,
    `dirname → ${await path.dirname(joined)}`,
    `extname → ${await path.extname(joined)}`,
    `markdown.toText → ${await tagline.helpers.markdown.toText('## **Evidence** from _Smith 24_ [source](https://example.com)')}`,
  ];
  const canvas = tagline.helpers.canvas;
  const node = await canvas.createNode('text');
  results.push(`canvas.createId → ${await canvas.createId()}`);
  results.push(`canvas.resolveLink → ${describe(await canvas.resolveLink('[[Round.flow#Speech|Round]]', ['Round.flow']))}`);
  results.push(`canvas.suggestFiles → ${describe(await canvas.suggestFiles(['Card.md', 'Round.flow'], 'Card'))}`);
  results.push(`canvas.moveNodes → ${describe(await canvas.moveNodes({ nodes: [node], edges: [] }, [node.id], 40, 20))}`);
  try {
    await path.normalize('../outside.md');
    results.push('normalize("../outside.md") unexpectedly succeeded');
  } catch {
    results.push('normalize("../outside.md") rejected traversal');
  }
  const disposed = [];
  const group = tagline.helpers.createDisposables();
  group.add(() => disposed.push('first'));
  group.add(async () => disposed.push('second'));
  await group.dispose();
  results.push(`createDisposables disposed: ${disposed.join(', ')}`);
  return results.join(' | ');
}

// ---------------------------------------------------------------------------
// Typed settings (requires `settings`)
// ---------------------------------------------------------------------------

async function demoSettings() {
  const ids = ['greeting', 'insert-style', 'index-limit', 'log-events', 'keep-scratch-note'];
  const values = [];
  for (const id of ids) values.push(`${id}=${JSON.stringify(await tagline.settings.get(id))}`);
  let validation = 'string "5" for a number setting was accepted (unexpected)';
  try {
    await tagline.settings.set('index-limit', '5');
  } catch {
    validation = 'string "5" for a number setting was rejected';
  }
  return `${values.join(', ')}. ${validation}. Edit values under Settings > Extensions.`;
}

// ---------------------------------------------------------------------------
// Private storage (no permission)
// ---------------------------------------------------------------------------

async function demoStorage() {
  const runs = ((await tagline.storage.get('storageRuns')) || 0) + 1;
  await tagline.storage.set('storageRuns', runs);
  await tagline.storage.set('temporary', { createdAt: Date.now() });
  const stored = await tagline.storage.get('temporary');
  await tagline.storage.set('temporary', null);
  const removed = await tagline.storage.get('temporary');
  return `storageRuns=${runs}; "temporary" was ${stored ? 'stored' : 'missing'} and is now ${removed === null ? 'deleted' : 'still present'}.`;
}

// ---------------------------------------------------------------------------
// Vault (requires `vault:read` and/or `vault:write`)
// ---------------------------------------------------------------------------

async function demoVaultIndex() {
  const limit = await tagline.settings.get('index-limit');
  const paths = (await tagline.vault.list()).filter((path) => path !== INDEX_NOTE);
  const lines = [];
  for (const path of paths.slice(0, limit)) {
    const content = await tagline.vault.read(path);
    const detail = /\.flow$/i.test(path)
      ? 'flow'
      : `${(await tagline.helpers.markdown.toText(content.slice(0, 100000))).split(/\s+/).filter(Boolean).length} words`;
    const name = await tagline.helpers.path.basename(path);
    lines.push(`- [[${path.replace(/\.md$/i, '')}|${name}]] (${detail})`);
  }
  const saved = await tagline.vault.write(
    INDEX_NOTE,
    `# Vault index\n\nGenerated by the API demo on ${new Date().toLocaleString()}.\n` +
    `Showing ${lines.length} of ${paths.length} notes.\n\n${lines.join('\n')}\n`,
  );
  return `Wrote ${saved} listing ${lines.length} of ${paths.length} notes.`;
}

async function demoVaultLifecycle() {
  const existing = await tagline.vault.list();
  const leftover = [SCRATCH_NOTE, RENAMED_NOTE].find((path) => existing.includes(path));
  if (leftover) throw new Error(`"${leftover}" already exists. Delete or rename it, then run the demo again.`);

  const events = [];
  const stopWatching = await tagline.vault.watch((event) => {
    events.push(event);
    record('vault.watch', event);
  });
  const steps = [];
  try {
    const path = await tagline.vault.write(SCRATCH_NOTE, '# Scratch\n\nCreated by vault.write.\n');
    steps.push(`write → ${path}`);

    await tagline.vault.append(path, '\nAdded by vault.append.\n');
    const current = await tagline.vault.read(path);
    steps.push(`append + read → ${current.length} chars`);

    const swapped = await tagline.vault.compareAndSwap(path, current, current + '\nReplaced by vault.compareAndSwap.\n');
    const stale = await tagline.vault.compareAndSwap(path, current, 'Stale content must never win.');
    steps.push(`compareAndSwap → ${swapped} then stale ${stale}`);

    await tagline.vault.flush();
    steps.push('flush → saved');

    const renamed = await tagline.vault.rename(path, RENAMED_NOTE);
    steps.push(`rename → ${renamed}`);

    if (await tagline.settings.get('keep-scratch-note')) {
      steps.push('kept note (keep-scratch-note is on)');
    } else {
      await tagline.vault.delete(renamed);
      steps.push('delete → moved to trash');
    }
    await sleep(100);
  } finally {
    await stopWatching();
  }
  const summary = events.map((event) => event.type + (event.path ? `:${event.path}` : '')).join(', ');
  return `${steps.join(' | ')} | watch saw ${events.length} events: ${truncate(summary, 200)}`;
}

// ---------------------------------------------------------------------------
// Sidebar panel and webview (requires `ui`)
// ---------------------------------------------------------------------------

const DEMOS = [
  { id: 'notify', label: 'Notify', group: 'Commands', run: demoNotify },
  { id: 'describe-note', label: 'Describe note', group: 'Editor', run: demoDescribeNote },
  { id: 'insert-text', label: 'Insert text', group: 'Editor', run: demoInsertText },
  { id: 'select-first-word', label: 'Select first word', group: 'Editor', run: demoSelectFirstWord },
  { id: 'bold-selection', label: 'Bold selection', group: 'Tiptap', run: () => demoTiptap('toggleBold') },
  { id: 'toggle-heading', label: 'Heading 2', group: 'Tiptap', run: () => demoTiptap('toggleHeading', { level: 2 }) },
  { id: 'undo', label: 'Undo', group: 'Tiptap', run: () => demoTiptap('undo') },
  { id: 'toggle-active-note-tracking', label: 'Track active note', group: 'Events', run: demoToggleActiveNoteTracking },
  { id: 'toggle-event-log', label: 'Toggle event log', group: 'Events', run: demoToggleEventLog },
  { id: 'emit-event', label: 'Emit custom event', group: 'Events', run: demoEmitEvent },
  { id: 'helpers', label: 'Helpers', group: 'Data', run: demoHelpers },
  { id: 'settings', label: 'Settings', group: 'Data', run: demoSettings },
  { id: 'storage', label: 'Storage', group: 'Data', run: demoStorage },
  { id: 'vault-index', label: 'Write index', group: 'Vault', run: demoVaultIndex },
  { id: 'vault-lifecycle', label: 'Lifecycle', group: 'Vault', run: demoVaultLifecycle },
  { id: 'open-inspector', label: 'Open inspector', group: 'UI', run: openInspector },
];

async function runDemo(id, options) {
  const demo = id === 'tiptap'
    ? { label: `Tiptap ${options?.command}`, run: () => demoTiptap(options?.command, options) }
    : DEMOS.find((item) => item.id === id);
  if (!demo) return { ok: false, text: `Unknown demo: ${id}` };
  try {
    const text = await demo.run();
    record(`demo:${id}`, text);
    return { ok: true, text };
  } catch (error) {
    const text = error?.message || String(error);
    record(`demo:${id} failed`, text);
    return { ok: false, text };
  }
}

async function snapshotForInspector() {
  const note = await tagline.editor.getActiveNote();
  if (!note) return { type: 'snapshot', note: null };
  let tiptap = null;
  if (note.editorKind === 'tiptap') {
    const snapshot = await tagline.editor.tiptap.getSnapshot();
    tiptap = {
      size: snapshot.size,
      selection: snapshot.selection,
      blocks: (snapshot.doc.content || []).slice(0, 30).map((node) => node.type),
      text: truncate(snapshot.text, 400),
    };
  }
  return {
    type: 'snapshot',
    note: {
      path: note.path,
      mode: note.mode,
      editorKind: note.editorKind,
      selectionRange: note.selectionRange,
      selection: truncate(note.selection || '', 200),
      length: note.content.length,
    },
    tiptap,
  };
}

async function postToInspector(message) {
  if (!inspectorReady) return;
  try {
    await tagline.webviews.postMessage(WEBVIEW, message);
  } catch {
    inspectorReady = false;
  }
}

async function openPanel() {
  await tagline.panels.show(PANEL);
  return 'Dashboard opened in the right sidebar (show the sidebar if it is hidden).';
}

async function openInspector() {
  await tagline.webviews.show(WEBVIEW);
  return 'Inspector opened.';
}

async function closeSurfaces() {
  panelReady = false;
  inspectorReady = false;
  await tagline.panels.close(PANEL);
  await tagline.webviews.close(WEBVIEW);
  return 'Closed the dashboard and inspector.';
}

const SHARED_STYLE = `
  <style>
    body { font: 13px system-ui, sans-serif; margin: 0; padding: 10px; color: #ddd; background: #1b1b1f; }
    h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #999; margin: 12px 0 6px; }
    button, select { font: inherit; margin: 0 4px 4px 0; padding: 3px 8px; border-radius: 4px;
      border: 1px solid #444; background: #2a2a30; color: #eee; cursor: pointer; }
    button:hover { background: #34343c; }
    pre, .box { white-space: pre-wrap; word-break: break-word; background: #232328; border: 1px solid #333;
      border-radius: 4px; padding: 6px; margin: 0; max-height: 220px; overflow: auto; }
    .error { color: #ff8a80; } .ok { color: #a5d6a7; }
    .entry { border-bottom: 1px solid #2c2c33; padding: 2px 0; }
    .kind { color: #9ac7ff; } .time { color: #777; }
    dt { color: #999; } dd { margin: 0 0 6px; }
  </style>`;

// The panel script uses only DOM APIs and textContent; no data is ever
// interpolated into the HTML string itself.
const PANEL_HTML = SHARED_STYLE + `
  <div id="groups"></div>
  <h2>Tiptap command</h2>
  <select id="command"></select><select id="level"></select><button id="run-command">Run</button>
  <h2>Result</h2>
  <pre id="result">Choose a demo.</pre>
  <h2>Event log</h2>
  <div id="log" class="box"></div>
  <script>
    const groups = document.getElementById('groups');
    const result = document.getElementById('result');
    const command = document.getElementById('command');
    const level = document.getElementById('level');
    for (let i = 1; i <= 6; i++) level.add(new Option('H' + i, String(i), i === 2, i === 2));

    function renderLog(entries) {
      const box = document.getElementById('log');
      box.replaceChildren(...entries.map(entry => {
        const row = document.createElement('div');
        row.className = 'entry';
        const time = document.createElement('span'); time.className = 'time'; time.textContent = entry.time + ' ';
        const kind = document.createElement('span'); kind.className = 'kind'; kind.textContent = entry.kind + ' ';
        const detail = document.createElement('span'); detail.textContent = entry.detail;
        row.append(time, kind, detail);
        return row;
      }));
      if (!entries.length) box.textContent = 'No events yet.';
    }

    function run(id, options) {
      result.className = '';
      result.textContent = 'Running ' + id + '…';
      taglineWebview.postMessage({ run: id, options });
    }

    taglineWebview.onMessage(message => {
      if (message.type === 'init') {
        const byGroup = {};
        for (const demo of message.demos) (byGroup[demo.group] ||= []).push(demo);
        groups.replaceChildren();
        for (const [name, demos] of Object.entries(byGroup)) {
          const heading = document.createElement('h2'); heading.textContent = name;
          groups.append(heading);
          for (const demo of demos) {
            const button = document.createElement('button');
            button.textContent = demo.label;
            button.addEventListener('click', () => run(demo.id));
            groups.append(button);
          }
        }
        command.replaceChildren(...message.tiptapCommands.map(name => new Option(name, name)));
        renderLog(message.log);
      } else if (message.type === 'result') {
        result.className = message.ok ? 'ok' : 'error';
        result.textContent = message.text;
      } else if (message.type === 'log') {
        renderLog(message.entries);
      }
    });

    document.getElementById('run-command').addEventListener('click', () =>
      run('tiptap', { command: command.value, level: Number(level.value) }));

    taglineWebview.postMessage({ ready: true });
  </script>`;

const INSPECTOR_HTML = SHARED_STYLE + `
  <button id="refresh">Refresh</button><button id="close">Close</button>
  <dl id="details"><dd>Loading…</dd></dl>
  <script>
    const details = document.getElementById('details');
    function row(label, value) {
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); dd.textContent = typeof value === 'string' ? value : JSON.stringify(value);
      details.append(dt, dd);
    }
    taglineWebview.onMessage(message => {
      if (message.type !== 'snapshot') return;
      details.replaceChildren();
      if (!message.note) { row('Active note', 'None'); return; }
      const note = message.note;
      row('Path', note.path);
      row('Mode / editor', note.mode + ' / ' + note.editorKind);
      row('Content length', note.length + ' characters (includes unsaved edits)');
      row('Selection range', note.selectionRange);
      row('Selected text', note.selection || '(none)');
      if (message.tiptap) {
        row('Tiptap size', message.tiptap.size);
        row('Tiptap selection', message.tiptap.selection);
        row('Top-level blocks', message.tiptap.blocks.join(', '));
        row('Plain text', message.tiptap.text);
      } else {
        row('Tiptap', 'Unavailable outside the visual Markdown editor');
      }
    });
    document.getElementById('refresh').addEventListener('click', () => taglineWebview.postMessage({ refresh: true }));
    document.getElementById('close').addEventListener('click', () => taglineWebview.postMessage({ close: true }));
    taglineWebview.postMessage({ ready: true });
  </script>`;

// Register message handlers before setting HTML or showing a surface. They are
// removed automatically when the extension is disabled or reloaded.
tagline.panels.onMessage(PANEL, async (message) => {
  if (message?.ready) {
    panelReady = true;
    await postToPanel({
      type: 'init',
      demos: DEMOS.map(({ id, label, group }) => ({ id, label, group })),
      tiptapCommands: TIPTAP_COMMANDS,
      log,
    });
  } else if (typeof message?.run === 'string') {
    const outcome = await runDemo(message.run, message.options);
    await postToPanel({ type: 'result', ...outcome });
  }
});

tagline.webviews.onMessage(WEBVIEW, async (message) => {
  if (message?.close) {
    inspectorReady = false;
    await tagline.webviews.close(WEBVIEW);
    return;
  }
  if (message?.ready) inspectorReady = true;
  if (message?.ready || message?.refresh) {
    try {
      await postToInspector(await snapshotForInspector());
    } catch (error) {
      record('inspector failed', error?.message || String(error));
    }
  }
});

await tagline.panels.setHtml(PANEL, PANEL_HTML);
await tagline.webviews.setHtml(WEBVIEW, INSPECTOR_HTML);
tagline.onInstall(async () => {
  if (!(await tagline.storage.get('installedAt'))) {
    await tagline.storage.set('installedAt', new Date().toISOString());
  }
  await openPanel();
  await tagline.notify('Setup complete. Try the demos in the API dashboard.');
});

// ---------------------------------------------------------------------------
// Command registration (every contributed command needs a handler)
// ---------------------------------------------------------------------------

async function registerDemoCommand(id) {
  await tagline.commands.register(id, async () => {
    const outcome = await runDemo(id);
    await tagline.notify(truncate((outcome.ok ? '' : 'Failed: ') + outcome.text, 480));
    await postToPanel({ type: 'result', ...outcome });
  });
}

for (const demo of DEMOS) {
  if (demo.id !== 'open-inspector') await registerDemoCommand(demo.id);
}
await tagline.commands.register('open-dashboard', openPanel);
await tagline.commands.register('open-inspector', openInspector);
await tagline.commands.register('close-surfaces', async () => {
  await tagline.notify(await closeSurfaces());
});

if (await tagline.settings.get('log-events')) await startEventLog();
record('extension', 'API demo loaded. Run "API Demo: Open API dashboard" to explore.');
