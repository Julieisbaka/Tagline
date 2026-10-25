# Extension API

[Documentation home](./README.md) | [Theme API](./theme-api.md)

Extensions can add commands, ribbon shortcuts, settings, themes, sidebar panels, and dialogs.
Entry scripts run in a sandboxed worker and use the supplied `tagline` bridge;
they have no access to the app DOM or Node.js.

For a complete working example of every API in this reference, see the
[API demo extension](../demo/README.md).

## Install and reload

1. Open **Settings > Extensions > Open extensions folder**.
2. Create a subfolder containing `manifest.json` and its referenced files.
3. Select **Reload extensions**.
4. Review the listed permissions, then enable the extension.
5. Find its commands in the command palette (`Mod+P`), and its themes in
   **Settings > Appearance > Theme**.

Extensions are stored in the app profile, not in a vault. Use the settings
button to open the installation folder.

After changing an extension, reload it. Reloading tears down and recreates enabled
script hosts. Disabling an extension removes its running host and contributions;
its private stored data is not explicitly deleted.

## Minimal command extension

Create this folder:

```text
debate-tools/
  manifest.json
  main.js
```

`manifest.json`:

```json
{
  "manifestVersion": 1,
  "id": "debate-tools",
  "name": "Debate Tools",
  "version": "0.1.0",
  "description": "Insert a reminder into the active note.",
  "author": "Your name",
  "main": "main.js",
  "permissions": ["editor"],
  "contributes": {
    "commands": [
      {
        "id": "insert-reminder",
        "title": "Insert evidence reminder",
        "key": "Mod+Alt+K"
      }
    ]
  }
}
```

`main.js`:

```js
await tagline.commands.register('insert-reminder', async () => {
  const note = await tagline.editor.getActiveNote();
  if (!note || !/\.md$/i.test(note.path) || note.mode === 'read') {
    await tagline.notify('Open a Markdown note in an editing mode first.');
    return;
  }
  await tagline.editor.insertText('\n\nVerify author, date, and source before use.\n');
});
```

The command appears as **Debate Tools: Insert evidence reminder**. Its internal
application command ID is `ext:debate-tools.insert-reminder`.

The entry script is evaluated as an async function with a `tagline` parameter,
so top-level `await` works. It is **not** an ES module: do not use top-level
`import`/`export` or CommonJS `require`. Bundle dependencies into one
self-contained script if necessary. There is no package loader.

### First-install setup

Register one `tagline.onInstall(handler)` during entry-script initialization.
Registration is synchronous and returns nothing. After the entry script
finishes, Tagline awaits the callback before marking the host ready:

```js
tagline.onInstall(async () => {
  if (!(await tagline.storage.get('installedAt'))) {
    await tagline.storage.set('installedAt', new Date().toISOString());
  }
  await tagline.webviews.setHtml('welcome', '<h2>Welcome!</h2><p>Configure this extension in Settings.</p>');
  await tagline.webviews.show('welcome');
});
```

This example requires `ui` permission and a declared `welcome` webview. Hooks
have the same permissions and API limits as commands; storage alone needs no
permission. Do not assume a vault or editor is open. Duplicate handlers or
registration after the entry script finishes throw.

The hook runs on first successful script activation in the current profile,
including the first activation of extensions installed before this API existed.
Successful setup is remembered by extension ID, independently of private
extension storage. Reloads, version updates, disabling/re-enabling, and manually
removing/replacing the same ID do not repeat it. Theme-only extensions have no
script hook. An extension without a hook is also marked initialized after its
first successful activation.

Thrown/rejected setup appears on the extension card and is retried next load.
Use idempotent setup: interruptions before completion is recorded can retry
operations already performed. Entry evaluation and setup share the normal
startup deadline (10 seconds by default). Show onboarding UI, then return;
do not wait for the user to finish that UI inside the callback.

## Manifest reference

