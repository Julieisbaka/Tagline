# Application features

[Documentation home](./README.md)

This guide describes implemented features. For ideas that are not implemented,
see [Feature suggestions](./feature-suggestions.md).

## Get started

Open an existing folder as a vault or create the sample vault. Notes are
ordinary Markdown files; flow documents are JSON stored with a `.flow`
extension. Settings and downloaded resources are kept separately in the app
profile.

Use the file explorer to create, open, rename, move, and delete notes and
folders. Tabs keep several documents available. Right-click files or tabs for
context actions, and use the quick switcher (`Mod+O`) or command palette
(`Mod+P`) instead of browsing folders.

Edits autosave. Use the reload-vault command to pick up external changes.
In **Settings > Files and folders**, automatic wiki-link rewriting on rename,
closing externally missing-file tabs, and workspace-tab persistence are
independent options. They are enabled by default.

With workspace persistence disabled, current tabs remain open, but switching
vaults or restarting does not restore them. Previously saved workspaces remain
untouched; enabling persistence again restores the saved workspace for that
vault rather than saving the temporary tabs over it.
If that vault has no saved workspace yet, enabling persistence keeps its current
tabs and starts saving them.

With missing-tab cleanup disabled, externally removed notes keep their tabs and
show a missing-file notice with reload/close actions. Restoring the file and
reloading makes it editable again. Deleting a note inside Tagline always closes
its tabs, regardless of this preference.

This is not a cloud-sync or revision-history system; keep backups of important
evidence and avoid conflicting edits from multiple applications.

## Editing and debate cards

Choose **Visual**, **Source**, or **Read** in the note header:

- **Visual:** Tiptap editing with formatting buttons, wiki-link insertion,
  headings, tables, task lists, and debate marks.
- **Source:** CodeMirror editing of literal Markdown, with wiki-link completion
  and formatting shortcuts.
- **Read:** Rendered evidence, including a highlighted-only display option.

Markdown remains the source of truth. Opening Visual does not rewrite a note;
visual edits normalize Markdown formatting. Notes containing YAML frontmatter,
raw HTML, footnotes, Markdown images, math, or custom fenced blocks fall back to
source editing rather than silently dropping unsupported structures.

The visual-formatting notice has a close button. Dismissal persists on this
device; reset **Visual editor notice dismissed** in **Settings > Advanced
settings > Internal flags** to show it again. Preservation warnings for unsupported
Markdown remain visible.

### Default card-formatting shortcuts

| Key | Action / syntax |
| --- | --- |
| F4 | Pocket, `#` heading |
| F5 | Hat, `##` heading |
| F6 | Block, `###` heading |
| F7 | Tag, `####` heading |
| F8 | Citation / bold, `**text**` |
| F9 | Underline, `++text++` |
| F10 | Emphasis, bold plus underline |
| F11 | Highlight, `==text==` |
| F12 | Clear formatting |

Bindings are configurable. Mac keyboards may need Fn for function keys.

### Find and replace

Use `Mod+F` or **Find and replace** in the visual toolbar.
The visual panel supports case-sensitive and whole-word search, previous/next
matches, replace, and replace all. Enter advances; Shift+Enter moves backward;
Escape closes the panel and clears match decorations. Replacements participate
in editor undo and autosaving; searching alone does not edit a note.

The same configurable shortcut opens the source editor's own search panel.
This searches the current note, not the whole vault.

### Embedded HTML

Write HTML such as `<details><summary>`, `<sup>`, `<sub>`, `<ruby>`, or tables in
Source mode. Read mode renders sanitized HTML, and document export uses sanitized
rendering. HTML-containing notes deliberately avoid visual round trips.
Scripts, event handlers, forms, embedded frames/objects, CSS blocks, and inline
styles are not supported.

## Links and organization

- `[[Note]]`, `[[Note#Heading]]`, and `[[Note|Label]]` support navigation.
- Wiki-link autocomplete is available while editing. Mod-click follows links;
  missing targets can be created on navigation.
- Renaming or moving a note/folder through the app rewrites supported wiki links
  when **Automatically update wiki links when renaming** is enabled. Disabling
  it leaves link text unchanged; open-tab paths still follow the rename.
- Backlinks, unlinked mentions, an outline, and tags help navigate evidence.
- The graph view shows note relationships, with local-graph and aff/neg coloring.
- Markdown in a `Templates/` folder can be inserted or used for new notes.
  Placeholders include `{{date}}`, `{{time}}`, and `{{title}}`.

## Vault search

Open search with `Mod+Shift+F`.

**Full-text search** works without a downloaded model. It supports quoted phrases
and filters such as `tag:neg "political capital"`. Ranking uses term saturation,
document-length normalization, title/heading and phrase boosts, and accent
folding. Exact words receive more weight than substring-only matches; repeated
query terms or repeated headings do not multiply their boosts.

