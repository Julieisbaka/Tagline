# Features

[Documentation home](./README.md)

## Vaults and notes

Open a folder as a vault or create one from the welcome screen. Notes are
Markdown files; speech flows use `.flow` files, and visual canvases use
`.canvas` files in the [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/)
format. Settings and downloaded models are stored in the app profile, not the
vault.

On first launch, a short, skippable tour explains vaults, document types, and
workspace customization. It does not create files or require an account.
Completion is remembered in the app profile. Replay it from **Settings >
Advanced settings > Internal flags > Show onboarding again**.

Create, move, rename, and delete files in the sidebar. Open several documents
in tabs, use `Mod+O` to switch files, or `Mod+P` to find a command. Edits
autosave using a temporary file so failed writes leave the original intact.
Simultaneous file or folder creation uses distinct names. Drag either sidebar
edge to resize it.
Right-click a note and choose **Copy note path** to copy its vault-relative path.
Create canvases from the sidebar or command palette. Add and arrange text, file,
link, and group nodes; connect nodes with labeled or colored arrows. Switch to
**JSON source** to inspect or edit the Canvas file directly. Existing JSON
Canvas fields that Tagline does not edit are preserved.
File nodes suggest vault filenames as you type. Groups sit behind their cards;
moving a group moves every fully enclosed node. Adding a group while a card is
selected wraps that card.
File nodes render the linked Markdown, flow grid, or canvas preview; their open
button opens the full document. Link nodes provide shortcuts to HTTP(S) websites
or vault files, including `Folder/Note.md#Heading` and `[[Round.flow|Round]]`.
Resizing nodes updates their dimensions and connections throughout the drag.
Panning reuses existing cards and previews; dragging updates at most once per
animation frame. Linked-file changes still refresh their previews.
Developers can run `npm run test:canvas-performance` for the 301-node/300-edge
interaction benchmark, including preview reuse, immediate release, cancellation,
and live file/language updates.
Right-click the board to add nodes at the pointer, or a node/connection for
context actions. Keyboard users can focus one and press `Shift+F10`.

Tagline keeps up to 20 recent vaults. Switch from the sidebar or welcome screen.
Removing a vault from the recent list only removes its saved path; it never
deletes the folder.

Revision history is available from a note header. It is stored in the vault at
`.tagline/history`; change its retention limit in **Settings > Files and folders**.
Canvas history has two modes there: **Complete** saves exact JSON and layout;
**Data** saves content changes without movement-only revisions and restores
using the latest shared positions and sizes. Deleted cards retain their last
layout for restoration. Invalid JSON edits use complete revisions.
Flow and Canvas history use the same syntax-highlighted, read-only JSON viewer
as their source editors. If a flow or canvas has invalid JSON or structure,
**Restore most recent working save** appears when a valid saved version exists.
Recovery skips broken revisions, saves the current source in history, and
persists the restored document. It is available in both visual and JSON source
views. Confirmations use themed in-app dialogs rather than browser alerts.

## Editing

On first launch, Tagline uses the first supported language from the operating
system's preferred languages (English, Spanish, or French), falling back to
English. The onboarding tour uses this language too. A saved language choice
always takes precedence; change it under **Settings > Appearance**.

Choose **Visual**, **Source**, or **Read** in a note header. Visual mode edits
formatted Markdown; Source mode edits literal Markdown; Read mode displays the
rendered note. Markdown stays the source of truth. YAML frontmatter is supported:
start a note with a `---`-delimited YAML mapping. Visual edits preserve the exact
metadata block, and Read mode, previews, outlines, card counts, and speech timing
use only the Markdown body. Expand **Properties** to inspect metadata or open it
in Source to edit. Invalid YAML shows an error and stays in Source rather than
being rewritten. Other unsupported structures, such as raw HTML, footnotes, or
math, also open in Source mode to avoid losing content.

Note editors do not show a focus outline by default. Enable **Settings >
Accessibility > Show note editor focus outline** if desired. Focus indicators
for buttons, inputs, and other keyboard controls remain available.

