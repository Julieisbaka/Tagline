# Tagline API demo extension

[`tagline-api-demo`](./tagline-api-demo/) is a working extension that exercises
every part of the [Extension API](../docs/extension-api.md). Read its
[`main.js`](./tagline-api-demo/main.js) alongside the reference: each API area
has its own labelled section.

## Install

1. In Tagline, open **Settings > Extensions > Open extensions folder**.
2. Copy the whole `tagline-api-demo` folder into that extensions folder.
3. Select **Reload extensions**, review the permissions, and enable **API Demo**.
4. Run **API Demo: Open API dashboard** (`Mod+Alt+J`) from the command palette
   (`Mod+P`). Show the right sidebar if it is hidden.

Every demo is available both as a dashboard button and as an
**API Demo: …** palette command. Results appear in the dashboard and as
notifications.

## What each demo shows

| Demo / command | APIs | Permission |
| --- | --- | --- |
| Show greeting notification | `commands.register`, `notify`, `settings.get` | `settings` |
| Describe active note | `editor.getActiveNote`, `helpers.markdownToText` | `editor` |
| Insert demo text | `editor.insertText` (replaces any selection) | `editor` |
| Select first word | `editor.setSelection` with source offsets or ProseMirror positions | `editor` |
| Toggle bold / level-2 heading / undo, dashboard Tiptap picker | `editor.tiptap.getSnapshot`, `editor.tiptap.runCommand` (all approved commands) | `editor` |
| Toggle active-note tracking | `editor.onActiveNoteChanged` | `editor:active-note` |
| Toggle event log | `events.on` for every built-in event and a custom event; `helpers.createDisposables`; `settings.set` | `events` + `editor`, `editor:active-note`, `vault:read` |
| Emit custom event | `events.emit` (`ext.tagline-api-demo.ping`) | `events` |
| Run helper demos | `helpers.path.*`, `helpers.markdownToText`, `helpers.createDisposables` | None |
| Show and validate settings | `settings.get`, rejected `settings.set` | `settings` |
| Run storage demo | `storage.get`, `storage.set`, deleting with `null` | None |
| Write vault index note | `vault.list`, `vault.read`, `vault.write` | `vault:read`, `vault:write` |
| Run vault lifecycle demo | `vault.watch`, `write`, `append`, `read`, `compareAndSwap`, `flush`, `rename`, `delete` | `vault:read`, `vault:write` |
| Open API dashboard | `panels.setHtml`, `show`, `onMessage`, `postMessage` | `ui` |
| Open active note inspector | `webviews.setHtml`, `show`, `onMessage`, `postMessage`, `close` | `ui` |
| Close dashboard and inspector | `panels.close`, `webviews.close` | `ui` |
| Themes **Demo Dusk** and **Demo Dawn** | `contributes.themes` with colors and CSS variables | None |

The manifest also demonstrates a default shortcut and all three typed setting
kinds (boolean, number with bounds, and string with `maxLength` or `enum`).
Edit the settings on the extension card under **Settings > Extensions**.

## Vault changes

Vault demos only touch notes named `Tagline API Demo - …`:

- **Write vault index note** creates or replaces `Tagline API Demo - Index.md`.
- **Run vault lifecycle demo** creates `Tagline API Demo - Scratch.md`, renames it
  to `Tagline API Demo - Renamed.md`, and moves it to the OS trash unless the
  **Keep vault lifecycle note** setting is on. It refuses to run if either note
  already exists.

Try the demos in a scratch vault if you prefer not to modify your own.