**Semantic search** runs locally with the quantized
`Xenova/all-MiniLM-L6-v2` model. Download it in
**Settings > Integrations**. An optional Hugging Face token can be saved for model
access; the public model also works without a token. Once downloaded, cached
loading and inference can work offline.

Select **Semantic (local embeddings)** and describe the evidence you want.
Semantic mode supports tag filters and shows the best matching passage per note.
Opening a passage jumps to its line in Source mode. Displayed cosine similarity
is not a probability or confidence score.

The maximum-results setting applies after ranking in both search modes.
The proposed domain-specific Nomic fine-tuning workflow is not the application's
current search model.

## Citation creator

Choose **Create citation** from the note header, command palette, or File menu.
Enter an author and four-digit year; optionally add title, publication, URL,
and access date. Copy the generated Markdown or insert it into either editor.

Paste a public article URL and choose **Autofill from URL** to read JSON-LD,
metadata, and known-site URL rules. Autofill preserves fields you already
entered. Known-site fallbacks may recover a publisher, title, or year even when
the page cannot be fetched. Review every result; author identity and publication
dates cannot always be recovered reliably.

The fetcher does not execute the page, has time/size/redirect limits, and rejects
local/private-network targets. This action contacts the supplied public website;
it is separate from local-only semantic inference.

## Speech documents, read time, and timers

Send the selected evidence or card under the cursor with `Mod+Shift+S`, the send
button, or the command palette. The app appends it to the configured speech
document. Open that document from the status bar or palette, start a new speech
document, or set the current note as the destination.

A card is a level-four heading plus its contents until the next heading of the
same or a higher level. Sending from a higher-level section can include the
whole section.

The status bar shows document counts and, while editing, statistics for the
current section. Estimated duration uses:

- Highlighted evidence plus the author/year lead of bold citation lines.
- English syllable estimates rather than the number of words.
- Spoken expansion of numbers, years, percentages, and common initialisms.
- A small articulation surcharge for polysyllabic words and consonant clusters.
- Your speaking-rate setting, converted at 1.5 syllables per word.

Full citation details and unhighlighted evidence do not determine duration.
Word counts remain visible as separate statistics. Estimates are approximate
and optimized for English, not calibrated recordings of your speaking voice.

The timer includes speech and separate affirmative/negative preparation clocks,
with high-school 8-3-5 and college 9-3-6 formats.

## Flows and operating-system integration

Flows are multi-sheet speech grids with affirmative/negative column colors.
Presets include on-case, off-case, and cross-examination notes. Add, rename,
and remove sheets; edit columns and rows using their context menus.

`Mod+Enter` inserts a row below the current cell, optionally focusing the same
speech column in the new row. Disabling **Focus new flow rows** preserves focus.
Clicking the add-row button does not take focus from the current cell.

Packaged applications register support for `.flow` files. Setting Tagline as the
default may require **Open with** approval; on macOS use
**Get Info > Open with > Change All**. Running the development app alone does
not install associations.

Opening an associated file starts Tagline or forwards it to the existing
instance. Files inside the current vault keep that vault; other files cause the
app to save pending edits and open the containing folder as the vault.

On macOS, native window controls, application menus, Dock reactivation, and
Cmd-based shortcuts are supported. Closing the last window does not quit the
app. Pandoc discovery supports Intel and Apple Silicon Homebrew, and the startup
PATH includes Homebrew and MacTeX locations for Finder/Dock launches.

## Import and export

**Standalone HTML export** is built in and does not require Pandoc. It includes
current unsaved evidence and print-friendly styling. Export includes all
evidence even if highlighted-only reading is active. Scripts, images, and
external resource-loading elements are omitted; wiki links become labels.

**Pandoc export** adds DOCX, ODT, RTF, EPUB, and PDF. PDF also needs a compatible
LaTeX engine. Install these tools separately and locate Pandoc in
**Settings > Integrations** if necessary.
When Pandoc is missing, **Install Pandoc** opens its official installation page
in the default browser. This does not install software automatically; after
installation use **Check again** or **Locate Pandoc**.

**Pandoc import** accepts DOCX, ODT, RTF, HTML, and EPUB. Review the converted
Markdown and warnings before adding a note. Canceling creates nothing; name
collisions do not overwrite existing notes. The source document is unchanged.

Complex formatting may not survive conversion. Pandoc format support does not
guarantee that every embedded HTML element retains its original behavior.

## Embedded websites

HTTP/HTTPS links open in an embedded website view by default. Turn off
**Settings > Integrations > Open websites inside Tagline** to use the system
browser instead. The view includes an address bar, back/forward, reload, close,
and **Open in browser** controls.