Debate-card shortcuts are configurable in **Settings > Keyboard shortcuts**:
`F4`–`F7` apply card headings, `F8` citation/bold, `F9` underline, `F10`
emphasis, `F11` highlight, and `F12` clears formatting. Mac keyboards may need
Fn with function keys.

Customize the sidebar shortcut icons under **Settings > Appearance**. Drag
icons to reorder them, or uncheck a shortcut to remove it. Use the up/down
buttons for keyboard-accessible reordering; the Settings icon stays available.
Right-click a shortcut to move or remove it. Extension shortcuts work the same
way and can be restored in Appearance settings.

Right-click file-explorer toolbar actions or bottom status items to hide, restore,
or move them left and right. Drag items to reorder them. Layouts are saved across
restarts, and **Restore default items** is available even when every item is hidden.

Use `Mod+F` to find and replace text in the current note. Search supports
case-sensitive and whole-word matching; replacements can be undone.
Both editors share a formatting toolbar, link insertion, and line-height
setting. Use arrow keys within the toolbar. Tab stays inside open dialogs
and find panels; Escape closes them and returns focus.

In **Settings > Appearance**, reorder sidebar shortcuts or disable the
theme-change fade. Reduced-motion preferences always disable the fade.
Themes can expose their own controls here and show author-provided accessibility
information. The file-refresh icon spins in complete turns until reload finishes;
reduced-motion preferences disable the spin.

Wiki links support `[[Note]]`, `[[Note#Heading]]`, and `[[Note|Label]]`.
The link picker uses themed suggestions; use arrow keys and Enter to choose a
note, then **Insert link** to confirm. Choosing a note preserves heading/label suffixes.
Tagline also provides backlinks, mentions, an outline, tags, and a graph view.
Graph nodes follow the pointer while dragged and smoothly resume the force
simulation after release. Refreshing preserves the current layout. Scrolling
zooms around the pointer; further scrolling at either zoom limit leaves the
camera unchanged.
Put reusable Markdown in `Templates/`; placeholders include `{{date}}`,
`{{time}}`, and `{{title}}`.

Use any `.canvas` file to connect nodes as supporting, answering, or contradicting
arguments; no separate mode is needed. Choose a relation, select
**Connect nodes**, then click the source and target. These are standard JSON
Canvas edges, stored in that canvas file.

Canvas additions appear in the current viewport. Drag the background or scroll
to pan; use the zoom buttons or Ctrl/Cmd+scroll to zoom around the pointer.
**Fit canvas** shows all nodes. Moving or resizing nodes does not recenter the view.

## Search and citations

Open vault search with `Mod+Shift+F`. Full-text search works immediately and
supports quoted phrases and filters such as `tag:neg`. For semantic or hybrid
search, download the local embedding model in **Settings > Integrations**.

Use **Create citation** from a note, the command palette, or the File menu.
Enter the source details or paste a public URL/DOI and choose **Autofill from
URL**. Copy the Markdown or insert it into the current note.

## Speech tools

Send selected or highlighted evidence to the configured speech document with
`Mod+Shift+S`. Tagline estimates speaking time from highlighted evidence and
citations. **Personal speech calibration** in **Settings > General** can tune
estimates using your own timed samples.

Speech documents carry their designation in YAML frontmatter:

```yaml
---
speech: true
---
```

Right-click a Markdown file and choose **Set as speech doc** to add this property
without discarding other metadata and select it as the destination. New speech
documents include it automatically. **Settings > General > Active speech
document** lists marked files, including documents copied from another vault.
Several files can be marked; only the selected destination receives cards.
The selected path is a local preference; if it is unavailable, the first marked
file in path order is used. Existing configured speech documents retain their
contents and receive the marker when next opened or sent to. Renames preserve
the designation and update the selected path.

The timer supports speech and affirmative/negative preparation clocks for
high-school (8-3-5) and college (9-3-6) formats.

Flows are multi-sheet speech grids. Use `Tab` and `Shift+Tab` to move between
cells; `Mod+Enter` adds a row below and `Mod+Shift+Enter` adds one above.
Choose **JSON source** in the flow header to edit the saved structure directly.
Deleting a sheet or column asks for confirmation in Tagline.

