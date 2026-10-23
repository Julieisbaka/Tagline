# Features

[Documentation home](./README.md)

## Vaults and notes

Open a folder as a vault or create one from the welcome screen. Notes are
Markdown files; speech flows use `.flow` files. Settings and downloaded models
are stored in the app profile, not the vault.

Create, move, rename, and delete files in the sidebar. Open several documents
in tabs, use `Mod+O` to switch files, or `Mod+P` to find a command. Edits
autosave. Drag either sidebar edge to resize it.
Right-click a note and choose **Copy note path** to copy its vault-relative path.

Tagline keeps up to 20 recent vaults. Switch from the sidebar or welcome screen.
Removing a vault from the recent list only removes its saved path; it never
deletes the folder.

Revision history is available from a note header. It is stored in the vault at
`.tagline/history`; change its retention limit in **Settings > Files and folders**.

## Editing

Choose **Visual**, **Source**, or **Read** in a note header. Visual mode edits
formatted Markdown; Source mode edits literal Markdown; Read mode displays the
rendered note. Markdown stays the source of truth. Notes with unsupported
structures, such as frontmatter, raw HTML, footnotes, or math, open in Source
mode to avoid losing content.

Debate-card shortcuts are configurable in **Settings > Keyboard shortcuts**:
`F4`–`F7` apply card headings, `F8` citation/bold, `F9` underline, `F10`
emphasis, `F11` highlight, and `F12` clears formatting. Mac keyboards may need
Fn with function keys.

Customize the sidebar shortcut icons under **Settings > Appearance**. Drag
icons to reorder them, or uncheck a shortcut to remove it. Use the up/down
buttons for keyboard-accessible reordering; the Settings icon stays available.

Use `Mod+F` to find and replace text in the current note. Search supports
case-sensitive and whole-word matching; replacements can be undone.

Wiki links support `[[Note]]`, `[[Note#Heading]]`, and `[[Note|Label]]`.
Tagline also provides backlinks, mentions, an outline, tags, and a graph view.
Put reusable Markdown in `Templates/`; placeholders include `{{date}}`,
`{{time}}`, and `{{title}}`.

The graph view's **Argument map** mode links level-four debate cards as
supporting, answering, or contradicting one another. Select two cards and a
relationship type to add a link; click a card in the map to open its note.
Links are saved as labeled wiki links in the source card and follow note
renames.

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

The timer supports speech and affirmative/negative preparation clocks for
high-school (8-3-5) and college (9-3-6) formats.

Flows are multi-sheet speech grids. Use `Tab` and `Shift+Tab` to move between
cells; `Mod+Enter` adds a row below and `Mod+Shift+Enter` adds one above.

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

HTTP/HTTPS links open inside Tagline by default. Turn off **Open websites inside
Tagline** in **Settings > Integrations** to use your default browser instead.
Embedded sites cannot access the vault or app APIs; use the external browser
for downloads.

## Settings

Settings save automatically on this device. Main options include:

| Section | Options |
| --- | --- |
| General | Speech timing, editor mode, flow behavior, readable line width |
| Editors | Visual toolbar, line height, source editor options |
| Appearance | Language, themes, fonts, optional custom CSS |
| Files and folders | Wiki-link updates, workspace tabs, revision history |
| Integrations | Pandoc, local models, embedded websites |
| Keyboard shortcuts | Built-in and extension command bindings |
| Extensions | Install, reload, enable, and configure local extensions |

`Mod` means Ctrl on Windows/Linux and Cmd on macOS. Change shortcuts in
**Settings > Keyboard shortcuts**.

See the [Extension API](./extension-api.md) and [Theme API](./theme-api.md) to
customize Tagline.