| Field | Required | Contract |
| --- | --- | --- |
| `manifestVersion` | Yes | Number `1`. |
| `id` | Yes | 2-64 characters; starts with a lowercase letter or digit, then lowercase letters, digits, or `-`. Unique across installed valid manifests. |
| `name` | Yes | Nonblank string, at most 80 characters. |
| `version` | Yes | Nonblank string, at most 80 characters; semantic-version syntax is not enforced. |
| `description` | No | String, at most 500 characters. |
| `author` | No | String, at most 500 characters. |
| `main` | For commands | Relative path to a `.js` file. Optional for theme-only extensions. |
| `permissions` | No | Array containing only `editor`, `editor:active-note`, `settings`, `vault:read`, `vault:write`, `events`, or `ui`. Defaults to `[]`. |
| `contributes.commands` | No | At most 50 command declarations; defaults to `[]`. |
| `contributes.themes` | No | At most 20 relative `.json` paths; defaults to `[]`. |
| `contributes.settings` | No | At most 32 typed setting declarations; requires `settings`. Defaults to `[]`. |
| `contributes.panels` | No | At most 10 `{ id, title }` declarations for right-sidebar panels; requires `ui` and `main`. |
| `contributes.webviews` | No | At most 10 `{ id, title }` declarations for sandboxed HTML dialogs; requires `ui` and `main`. |
| `contributes.ribbonItems` | No | At most 10 `{ id, title, icon, command }` shortcuts; requires `ui` and a declared command. `icon` is an app icon name (for example `canvas`, `flow`, `file`, `graph`, `command`). Unknown names use the file icon. |

Each command needs a unique `id` using the extension-ID character rules and a
nonblank `title` of at most 80 characters. Its optional `key` is a shortcut string.
Declaring any commands requires a `main` script.

File paths must stay inside the extension folder. Absolute paths, escaping
relative paths, and symlinks resolving outside that folder are rejected.
Script files have a 1,048,576-byte default limit; contributed theme files have a
65,536-byte default limit. File content is checked when the enabled extension loads.
Users can adjust extension limits within fixed bounds under
**Settings > Advanced settings > Theme and extension limits**.

Invalid manifests or load failures are shown in extension settings. A script
must finish initialization within 10 seconds. Register commands during
initialization and await their registration before the entry script finishes.

## Permissions and isolation