**Settings > Advanced settings > Internal flags** includes **Has seen onboarding**
(`hasSeenOnboarding`, initially false). Completing, skipping, or dismissing the
tour sets it to true. **Show onboarding again** resets it and closes Settings.

## Local analysis and summaries

**Test a hypothesis** compares selected text, a card, or a note with one or more
hypotheses. Download the Political DEBATE model from **Settings > Integrations**
before first use.

**Summarize** opens an on-demand summary dialog for a Markdown note. Download
the summary model from **Settings > Integrations** before using it. Both models
run locally after download; neither changes the source note.

## Import, export, and websites

Standalone HTML export is built in. Other formats use the separately installed
[Pandoc](https://pandoc.org/); PDF export also needs a LaTeX engine. Import
converts DOCX, ODT, RTF, HTML, and EPUB to Markdown for review before saving.

Send a note to your Drive with **Export > Google Docs**, or upload DOCX/HTML
from **Settings > Integrations > Google Docs / Drive**. Use **Set up Google
Docs transfer** there to deploy the bundled webhook in your own Google account.
Each transfer creates a new Google Doc and requires confirmation. See
[Google Docs setup and response codes](./google-docs.md).
Save separate verified webhook connections for multiple Google accounts, then
choose the destination for each transfer. Account mismatches block uploads;
document links include the destination account rather than assuming the
browser's default Google login.

HTTP/HTTPS links open inside Tagline by default. Turn off **Open websites inside
Tagline** in **Settings > Integrations** to use your default browser instead.
Embedded sites cannot access the vault or app APIs; use the external browser
for downloads.

## OpenCaselist

Open **Settings > Integrations > Open OpenCaselist**, or use its command-palette
entry. Sign in on the official site in a separate window; choose its
remember-me option to retain the session. Cookies stay in an isolated app
session, never in notes, settings, or extension storage. When the cookie expires
or the API rejects it, sign in again. Tagline does not save your password or
silently renew sessions.

Browse caselists, schools, teams, rounds, and citations, or search a selected
caselist. Download disclosed files into the current vault; existing files are
never overwritten. DOCX/PDF files are not editable notes: use **Show downloaded
file** to find them.

Add, edit, or delete rounds; add/delete citations; or publish a DOCX disclosure
as a new round (up to 50 MB). Each server change requires native confirmation.
Only a file explicitly selected for upload is sent. Editing round details
preserves its attachment. Archived caselists are read-only, and publishing
requires the account permissions/trusted status enforced by OpenCaselist.
There are no background syncs or automatic write retries: after a connection
failure, refresh before retrying to avoid duplicate publications.

The integration follows the [OpenCaselist API](https://api.opencaselist.com/v1/docs).
The local write-protection form groups password fields in a responsive card.
Its password is separate from your OpenCaselist login; leave the new password
blank to keep the current one when saving protection settings.
`npm run test:opencaselist` exercises a mocked API without live credentials or
disclosure changes.

## Settings

Settings save automatically on your device. Main options include:

| Section | Options |
| --- | --- |
| General | Speech timing, editor mode, flow behavior, readable line width |
| Accessibility | Optional note-editor focus outline |
| Editors | Visual toolbar, line height, source editor options |
| Appearance | Language, themes, fonts, optional custom CSS |
| Files and folders | Wiki-link updates, workspace tabs, revision history |
| Integrations | Pandoc, local models, embedded websites |
| Keyboard shortcuts | Built-in and extension command bindings |
| Extensions | Install, reload, enable, and configure local extensions |
| Installation | App/runtime versions, architecture, executable and profile location, manual version checker, GitHub repository/releases links, uninstall options |

`Mod` means Ctrl on Windows/Linux and Cmd on macOS. Change shortcuts in
**Settings > Keyboard shortcuts**.

See the [Extension API](./extension-api.md) and [Theme API](./theme-api.md) to
customize Tagline.
