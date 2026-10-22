# Application features

[Documentation home](./README.md)

## Get started

Open an existing folder as a vault or create the sample vault. Notes are
ordinary Markdown files; flow documents are JSON stored with a `.flow`
extension. Settings and downloaded resources are kept separately in the app
profile.

Tagline remembers up to 20 recently opened vaults. Use the vault name at the
bottom of the sidebar, or **Recent vaults** on the welcome screen, to switch to a
saved vault without browsing for its folder. **Manage vaults** lets you reopen
available folders, reveal them in the file explorer, or remove their paths
from the recent list; removing a path never deletes vault files. Use **Add
existing or create vault** to browse for another vault or choose a new folder.

Use the file explorer to create, open, rename, move, and delete notes and
folders. Tabs keep several documents available. Right-click files or tabs for
context actions, and use the quick switcher (`Mod+O`) or command palette
(`Mod+P`) instead of browsing folders.

Drag the edge of the file explorer or right-hand panel to resize it. Widths are
saved and limited so the note column always keeps at least 320 pixels. Each edge
can also be focused with `Tab`: use the arrow keys to resize (hold `Shift` for
larger steps), `Home`/`End` to set the minimum or maximum, and `Enter` or a
double-click to reset. The status bar wraps onto extra lines in narrow windows
rather than hiding statistics.

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

Tagline keeps a local revision history for Markdown and flow documents.
Open **History** from a document header to preview and restore saved versions.
Restoring a version preserves the current document as another revision. History
is stored in the vault under `.tagline/history`, follows document and folder
renames, and is limited by **Settings > Files and folders > Revision history**.
The default is 50 revisions per document; older versions are pruned after the
next change.

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

Use `Mod+F` or **Find and replace** in the visual toolbar. Visual and Source modes
share the same panel and support case-sensitive and whole-word search,
previous/next matches, replace, and replace all. Enter advances; Shift+Enter
moves backward; Escape closes the panel and clears match decorations.
Replacements participate in editor undo and autosaving; searching alone does
not edit a note. Search is limited to the current note, not the whole vault.

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
Semantic mode supports tag filters and required quoted phrases and shows the best matching passage per note.
Opening a passage jumps to its line in Source mode.

**Hybrid (keywords + local meaning)** combines keyword matches and semantic
passage rankings using reciprocal-rank fusion. Select this mode and click
**Search keywords + meaning**, or press Enter. Notes found by both ranking methods
get an agreement boost; relevant paraphrases can appear even without all query
words.

Hybrid mode immediately shows keyword results while you type. Its status tells
you to run the combined search; until then these are not semantic results.
It shows whether each result matched keywords, meaning, or both. If local
inference fails, an explicit error identifies the keyword-only results.
Changing the query, filters, contents, or result limit invalidates old semantic
results.

## Citation creator

Choose **Create citation** from the note header, command palette, or File menu.
Enter an author and four-digit year; optionally add title, publication, URL,
and access date. Copy the generated Markdown or insert it into either editor.

Paste a public article URL or DOI and choose **Autofill from URL** to read JSON-LD,
citation metadata, and known-site URL rules. For DOI resolver links, Tagline
also checks the [Crossref public bibliographic metadata API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/);
it does not retrieve article full text.

## Speech documents, read time, and timers

Send the selected evidence or card under the cursor with `Mod+Shift+S`, the send
button, or the command palette. The app appends it to the configured speech
document. Open that document from the status bar or palette, start a new speech
document, or set the current note as the destination.

A card is a level-four heading plus its contents until the next heading of the
same or a higher level. Sending from a higher-level section can include the
whole section.

The status bar shows document counts and, while editing, statistics for the
current section. Without calibration, estimated duration uses:

- Highlighted evidence plus the author/year lead of bold citation lines.
- English syllable estimates rather than the number of words.
- Spoken expansion of numbers, years, percentages, and common initialisms.
- A small articulation surcharge for polysyllabic words and consonant clusters.
- Punctuation pauses scaled to the speaking rate.
- Your speaking-rate setting, converted at 1.5 syllables per word.

### Personal speech calibration

In **Settings > General > Personal speech calibration**, import one or more
documents and enter the number of seconds you actually took to read each one aloud.
Choose whether each sample covers the full document or only highlighted evidence
and spoken citations. Up to 100 samples are kept; only derived statistics and
timings are saved, not document text.