| Permission | Grants |
| --- | --- |
| `editor` | Read the active note, document and selection; insert text, set selection, and run approved Tiptap commands. Reading the active note includes its entire content. |
| `editor:active-note` | Subscribe only to active-note path changes, without content or selection access. Does not imply `editor`. |
| `settings` | Read/write only this extension's declared, validated settings. No application or other extension settings access. |
| `vault:read` | List/read loaded `.md`, `.flow`, and `.canvas` documents and watch their changes in the open vault. |
| `vault:write` | Create, replace, rename, trash, and flush supported notes. Append and compare-and-swap also require `vault:read`. |
| `events` | Subscribe to application events (also requires each event's data permission); subscribe to custom events and emit events in this extension's namespace. |
| `ui` | Display declared ribbon shortcuts, sandboxed panels and webviews; exchange messages with surfaces. |
| None | Register declared commands, notify the user, use private extension storage, contribute JSON themes. |

Undeclared permission checks reject API calls. There is no direct Node.js,
Electron `window.api`, application DOM, profile storage, arbitrary filesystem,
or network access. The sandbox CSP blocks network requests and external resources.
Browser APIs available within the sandbox are not a supported way to access
application data.

Users review permissions, settings, and UI declarations when enabling an
extension. Changes require review and re-enabling on reload.

### Resource safeguards

- A worker keeps synchronous extension loops off the application UI thread.
- The supervisor terminates a worker that misses heartbeats for 5 seconds.
  Startup also has a 10-second deadline.
- More than 200 messages in any rolling second stops the extension. This includes API calls,
  notifications, and error messages.
- At most 32 bridge calls may be pending per extension; additional calls reject.
- At most 32 vault watches may be registered per extension; disposal removes them.
- At most 32 active-note listeners may be registered per extension; disposal removes them.
- Nested `Worker` and `SharedWorker` constructors are disabled.
- Disabling, reloading, or unloading an extension removes its supervisor and worker.

Runtime failures are shown in notifications; startup failures appear on the
extension card. A stopped extension's commands report that it must be reloaded
or disabled in **Settings > Extensions**.

These safeguards are not hard CPU or memory quotas. Enable only extensions you
trust; permitted writes can overwrite notes, and stopping a worker does not
reverse operations already in progress.

## JavaScript API reference

Bridge methods return promises. Local helpers such as `createDisposables`,
disposable-group `add`, and UI `onMessage` registration are synchronous.
Await bridge calls and let failures reach the command
handler, or catch specific errors and explain recovery to the user. Unhandled
command errors are surfaced as extension notifications.

### Commands and notifications

```js
await tagline.commands.register(id, handler); // Promise<true>
await tagline.notify(message);               // Promise<true>
```

- `id` must appear in this extension's `contributes.commands`.
- `handler` must be a function; it may be async. There are no command arguments
  or returned command results exposed by the host.
- Register a handler for every contributed command. The manifest alone does not
  implement it.
- Notifications accept strings up to 500 characters and are prefixed with the
  extension name.

### Editor

Requires `editor`:

```js
const note = await tagline.editor.getActiveNote();
// null, or:
// { path, content, selection, selectionRange: { from, to } | null,
//   editorKind: "tiptap" | "source" | null, mode, kind: "markdown" | "flow" | "canvas" }

await tagline.editor.insertText(markdown); // Promise<true>
```

`path` is vault-relative and retains the file extension. `content` is the
application's current text, including unsaved edits, not necessarily the last
bytes saved on disk. `mode` is the selected note mode: `visual`, `edit`, or `read`.
Source fallback can be active even when the selected mode is `visual`.
`editorKind` identifies the actual editor and `selectionRange` uses its native
positions, allowing a selection to be restored with `editor.setSelection`.

For Markdown notes, `selection` is plain selected text in the visual editor and
literal selected source in the source editor. Reading mode has no editor
selection. The active-note snapshot can describe a flow, but there is no
flow-specific selection API; do not interpret its selection as a grid range.

`insertText` requires an open Markdown note in an editing mode and a ready editor.
In visual mode it parses Markdown; in source mode it inserts literal text.
It replaces the current selection or inserts at the cursor and uses normal
application autosaving. It rejects in reading mode or on a `.flow` document.
Text is limited to 5,000,000 characters.

### Active-note changes

Requires the separate `editor:active-note` permission, not `editor`:

```js
const stop = await tagline.editor.onActiveNoteChanged(async ({ path }) => {
  // path is a vault-relative string, or null when there is no active note.
  await tagline.storage.set('last-active-path', path);
});
// Later:
await stop();
```

Only `{ path }` is delivered: no content, selection, keystrokes, or editor state.
Events are emitted when the active note path or open vault changes, including
switching to no active note. Subscription does not deliver an initial snapshot.
Closing the extension, disabling it, or reloading it unsubscribes automatically.
Use `editor.getActiveNote()` only when full note access is actually needed and
the broader `editor` permission has been declared and approved.

### Editor selection and Tiptap bridge

Requires `editor`. Extensions do not receive the live editor object, execute
arbitrary editor methods, or install ProseMirror plugins.

```js
await tagline.editor.setSelection({ from: 1, to: 12 });
const snapshot = await tagline.editor.tiptap.getSnapshot();
// { path, doc: TiptapJSON, text, selection: { from, to }, size }
await tagline.editor.tiptap.runCommand('toggleHeading', { level: 4 });
await tagline.editor.tiptap.runCommand('toggleBold');
```

Selections use **source character offsets starting at 0** in source mode and
**ProseMirror document positions** in visual mode (text usually starts at 1).
These coordinate systems are not interchangeable. Positions must be integers
with `from <= to`; positions outside the current document reject. Reading mode
and flows reject. Tiptap snapshots and commands require an active visual Markdown
editor; source fallback rejects. Snapshots include unsaved edits.

Approved commands: `toggleBold`, `toggleItalic`, `toggleUnderline`,
`toggleHighlight`, `toggleStrike`, `toggleHeading`, `setParagraph`,
`toggleBulletList`, `toggleOrderedList`, `toggleBlockquote`, `undo`, `redo`,
`unsetAllMarks`. Only `toggleHeading` takes options (`{ level: 1..6 }`).

### Application event bus

```js
const stop = await tagline.events.on('editor.selectionChanged', async (event) => {
  await tagline.storage.set('last-selection', event.selection);
});
await stop();

const stopCustom = await tagline.events.on('ext.debate-tools.finished', (payload) => {
  // Custom event payloads are untrusted data from the named extension.
});
await tagline.events.emit('ext.debate-tools.finished', { count: 3 });
await stopCustom();
```

All subscriptions require `events`; built-in events also require:

| Event | Additional permission | Payload |
| --- | --- | --- |
| `vault.changed` | `vault:read` | `{ open: boolean }`, emitted when the open vault changes. |
| `vault.fileChanged` | `vault:read` | Same path-only change/reset events as `vault.watch`. |
| `note.changed` | `editor:active-note` | `{ path: string \| null }`. |
| `editor.updated` | `editor` | `{ path: string \| null, mode }`, emitted on content/note/mode changes. |
| `editor.selectionChanged` | `editor` | `{ mode, selection: { from, to }, path? }`. |
| `editor.ready` | `editor` | `{ mode, path? }`. |

Subscriptions do not replay initial state. All listeners are removed on
disable/reload/worker failure. At most the configured listener limit (default
32) can be registered per extension. Custom names use
`ext.<extension-id>.<event-name>`; extensions may subscribe to other namespaces
but emit only their own. Names are at most 128 characters. Custom event and UI
message payloads must be JSON-serializable and at most 65,536 characters.
Payloads are copied for each listener, and application events cannot be spoofed.

### Sidebar panels and HTML webviews

Declare contributions before using them:

```json
{
  "permissions": ["ui"],
  "main": "main.js",
  "contributes": {
    "panels": [{ "id": "research-panel", "title": "Research" }],
    "webviews": [{ "id": "source-details", "title": "Source details" }]
  }
}
```

IDs follow command-ID syntax; titles must be nonblank and at most 80 characters.
Each surface is scoped to its owning extension. HTML is limited to 200,000
characters. Use the same methods on `tagline.panels` or `tagline.webviews`:

```js
const stopMessages = tagline.webviews.onMessage('source-details', async (message) => {
  if (message.ready) await tagline.webviews.postMessage('source-details', { title: 'Example source' });
});
await tagline.webviews.setHtml('source-details', `
  <h1 id="title"></h1>
  <script>
    taglineWebview.onMessage(message => {
      document.getElementById('title').textContent = message.title;
    });
    taglineWebview.postMessage({ ready: true });
  </script>
`);
await tagline.webviews.show('source-details');
// Later:
await tagline.webviews.close('source-details');
stopMessages();
```

Register message handlers before showing a surface. The page should send a ready
message after registering `taglineWebview.onMessage`, then the worker can reply.
Posting to an unmounted surface rejects. `setHtml` replaces the page and resets
its DOM; `show` displays it, and `close` hides/unmounts it while retaining its
HTML for reopening. Disabling/reloading removes all contributed surfaces.

Panels appear above the built-in right-sidebar content (show the right sidebar
if it is hidden); webviews appear as dialogs. HTML and inline scripts run in an
opaque-origin `sandbox="allow-scripts"` iframe without same-origin access,
Node, Electron APIs, network requests, forms, nested frames/workers, popups,
or arbitrary frame navigation. Styles must be inline; images may use data URLs.
HTML is not application-trusted markup: never inject unescaped note content into
it. Use `textContent` for data sent over messages.

Unlike worker entry scripts, webview scripts have DOM access and are not covered
by the worker heartbeat guard; expensive synchronous scripts can harm renderer
responsiveness. UI message rates are limited; exceeding the rate closes the
surface. Enable UI extensions only if you trust their code.

### Theme-aware UI kit

Panels/webviews receive the app's colors, fonts, selection colors, and shared
control stylesheet automatically. Updates follow the active theme and its
settings without reloading the surface. Prefer the built-in `taglineUI` factories
over hardcoded colors:

```js
const ui = taglineUI;
document.body.append(ui.card({
  title: 'Research',
  children: [
    ui.field({ label: 'Filename', description: 'Text match only', onChange: value => {} }),
    ui.select({ label: 'Side', value: 'aff', options: [
      { label: 'Affirmative', value: 'aff' }, { label: 'Negative', value: 'neg' }
    ] }),
    ui.toggle({ label: 'Include flows', checked: true, onChange: checked => {} }),
    ui.notice({ text: 'Ready', tone: 'info' }),
    ui.button({ label: 'Search', variant: 'primary', onClick: () => {} })
  ]
}));
```

Factories return native DOM elements with associated labels, keyboard behavior,
focus indicators, and reduced-motion support. `stack({ children })` provides
vertical layout; `card({ title, children })` adds a titled container.
`field` supports `type` (`text`, `number`, `search`, `email`, `url`, `password`,
`textarea`, `color`), `value`, `min`, `max`, `step`, `maxLength`, and `placeholder`.
Fields/selects/toggles accept `description`, `disabled`, and `onChange`;
changes return strings except toggles, which return booleans.
Buttons accept `disabled` and `variant` (`default` or `primary`).
Notice tones are `info`, `warning`, and `error`. Labels/text are inserted as text,
not HTML. The kit lives inside surfaces, not in worker scripts.

`taglineWebview.getTheme()` returns `{ id, mode, variables, metadata, reducedMotion }`;
`variables` maps full CSS property names such as `--selection` to current values.
`taglineWebview.onThemeChange(callback)` observes changes and returns an unsubscribe
function. Read initial state with `getTheme()`. See the [Theme API](./theme-api.md)
for tokens and accessibility metadata.

### Helpers and disposable subscriptions

Helpers do not require a permission:

```js
const path = await tagline.helpers.path.join('Research', 'Energy.md');
await tagline.helpers.path.normalize('Research/../Energy.md'); // "Energy.md"
await tagline.helpers.path.basename(path); // "Energy.md"
await tagline.helpers.path.dirname(path);  // "Research"
await tagline.helpers.path.extname(path);  // ".md"
const text = await tagline.helpers.markdownToText('**Evidence**'); // "Evidence"

const outline = await tagline.helpers.markdown.outline('# Case\n\n#### Card');
const html = await tagline.helpers.markdown.toHtml('**Safe**'); // sanitized HTML
const tags = await tagline.helpers.markdown.extractTags('Debate #aff');
const paths = await tagline.vault.list(); // Requires vault:read
const target = await tagline.helpers.markdown.resolveLink('Energy', paths);
const markdown = '#### Claim\n\n==Evidence==';
const card = await tagline.helpers.cards.getAt(markdown, 0);
const stats = await tagline.helpers.cards.stats(card.text);
const formattedDuration = await tagline.helpers.cards.formatDuration(75); // "1:15"
const timing = await tagline.helpers.speech.estimate(card.text, 250);
const citation = await tagline.helpers.citations.create({ author: 'Smith', year: '2024' });
const score = await tagline.helpers.search.fuzzyScore('deb', 'debate');
const filled = await tagline.helpers.templates.fill('Case: {{title}}', 'Energy');

const disposables = tagline.helpers.createDisposables();
disposables.add(await tagline.events.on('ext.debate-tools.finished', () => {}));
disposables.add(tagline.panels.onMessage('research-panel', () => {}));
await disposables.dispose();
```

Path helpers operate on vault-relative paths, normalize separators, and reject
absolute paths and `..` traversal above the vault root. They do not access files.
The Markdown helpers are `toText`, `slugify`, `outline`, `extractLinks`,
`extractTags`, and `resolveLink(target, paths)`. Link resolution only checks
the supplied list (at most 10,000 paths); listing vault paths requires
`vault:read`. The legacy
`helpers.markdownToText` method remains available. `toText` omits HTML and is a
plain-text approximation, not a round-trip serializer. `outline` reports
zero-based line numbers. Link and tag extraction skip fenced and inline code.

Card helpers provide `getAt(markdown, offset)`, `stats(markdown)`, and
`spokenEvidence(markdown)`, and `formatDuration(seconds)`. `getAt` returns the
heading section containing the character offset, or `null` if there is no
preceding heading. Speech helpers provide `analyze(text)` and
`estimate(text, wordsPerMinute = 250)`; estimates include the analysis fields
and `seconds`. `citations.create(details)` formats citation Markdown;
`search.fuzzyScore(query, text)` returns a relevance score; and
`templates.fill(template, title)` replaces `{{date}}`, `{{time}}`, and
`{{title}}`.

Text inputs are limited to 100,000 characters; estimates accept speaking rates
from 50 to 1,000 WPM. These helpers are pure and require no permission. Use the
vault API separately to read files; vault access still requires its declared
permissions.

`createDisposables` is synchronous; `add` returns the supplied function, and
`dispose` invokes all registered disposers, clears the group, and surfaces any
failure.

### Typed extension settings

Declare `settings` permission and `contributes.settings` in the manifest:

```json
{
  "permissions": ["settings"],
  "contributes": {
    "settings": [
      {"id":"enabled","title":"Enable reminders","type":"boolean","default":true},
      {"id":"limit","title":"Result limit","type":"number","min":1,"max":20,"default":5},
      {"id":"style","title":"Style","type":"string","enum":["brief","full"],"default":"brief"}
    ]
  }
}
```

This is a manifest fragment; include the usual required manifest fields.
Each setting needs a unique `id` (same syntax as command IDs), a nonblank `title`
up to 80 characters, `type`, and a valid `default`. An optional `description`
is limited to 500 characters.

- `boolean`: accepts only actual booleans.
- `number`: accepts only finite numbers, with optional inclusive `min`/`max`.
- `string`: accepts strings up to `maxLength` (default 1,000; configurable 1–10,000).
  An optional `enum` restricts values to 1–50 unique string choices.

Unsupported definition properties, invalid defaults, type mismatches, out-of-range
values, and undeclared IDs are rejected rather than coerced or silently replaced.
For example, the string `"5"` is not a number setting value.

```js
const limit = await tagline.settings.get('limit'); // saved value, or declared default
await tagline.settings.set('limit', 10);          // Promise<true>
```

Users can edit, save, and reset these settings on the extension card under
**Settings > Extensions**. Values live in extension-ID-scoped profile storage
separate from private `storage`, with a configurable size limit (100,000 serialized characters by default).
They are not encrypted and must not be used for secrets. Invalid stored values
surface errors; the user can reset the extension's settings to recover.

### Canvas and flow documents

`tagline.canvas.read(path)` and `tagline.flow.read(path)` return parsed documents
and require `vault:read`. Their `write(path, document)` counterparts validate and
serialize the document, require `vault:write`, and return the saved path. Paths
must end in `.canvas` or `.flow` respectively. Saves use the normal autosave and
revision-history pipeline; call `tagline.vault.flush()` to await disk persistence.
Active Canvas/flow documents report their `kind`, with no Markdown selection.

Pure helpers require no permissions:

- `helpers.canvas.parse(json)`, `serialize(document)`,
  `createNode(type, index = 0)`, `createArgumentEdge(from, to, relation)`,
  `groupMembers(document, groupId)`, `createId()`,
  `resolveLink(target, paths)`, `suggestFiles(paths, query, limit = 20)`,
  `moveNodes(document, ids, dx, dy)`.
- `helpers.flow.parse(json)`, `serialize(document)`, `create()`,
  `setCell(document, sheetIndex, rowIndex, columnIndex, text)`.

Relations are `supports`, `answers`, or `contradicts`. `flow.create()` creates
an empty on-case flow. Helpers return new values rather than mutating inputs.

Canvas `resolveLink` uses the application's resolver for HTTP(S), exact vault
paths, and `[[file#heading|label]]`. It returns `{type:'web', url}` or
`{type:'file', path, heading, label?}`, or `null` for an unresolved/unsupported
target. It only resolves supplied paths; it never opens links or reads files.
`suggestFiles` returns up to `limit` matching paths (1–1,000), preferring prefix
matches. Paths are limited to 10,000 entries of 1,000 characters each.
`createId` returns a fresh node/edge identifier.
`moveNodes` returns validated Canvas data with selected node IDs translated by
safe-integer `dx`/`dy`. It preserves unrelated nodes, edges, and custom fields;
it does not write to disk or implicitly move group members.

## Vault

```js
const paths = await tagline.vault.list();          // Promise<string[]>
const content = await tagline.vault.read(path);    // Promise<string>
const actualPath = await tagline.vault.write(path, content); // Promise<string>
await tagline.vault.append(path, text);            // Promise<string> (existing note)
await tagline.vault.delete(path);                  // Promise<true> (move to trash)
const renamed = await tagline.vault.rename(path, newPath); // Promise<string>
await tagline.vault.flush();                       // Promise<true> (disk writes completed)
const changed = await tagline.vault.compareAndSwap(path, expected, replacement); // Promise<boolean>
const stop = await tagline.vault.watch(event => {
  // { type: 'create' | 'change' | 'delete', path: string }, or { type: 'reset' }
});
await stop();                                     // unsubscribe
```

`list`, `read`, and `watch` require `vault:read`. All mutations and `flush`
require `vault:write`; `append` and `compareAndSwap` require both permissions.

- Paths are vault-relative, with `/` separators in the API, and include `.md` or
  `.flow`. Display settings such as hiding `.flow` do not change them.
- `list` returns the currently loaded supported note paths, not arbitrary files
  or folders. `read` returns the application's current loaded content and rejects
  if the path is absent. Reload the vault through the app after external edits.
- `write` only accepts `.md`, `.flow`, and `.canvas` paths. For an existing loaded note it
  replaces the entire content and schedules normal debounced autosaving.
  Resolution does **not** certify that the disk write has finished.
- A new note is created through the normal file-creation path. Folder-space
  normalization and collision handling can change the requested path; use the
  returned path.
- Paths are limited to 1,000 characters; written content to 5,000,000 characters.
- `append` adds literal text to an existing note, preserving current unsaved edits.
  It rejects for a missing note and schedules the usual autosave.
- `compareAndSwap` compares the entire current loaded text (including unsaved
  edits) with `expected`. It replaces the text and returns `true` only on an exact
  match; a mismatch returns `false` without changing anything. A missing note
  rejects. Comparison and replacement happen without yielding. Concurrent
  extension mutations are serialized across extensions.
- `flush` waits for queued autosaves and in-flight writes for the current vault.
  It rejects on save failure. It flushes all pending notes, including user edits,
  not just this extension's writes. It is not an OS-level `fsync` guarantee.
  Edits made after a flush starts may require another flush.
- `rename` accepts an existing supported note, not a folder. It uses the app's
  normal rename workflow, including folder-space normalization, configured wiki
  relinking, open-tab updates, and speech-document path updates. Existing
  destinations reject. The returned path is the actual normalized path.
- `delete` accepts an existing supported note and moves it to the OS trash,
  closing its tabs regardless of the missing-tab setting. Rename and delete
  first flush pending edits and reject if saving fails. There is no built-in
  confirmation dialog for extension calls: confirm destructive actions in the
  command's workflow before invoking them.
- `watch` takes a callback and resolves to an async unsubscribe function.
  Events describe loaded text changes from the editor, extensions, and vault
  reloads. Events may be coalesced within a render; renames appear as delete/create
  events, with change events for relinked notes. Switching vaults emits `reset`;
  the subscription then observes the newly active vault. Events do not contain
  content; use `read` for a current snapshot.
- Watch is not an OS filesystem watcher: external changes are reported only
  after the app reloads the vault. Unsubscribing or unloading the extension stops
  delivery; callback failures are shown as extension errors.
- Append results and replacement text are also limited to 5,000,000 characters.
  Use compare-and-swap rather than separate read/write calls when preserving
  concurrent edits matters. Its guarantee covers app state, not external writers.

For example, a command with both vault permissions can create a fresh index:

```js
await tagline.commands.register('create-index', async () => {
  const paths = await tagline.vault.list();
  const savedPath = await tagline.vault.write(
    'Extension Index.md',
    '# Vault index\n\n' + paths.map((path) => '- ' + path).join('\n') + '\n'
  );
  await tagline.notify('Wrote ' + savedPath);
});
```

Declare `create-index` in the manifest before using this example. If
`Extension Index.md` already exists, this command replaces its contents.

### Private storage

```js
const value = await tagline.storage.get('key');       // value or null
await tagline.storage.set('key', { enabled: true }); // Promise<true>
await tagline.storage.set('key', null);              // delete the key
```

No permission is required. Keys are strings up to 200 characters. Values should
be JSON-compatible. Setting `null` or `undefined` removes a key.

The total serialized object is limited to 100,000 characters (the UI error calls
this "100 KB"). Storage is scoped by extension ID in the application's local
profile and survives host reloads. It is not encrypted, a vault file, a secret
store, or synced data.

## Shortcuts and contributed themes

`Mod+Alt+K` is a portable primary-modifier shortcut. Valid modifiers include
`Mod`, `Ctrl`, `Meta`, `Alt`, and `Shift`. Use uppercase letter keys in manifests.
Users can change or clear extension shortcuts under
**Settings > Keyboard shortcuts > Extensions**.

Malformed, reserved, or already-used default shortcuts are dropped rather than
overriding a built-in or another extension command. The command remains available
in the palette without a shortcut. Users can assign a nonconflicting binding.
See [the shortcut definitions](../src/lib/keybindings.json) and
[binding validation](../src/lib/keybindings.js) for the exact accepted syntax.

Theme-only extensions need no JavaScript or permissions:

```json
{
  "manifestVersion": 1,
  "id": "ocean-themes",
  "name": "Ocean Themes",
  "version": "0.1.0",
  "contributes": {
    "themes": ["themes/ocean.json"]
  }
}
```

See the [Theme API](./theme-api.md) for the contents of `themes/ocean.json`.
Theme IDs are assigned as `ext:<extension-id>:<zero-based-file-index>`.
Keep the theme list order stable to preserve users' saved selections.

For working examples, see the [API demo extension](../demo/README.md).
