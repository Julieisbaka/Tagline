# Features

[Documentation home](./README.md)

## Vaults and notes

Open a folder as a vault or create one from the welcome screen. Notes are
Markdown files; speech flows use `.flow` files, and visual canvases use
`.canvas` files in the [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/)
format. Settings and downloaded models are stored in the app profile, not the
vault.

Replay the onboarding tour from **Settings > Advanced settings > Internal flags > Show onboarding again**.

Revision history is available from a note header. It is stored in the vault at
`.tagline/history`; change its retention limit in **Settings > Files and folders**.
Canvas history has two modes there: **Complete** saves exact JSON and layout;
**Data** saves content changes without movement-only revisions and restores
using the latest shared positions and sizes.
If a flow or canvas has invalid JSON or structure, **Restore most recent working save** appears when a valid saved version exists. Recovery skips broken revisions, saves the current source in history, and persists the restored document. It is available in both visual and JSON source
views. Confirmations use themed in-app dialogs rather than browser alerts.

## Editing

Choose **Visual**, **Source**, or **Read** in a note header. Visual mode edits
formatted Markdown; Source mode edits literal Markdown; Read mode displays the
rendered note. YAML frontmatter is supported:
start a note with a `---`-delimited YAML mapping. Expand **Properties** to inspect metadata or open it in Source to edit.

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
Put reusable Markdown in `Templates/`; placeholders include `{{date}}`,
`{{time}}`, `{{title}}`, `{{path}}`, `{{content}}`, and `{{properties}}`.
`{{path}}` is the target note's vault-relative filename (including `.md`).
`{{content}}` is its Markdown body without frontmatter; `{{properties}}` is its
raw YAML without `---` delimiters, preserving comments and formatting.
When creating a new note, content and properties are empty. When inserting into
an existing note, they come from that note before insertion. Placeholder values
are inserted literally without recursively expanding placeholders inside them.

Use any `.canvas` file to connect nodes as supporting, answering, or contradicting
arguments; no separate mode is needed. Choose a relation, select
**Connect nodes**, then click the source and target. These are standard JSON
Canvas edges, stored in that canvas file.

## Tabroom tournaments

Open **Settings > Integrations > Open Tabroom**, or run **Tabroom: view and
save tournament data** from the command palette. Enter a tournament ID or an
`https://www.tabroom.com` tournament URL containing `tourn_id`.

Tagline reads Tabroom's `/api/download_data.mhtml?tourn_id=...` JSON endpoint.
Public data does not require login. **Sign in on Tabroom** opens the official
website in a sandboxed window with a separate persistent browser session;
close the window after signing in. Tagline never asks for your password or
exposes session cookies to the renderer or extensions. A saved browser session
does not prove that you are signed in or have access to a tournament.
Tabroom decides which additional data your account may receive.

The read-only viewer opens with a tournament overview and collection counts.
Judges, teams, schools, and events have filterable tables with 50 records per
page, including records nested inside categories and schools. Missing data is
marked **Not provided**, not treated as empty. Unsupported fields produce a
warning without blocking raw inspection or backup export. **Raw JSON** retains
the paged data view. **Save tournament JSON** exports the exact backup through the
system save dialog, without another network request. Responses are limited to
32 MiB. Backups can contain personal or restricted data; store and share them
carefully. **Clear Tabroom session** removes this integration's stored browser
session and loaded data, without affecting other integrations.

In Teams, **Load supported seasons** reads OpenCaselist's available caselists
using your existing OpenCaselist login. Select a season and circuit explicitly,
then use **Find on OpenCaselist** for a team. No cross-service lookup happens
automatically when a tournament loads. Shared chapter and complete student IDs
can verify a match; name/code-only candidates and ambiguous results are labeled
as requiring identity verification. Links use real returned slugs, not guessed
URLs. When stronger matching fails, a lower-confidence fallback generates codes
from the first two letters of each surname (first and last name for LD).
It checks partner orders and numbered duplicates against the school's real
team list. These links explicitly say **Lower confidence**.

Team names link to Tabroom tournament entry records; competitor names link to
lifetime records when student IDs are available. These open in your default
browser and may require a separate Tabroom login. Missing IDs are not guessed.
Entries with a trimmed team code of `TBA` (case-insensitive) are excluded from
structured team counts, tables, and matching, but remain in raw JSON and exports.

## Search and citations

Open vault search with `Mod+Shift+F`. For semantic or hybrid
search, download the local embedding model in **Settings > Integrations**.

Use **Create citation** from a note, the command palette, or the File menu.
Enter the source details or paste a public URL/DOI and choose **Autofill from URL**. Copy the Markdown or insert it into the current note.

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
documents include it automatically. **Settings > General > Active speech document** lists marked files, including documents copied from another vault.
Several files can be marked; only the selected destination receives cards.
The selected path is a local preference; if it is unavailable, the first marked
file in path order is used. Existing configured speech documents retain their
contents and receive the marker when next opened or sent to. Renames preserve
the designation and update the selected path.

The timer supports speech and affirmative/negative preparation clocks for
high-school (8-3-5) and college (9-3-6) formats.
Both presets are policy debate; their saved `format` identifiers are `highschool`
and `college`.

Flows are multi-sheet speech grids. Use `Tab` and `Shift+Tab` to move between
cells; `Mod+Enter` adds a row below and `Mod+Shift+Enter` adds one above.
Choose **JSON source** in the flow header to edit the saved structure directly.

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
from **Settings > Integrations > Google Docs / Drive**. Use **Connect Google
account** for direct browser-based sign-in, or **Set up Google Docs transfer**
to deploy the bundled Apps Script webhook. Both methods can coexist; existing
script connections keep working. Choose the destination account and connection
method before sending. Credentials are encrypted locally; direct uploads go
straight to Google's Drive API with per-file access, not full Drive access.
Each transfer creates a new Google Doc and requires confirmation. See
[Google Docs setup and response codes](./google-docs.md).

HTTP/HTTPS links open inside Tagline by default. Turn off **Open websites inside Tagline** in **Settings > Integrations** to use your default browser instead.
Embedded sites cannot access the vault or app APIs; use the external browser
for downloads.

## OpenCaselist

Open **Settings > Integrations > Open OpenCaselist**, or use its command-palette
entry. Sign in on the official site in a separate window; choose its
remember-me option to retain the session.

Browse caselists, schools, teams, rounds, and citations, or search a selected
caselist. Download disclosed files into the current vault; existing files are
never overwritten. DOCX/PDF files are not editable notes: use **Show downloaded
file** to find them.

Add, edit, or delete rounds; add/delete citations; or publish a DOCX disclosure
as a new round (up to 50 MB).

The integration follows the [OpenCaselist API](https://api.opencaselist.com/v1/docs).

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
| Extensions | Install, reload, enable, and configure extensions |
| Installation | App/runtime versions, architecture, executable and profile location, manual version checker, GitHub repository/releases links, uninstall options |

Use **Search settings** to find labels and help text across all settings
sections in the current language. Select a result (or press Enter for the first)
to open its section and jump to the matching control. Escape clears the search;
the clear button returns focus to the search field. Search does not change
preferences or inspect entered field values.

`Mod` means Ctrl on Windows/Linux and Cmd on macOS. Change shortcuts in
**Settings > Keyboard shortcuts**.

See the [Extension API](./extension-api.md) and [Theme API](./theme-api.md) to
customize Tagline.