With valid samples, a robust weighted fit replaces the speaking-rate setting. It
estimates your seconds per syllable plus your articulation and pause costs.
Median/MAD down-weighting limits the influence of an unusually fast or slow
sample. The settings page reports the median in-sample timing error and each
sample's re-estimated time. Remove samples individually or reset calibration to
return to the default algorithm.

Readability is shown as Flesch reading ease, a standard English formula. The
**effort** score is relative to your samples (100 = your sample baseline).
Without samples, it uses the default density baseline. Neither is a
comprehension test.

The timer includes speech and separate affirmative/negative preparation clocks,
with high-school 8-3-5 and college 9-3-6 formats.

## Hypothesis testing (Political DEBATE)

The **Hypothesis** button on a note, and **Test a hypothesis** in the command
palette, open an on-demand natural-language-inference dialog. It uses
[mlburnham/Political_DEBATE_large_v1.0](https://huggingface.co/mlburnham/Political_DEBATE_large_v1.0),
a 0.4B-parameter DeBERTa-v3 model released under the MIT license. The model treats the text as a
*premise* and estimates the probability that each *hypothesis* follows from it
(entailment vs. not entailment).

1. Choose the text: selection, card under cursor, or whole note.
2. Choose a format: `The author of this text believes {}.` for stance,
   `This text is about {}.` for topic, or a full custom hypothesis.
3. Enter 1-10 hypotheses, one per line, in English. Then click **Analyze** or press
   `Mod+Enter`.

The first **Download and load** fetches an int8 ONNX build of about 650 MB,
cached outside the vault. **Unload model** frees memory.
Long text is split into sentence-aligned passages that fit the model's 512-token window, up to 48 passages.
Each hypothesis reports its strongest passage.

## Flows and operating-system integration

Flows are multi-sheet speech grids with affirmative/negative column colors.
Presets include on-case, off-case, and cross-examination notes. Add, rename,
and remove sheets; edit columns and rows using their context menus. The active
sheet uses a neutral selection treatment instead of a distracting accent
underline, and the grid flexes to keep row and column controls visible.

Flow editing is keyboard-friendly: `Tab` and `Shift+Tab` move through cells
horizontally and wrap between rows. `Mod+Enter` inserts a row below the current
cell; `Mod+Shift+Enter` inserts one above. Both shortcuts can be customized in
**Settings > Keyboard shortcuts**. New rows focus the corresponding speech
column when **Focus new flow rows** is enabled. Clicking the add-row button
does not take focus from the current cell.

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
The shared highlight filter also preserves `==highlight==` formatting in
Pandoc exports, including RTF.

**Pandoc import** accepts DOCX, ODT, RTF, HTML, and EPUB. Review the converted
Markdown and warnings before adding a note. Text highlights from Word, HTML
`<mark>` elements, and spans with a background color are converted to Tagline's
`==highlight==` Markdown. Canceling creates nothing; name collisions do not
overwrite existing notes. The source document is unchanged.
DOCX tracked changes are accepted, so the import reflects the final-document
view; the original revision history is not retained. Common Word whitespace
artifacts can be normalized without changing paragraph and heading structure
by checking **Clean up imported Markdown** in the import dialog. This
experimental cleanup is off by default.

## Embedded websites

HTTP/HTTPS links open in an embedded website view inside the note workspace by
default, leaving the sidebar, note tabs, right panel, and status bar accessible.
Close the website to return to the note, or select a note to leave the browser.
The browser is hidden while an application dialog is open. Turn off
**Settings > Integrations > Open websites inside Tagline** to use the system
browser instead. The view includes an address bar, back/forward, reload, close, **Archived copy**,
and **Open in browser** controls.

Sites render with JavaScript and use a separate persistent cookie/session store,
so normal website sign-in can work across restarts. Remote pages have no Node.js,
app preload, vault, or extension-bridge access. Device permissions and downloads
are blocked; use the external browser for downloads or unsupported login flows.
Non-HTTP(S) navigation and embedded credentials in URLs are rejected.

### On-demand document summaries

Choose **Summarize** in a Markdown note to open the summary dialog. On first use,
choose **Download and load summary model** to download
`Xenova/long-t5-tglobal-base-16384-book-summary`; then choose **Summarize now**.
Neither downloading nor inference starts automatically. The model runs locally,
and the generated summary appears in the dialog without changing the source file.
The downloaded model is cached in the app profile. Only Markdown notes are
supported; notes larger than 500,000 characters are rejected.

Access helpers:

- The view identifies itself as standard Chrome (the `Electron/…` and `tagline/…`
  user-agent tokens are removed), so sites that reject Electron clients load normally.
- Sign in with your own subscriptions; the persistent session keeps you signed in.
- **Archived copy** opens the page's Wayback Machine snapshot, which helps with
  dead links and pages that won't load directly.

## Settings reference

Changes save automatically on the current device.

| Section | Controls |
| --- | --- |
| General | Speaking rate, personal speech calibration samples, speech-document path, default editor, flow-row focus, readable line width. |
| Editors | Tiptap toolbar visibility and line height; CodeMirror line numbers, wrapping, active-line highlight, and autocomplete. |
| Appearance | English/Spanish/French UI, built-in/custom/extension themes, editor font family and size, installed or imported fonts, opt-in unrestricted custom CSS in a CodeMirror editor with CSS highlighting (`Mod+Enter` applies). |
| Performance and search | Visual parse-cache limits and maximum search results. |
| Files and folders | Folder-path spaces, `.md`/`.flow` label visibility, auto relinking, externally missing-tab cleanup, workspace persistence, revision-history retention, association guidance. |
| Integrations | Embedded websites, Pandoc location/status/install-page link, model download/load/autoload, optional Hugging Face token, Political DEBATE repository/local folder/unload, on-demand Long-T5 document summaries. |
| Keyboard shortcuts | Record, clear, or reset built-in and extension bindings; conflicts and reserved shortcuts are explained. |
| Extensions | Open the extension directory, reload, review permissions/errors, and enable/disable local extensions. |
| Advanced settings | Theme and extension limits; inspect or change internal flags, including visual-editor notice dismissal. |

Notable defaults and limits:

| Setting | Default | Range / behavior |
| --- | --- | --- |
| Speaking rate | 250 WPM | UI range 100-500; used to calibrate syllable-based timing. |
| Editor font size | 16 | UI range 10-32. |
| Visual editor line height | 1.65 | UI range 1-2.5. |
| Source line numbers | Disabled | Toggle in **Settings > Editors**. |
| Source line wrapping | Enabled | Toggle in **Settings > Editors**. |
| Source active-line highlight | Disabled | Toggle in **Settings > Editors**. |
| Source autocomplete | Enabled | Wiki-link suggestions; toggle in **Settings > Editors**. |
| Visual formatting toolbar | Enabled | Toggle in **Settings > Editors**; editor shortcuts remain available when hidden. |
| Default editor | Visual | Visual or Source. |
| Visual cache entries | 16 | 0-256; zero disables caching. |
| Visual cache characters | 4,000,000 | 0-100,000,000; combined source and serialized-document budget. |
| Maximum search results | 200 | 1-1,000, after ranking. |
| Revision history | 50 | 1-5,000 snapshots per document, stored inside the vault. |
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

### Theme and extension limits

**Settings > Advanced settings > Theme and extension limits** sets the bounds
used when importing themes, loading extensions, and running the extension
sandbox. Applying changes reloads extensions. Values outside these ranges are
rejected. Fixed safety ceilings and permission checks remain in place.

| Limit | Default | Range |
| --- | --- | --- |
| Theme file bytes | 65,536 | 1,024-1,048,576 |
| Theme CSS variable count | 256 | 1-2,048 |
| Theme CSS value characters | 2,048 | 32-16,384 |
| Extension script bytes | 1,048,576 | 1,024-8,388,608 |
| Commands / themes / settings per extension | 50 / 20 / 32 | 1-500 / 1-200 / 1-256 |
| Listeners per event type, pending calls | 32 each | 1-256 |
| Messages per second per extension | 200 | 10-2,000 |
| Storage characters per extension store | 100,000 | 1,000-1,000,000 |
| Startup / heartbeat timeout (ms) | 10,000 / 5,000 | 1,000-60,000 / 1,000-30,000 |

Imported fonts support `.ttf`, `.otf`, `.woff`, and `.woff2` files up to 20 MB.
They apply to note text, not application UI or code snippets.

Themes are described in the [Theme API](./theme-api.md); local commands and theme
packages are described in the [Extension API](./extension-api.md).
Default preferences live in [defaultSettings.json](../src/lib/defaultSettings.json).
The visual cache consumes the same defaults rather than maintaining a duplicate
copy. Model-autoload's saved value is kept in main-process configuration; the
shared JSON supplies its fallback.