Sites render with JavaScript and use a separate persistent cookie/session store,
so normal website sign-in can work across restarts. Remote pages have no Node.js,
app preload, vault, or extension-bridge access. Device permissions and downloads
are blocked; use the external browser for downloads or unsupported login flows.
Non-HTTP(S) navigation and embedded credentials in URLs are rejected.

The browser does not bypass paywalls, CAPTCHAs, or anti-bot protections, spoof
clients, or grant access to subscription content. Some websites reject embedded
browsers; use **Open in browser** when needed. Browsing does not change the
citation creator's URL-extraction rules.

## Settings reference

Changes save automatically on the current device.

| Section | Controls |
| --- | --- |
| General | Speaking-rate calibration, speech-document path, default editor, flow-row focus, readable line width. |
| Appearance | English/Spanish/French UI, built-in/custom/extension themes, editor font size, installed or imported fonts, opt-in unrestricted custom CSS. |
| Performance and search | Visual parse-cache limits and maximum search results. |
| Files and folders | Folder-path spaces, `.md`/`.flow` label visibility, auto relinking, externally missing-tab cleanup, workspace persistence, association guidance. |
| Integrations | Embedded websites, Pandoc location/status/install-page link, model download/load/autoload, optional Hugging Face token. |
| Keyboard shortcuts | Record, clear, or reset built-in and extension bindings; conflicts and reserved shortcuts are explained. |
| Extensions | Open the extension directory, reload, review permissions/errors, and enable/disable local extensions. |
| Advanced settings | Inspect or change internal flags, including visual-editor notice dismissal. |

Notable defaults and limits:

| Setting | Default | Range / behavior |
| --- | --- | --- |
| Speaking rate | 250 WPM | UI range 100-500; used to calibrate syllable-based timing. |
| Editor font size | 16 | UI range 10-32. |
| Default editor | Visual | Visual or Source. |
| Visual cache entries | 16 | 0-256; zero disables caching. |
| Visual cache characters | 4,000,000 | 0-100,000,000; combined source and serialized-document budget. |
| Maximum search results | 200 | 1-1,000, after ranking. |
| Underscore folder spaces | Enabled | Newly created/renamed folder components; existing paths are not migrated. Explorer labels show spaces while enabled. |
| Hide `.flow` extension | Enabled | Presentation only; actual filenames and extension API paths retain the suffix. |
| Show `.md` extension | Disabled | Applies to file labels in the explorer, tabs, switcher, search, backlinks, and graph; does not change paths or the editable note title. |
| Auto relinking | Enabled | Rewrites supported wiki links during in-app note/folder renames and moves. |
| Close missing-file tabs | Enabled | Applies after vault reload detects external deletion; in-app deletion always closes tabs. |
| Persist workspace tabs | Enabled | Saves/restores tabs per vault; disabled workspaces remain dormant. |
| Custom CSS | Disabled, empty | Enable explicitly in Appearance; Apply saves drafts, disabling removes styles, Reset clears them. |
| Model autoload | Enabled | Disabling defers loading; it does not unload a running model. |
| Embedded websites | Enabled | Disable to open HTTP/HTTPS links in the default browser. |
| Visual editor notice dismissed | False | Internal flag; closing the notice sets it to true. Reset in Advanced settings. |

Imported fonts support `.ttf`, `.otf`, `.woff`, and `.woff2` files up to 20 MB.
They apply to note text, not application UI or code snippets. Import only trusted,
appropriately licensed fonts.

Themes are described in the [Theme API](./theme-api.md); local commands and theme
packages are described in the [Extension API](./extension-api.md).
Default preferences live in [defaultSettings.json](../src/lib/defaultSettings.json).
The visual cache consumes the same defaults rather than maintaining a duplicate
copy. Model-autoload's saved value is kept in main-process configuration; the
shared JSON supplies its fallback.

## Privacy and current limitations

- Semantic queries and note content are processed locally, not uploaded for
  embedding inference. Initial model downloads require network access.
- Citation autofill contacts the supplied article website. Following external
  links also leaves the app.
- Hugging Face tokens use Electron OS-backed encryption; storage is refused when
  encryption is unavailable. Tokens are not stored in the vault or returned to
  the settings page.
- Extension access is permission-gated; enabling vault writes still entrusts an
  extension with your evidence. Private extension storage is not encrypted.
- Opt-in custom CSS is unrestricted and may load external resources or hide
  controls. See [CSS safety and recovery](./theme-api.md#unrestricted-custom-css).
- There is no built-in cloud collaboration, vault version history, or automatic
  backup/recovery workflow.
- UI language does not translate evidence or make the English embedding model
  multilingual. Some native/custom menu and diagnostic messages remain English.
