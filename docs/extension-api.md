# Extension API

[Documentation home](./README.md) | [Theme API](./theme-api.md)

Extensions contribute commands and JSON themes. JavaScript runs in a dedicated
worker supervised by a hidden, opaque-origin iframe, not the Electron main
process or the application page. DOM APIs such as `window` and `document` are
unavailable; use the bridge rather than browser-page globals.
The supported bridge is the `tagline` object supplied to the entry script.

## Install and reload

1. Open **Settings > Extensions > Open extensions folder**.
2. Create a subfolder containing `manifest.json` and its referenced files.
3. Select **Reload extensions**.
4. Review the listed permissions, then enable the extension.
5. Find its commands in the command palette (`Mod+P`), and its themes in
   **Settings > Appearance > Theme**.

The installation directory is `<Electron userData>/extensions`. Use the button
instead of hard-coding an OS-specific profile path. Extensions are local to the
application profile, not installed inside individual vaults.

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
| `permissions` | No | Array containing only `editor`, `vault:read`, or `vault:write`. Defaults to `[]`. |
| `contributes.commands` | No | At most 50 command declarations; defaults to `[]`. |
| `contributes.themes` | No | At most 20 relative `.json` paths; defaults to `[]`. |

Each command needs a unique `id` using the extension-ID character rules and a
nonblank `title` of at most 80 characters. Its optional `key` is a shortcut string.
Declaring any commands requires a `main` script.

File paths must stay inside the extension folder. Absolute paths, escaping
relative paths, and symlinks resolving outside that folder are rejected.
Script files have a 1,048,576-byte limit; contributed theme files have a
65,536-byte limit. File content is checked when the enabled extension loads.

Invalid manifests or load failures are shown in extension settings. A script
must finish initialization within 10 seconds. Register commands during
initialization and await their registration before the entry script finishes.

## Permissions and isolation

| Permission | Grants |
| --- | --- |
| `editor` | Read the active note and its selection; insert text into its editor. Reading the active note includes its entire content. |
| `vault:read` | List/read loaded `.md`/`.flow` notes and watch their changes in the open vault. |
| `vault:write` | Create, replace, rename, trash, and flush supported notes. Append and compare-and-swap also require `vault:read`. |
| None | Register declared commands, notify the user, use private extension storage, contribute JSON themes. |

Undeclared permission checks reject API calls. There is no direct Node.js,
Electron `window.api`, application DOM, profile storage, arbitrary filesystem,
or network access. The sandbox CSP blocks network requests and external resources.
Browser APIs available within the sandbox are not a supported way to access
application data.

### Resource safeguards

- A worker keeps synchronous extension loops off the application UI thread.
- The supervisor terminates a worker that misses heartbeats for 5 seconds.
  Startup also has a 10-second deadline.
- More than 200 messages per second stops the extension. This includes API calls,
  notifications, and error messages.
- At most 32 bridge calls may be pending per extension; additional calls reject.
- At most 32 vault watches may be registered per extension; disposal removes them.
- Nested `Worker` and `SharedWorker` constructors are disabled.
- Disabling, reloading, or unloading an extension removes its supervisor and worker.

Runtime failures are shown in notifications; startup failures appear on the
extension card. A stopped extension's commands report that it must be reloaded
or disabled in **Settings > Extensions**.

These are basic responsiveness and abuse guards, not hard CPU or memory quotas.
A continuously busy but yielding worker can still consume CPU, large allocations
can exhaust memory, and timers can be delayed when the OS suspends the app.
Enable only extensions you trust. A permitted write can overwrite evidence.
Stopping a worker does not roll back bridge operations already in progress.
Compare-and-swap protects a single loaded note against stale app content; there
are no multi-file transactions or locks against external filesystem writers.

## JavaScript API reference

All methods return promises. Await calls and let failures reach the command
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
// { path: string, content: string, selection: string, mode: string }

await tagline.editor.insertText(markdown); // Promise<true>
```

`path` is vault-relative and retains the file extension. `content` is the
application's current text, including unsaved edits, not necessarily the last
bytes saved on disk. `mode` is the selected note mode: `visual`, `edit`, or `read`.
Source fallback can be active even when the selected mode is `visual`.

For Markdown notes, `selection` is plain selected text in the visual editor and
literal selected source in the source editor. Reading mode has no editor
selection. The active-note snapshot can describe a flow, but there is no
flow-specific selection API; do not interpret its selection as a grid range.

`insertText` requires an open Markdown note in an editing mode and a ready editor.
In visual mode it parses Markdown; in source mode it inserts literal text.
It replaces the current selection or inserts at the cursor and uses normal
application autosaving. It rejects in reading mode or on a `.flow` document.
Text is limited to 5,000,000 characters.

### Vault

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
- `write` only accepts `.md` and `.flow` paths. For an existing loaded note it
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

## Current boundaries and implementation

There is no extension marketplace, automatic updater, panel/webview contribution,
settings contribution API, lifecycle event subscription, editor selection setter,
custom Tiptap node API, or unrestricted CSS/theme script execution. These are
not implied by the presence of internal application helpers.

Implementation references:

- [Manifest validation and file loading](../electron/extensions.cjs)
- [Sandbox bootstrap](../public/extension-sandbox.html)
- [Permission checks and host lifecycle](../src/lib/extensions.js)
- [Application bridge](../src/App.jsx)
- [End-to-end extension examples](../tests/extensions-smoke.cjs)
