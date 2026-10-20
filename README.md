# Tagline

![Tagline icon](build/icon.png)

Version 0.0.1. An Obsidian-style desktop app for policy debaters, built with Electron + React,
Tiptap for visual editing, and CodeMirror for source editing.
Your vault is a plain folder of markdown (`.md`) and flow (`.flow`) files.

## Run

```
npm install
npm run dev     # Vite dev server + Electron with hot reload
npm start       # production build, then launch Electron
```

On first launch choose **Open folder as vault** or **Create sample vault**.

Tagline was previously called Debate Vault. On first launch it copies settings, the
saved Hugging Face token, and the downloaded model from the old `debate-vault`
user-data folder; the old folder is left untouched.

The app icon source is `build/icon.svg`. Run `npm run icons` after editing it to
regenerate `build/icon.png` and the multi-size Windows `build/icon.ico`.

## Features

- File explorer (drag to move, right-click menu), tabs, quick switcher (Ctrl+O), command palette (Ctrl+P)
- `[[Wikilinks]]` with autocomplete, Ctrl+click to follow, auto-create on click, link rewriting on rename
- Backlinks + unlinked mentions, outline, `#tags`, full-text search (Ctrl+Shift+F, supports `tag:neg "phrase"`)
- Graph view (Ctrl+G) with local graph and aff/neg coloring
- Verbatim-style card formatting: F4 pocket, F5 hat, F6 block, F7 tag, F8 cite, F9 underline `++x++`,
  F10 emphasis, F11 highlight `==x==`, F12 clear formatting
- Reading view (Ctrl+E) with **highlighted-only** mode (Ctrl+Shift+H) and read-time estimate at your WPM
- Speech doc builder: Ctrl+Shift+S or the note header's send button appends the card under the cursor
  (or the selection) to the speech doc; open the speech doc from the status bar or command palette
- Flows: multi-sheet `.flow` grids with aff/neg-colored speech columns; configurable focus after adding a row
- Speech timer + aff/neg prep timers (HS 8-3-5 or college 9-3-6)
- Templates: any markdown in a `Templates/` folder (`{{date}}`, `{{time}}`, `{{title}}` placeholders)
- JSON-based dark, light, high-contrast dark, and high-contrast light themes; custom color themes
- English, Spanish, and French UI (Settings > Language)
- Built-in standalone HTML export, plus optional Pandoc document import/export
- Context menus for files, tabs, flow cells/columns/sheets, and native text-editing commands

## Visual and source editing

Choose **Visual**, **Source**, or **Read** in the note header. Visual mode is the
default; change it in Settings. Ctrl+E toggles reading and your preferred editor.
The command palette also has explicit visual/source commands.

Tiptap is useful for writing and formatting cards without Markdown delimiters.
CodeMirror remains better for precise Markdown edits. Both support the debate
formatting hotkeys. Visual mode also has formatting buttons and an insert-link
field; Ctrl+click a wiki link to follow it. Selection/card sending and template
insertion work in both editors.

Markdown is still the source of truth. Merely opening visual mode does not save
or rewrite a note. Editing visually normalizes Markdown whitespace and mark
ordering, while preserving supported headings, tables, task lists, wiki links
(including aliases/headings), bold, underlining, and highlights. Notes containing
frontmatter, raw HTML, footnotes, images, or custom fenced blocks are shown in
source mode with a notice rather than silently discarding those structures.

Parsed Tiptap documents are cached by exact Markdown content, including across
mode switches and tab changes. The in-memory LRU cache is bounded to 16 entries
and 4 million combined source/JSON characters; changed source text is reparsed.
Unchanged parent updates do not rerender the memoized visual document, and toolbar
state subscribes only to formatting-state changes rather than every transaction.

## Flow shortcuts and context menus

Ctrl+Enter (Cmd+Enter on macOS) inserts an argument row below the current row and
focuses the new cell in the **same speech column**. Disable **Settings > Focus new
flow row after Ctrl+Enter** to keep focus in the old cell. Clicking the add-row
button does not steal focus.

Right-click cells to insert a row, clear a cell, or remove a row; column headers
to add/remove columns; sheet tabs to rename/delete sheets; workspace tabs to close
one/other tabs, rename a file, or reveal it. Menus support Escape, arrow keys,
Home/End, and are kept inside the window. Text editors and inputs also have native
undo/redo and clipboard menus. The single settings button remains in the ribbon.

## Built-in HTML and optional Pandoc export

Install Pandoc yourself and put it on PATH, or use **Settings > Locate Pandoc**.
The app also checks standard Windows installation directories. No Pandoc binary
is bundled or downloaded. Use **Export** on a note or **Export note**
in the command palette, then choose a format and destination.

HTML is the default and works **without Pandoc**. It creates a standalone UTF-8
document with a title, language, readable print-friendly styles, debate marks,
and a restrictive content-security policy. Scripts, remote resources, and images
are not included.

Other output choices are DOCX, ODT, RTF, EPUB, and PDF via Pandoc. PDF additionally
requires a compatible LaTeX engine on PATH. Missing executables, conversion
errors, and Pandoc warnings are displayed instead of reporting a false success.
Conversion runs without a command shell and replaces the selected output only
after Pandoc succeeds.

Export includes current unsaved edits and all evidence, even when highlighted-only
reading is enabled. The app sends sanitized HTML to Pandoc so debate marks are
represented as bold, underline, and highlight elements rather than literal
`++`/`==` delimiters. Output formatting depends on the writer. Wiki links become
labels, and images are omitted; this is a document export, not a vault archive.

## Pandoc import

Use the ribbon's **Import document with Pandoc** button or the command palette.
Choose a DOCX, ODT, RTF, HTML, or EPUB file, review the converted Markdown and any
warnings, choose a note name, and click **Add to vault**. An existing note is never
overwritten: duplicate names receive a numbered suffix. The original document
is unchanged. Canceling the preview creates no note.

Pandoc is required for importing. Conversion runs without a shell, uses an
explicit reader and sandbox, and has a 120-second timeout. Images and complex
formatting may be lost. Raw HTML is retained where the Markdown writer requires
it, with source-mode fallback rather than destructive visual conversion.

## Theme API and languages

All four built-in themes live in [src/themes](./src/themes) and use the same
versioned JSON format as custom themes. In Settings, export the current theme
as a starting point, edit its colors, then use **Import JSON theme**:

```json
{
  "version": 1,
  "name": "My navy theme",
  "mode": "dark",
  "colors": {
    "bg": "#101827",
    "accent": "#a9c7ff",
    "accent-text": "#101827"
  }
}
```

`mode` must be `dark` or `light`. Partial color overrides inherit the matching
base theme; every applied theme has a full set of tokens. Only supported color
tokens and `#RRGGBB` / `#RRGGBBAA` values are accepted. Unknown tokens, invalid colors,
and files above 64 KB are rejected visibly. Importing another custom theme
replaces the previous custom theme; the selection and colors persist locally.
Tokens are listed in [src/lib/themes.js](./src/lib/themes.js) and the built-ins:
backgrounds, text, border, accent/accent text, selection, highlights, headings,
aff/neg colors, warning, danger, shadow, and backdrop. No executable theme plugins
or arbitrary CSS are loaded. A TODO in the API tracks future custom-CSS support.

High-contrast themes have tests verifying at least 7:1 text contrast on major UI
surfaces, plus visible focus indicators. Custom themes are not automatically
contrast-certified.

Settings > Language switches English, Spanish, and French immediately. Translations
are keyed by English messages in [src/locales](./src/locales); interpolation and
catalog parity are tested. This changes application UI, not users' notes, file
names, debate speech abbreviations, or sample evidence. Native OS dialogs/menus
follow the operating system language. Pandoc/OS/model diagnostic messages remain
in their original language. The bundled English MiniLM model is unchanged;
translated UI does not make semantic search multilingual.

## Hugging Face embeddings and semantic search

In **Settings > Semantic search**, optionally enter and save a Hugging Face read
token, then click **Download model**. The button only appears until the model is
downloaded; afterwards Tagline loads the cached model automatically in the background
at startup (offline), so semantic search is ready without visiting Settings. If a
cached model fails to load, the button changes to **Load model**. Without a token, the app uses public,
keyless Hugging Face model downloads. The selected model is
`Xenova/all-MiniLM-L6-v2` (quantized, about 23 MB). Download failures, authorization
errors, and offline cache misses are reported. Model downloads require internet;
once cached, loading and inference can work offline.

Tokens are encrypted using Electron `safeStorage` (Windows OS encryption), never
saved in localStorage or the vault, and never returned through the settings API.
If OS encryption is unavailable, token storage is refused; keyless access is
still available. Remove a token in Settings to restore keyless downloading.
Tokens are only attached to requests to `https://huggingface.co`.

Use Ctrl+Shift+F, select **Semantic (local embeddings)**, enter a description,
and press Enter or **Search by meaning**. Full-text search remains available
without a model. Semantic mode supports `tag:` filters and ranks the best passage
per note; its cosine scores are similarity measurements, not confidence levels.
Clicking a passage opens source mode at its corresponding line.

Only model artifacts are downloaded from Hugging Face: **note contents and search
queries are not uploaded**. CPU inference runs in a worker thread. Models and
per-vault embedding indexes are cached under the application's user-data
`semantic-search` directory, outside the vault. Changed notes are re-embedded and
deleted notes removed on the next search. Embedding indexes are local but not
encrypted; treat them as private derived vault data.

## Validation

```
npm test              # focused unit tests, including a mocked Pandoc invocation
npm run test:electron # real Electron visual/source round trips and integration checks
npm run test:semantic # public model download + local ranking and cache invalidation
npm run test:features # flows, context menus, themes, locales, cache, HTML export and import IPC
npm run test:speech   # send-card buttons (source and visual) and opening the speech doc
npm run test:migration # Debate Vault -> Tagline profile migration, including the encrypted token
```

The semantic test downloads/caches the public model under
`~/.tagline-test-models`, or `TAGLINE_MODEL_CACHE` if set. Setting that variable
for the Electron test also exercises real CPU inference through IPC.

Real Pandoc conversions have not been tested in this environment because Pandoc
is not installed. Detection, argument construction, and conversion-failure
handling are tested; real-format export validation is deferred.
Pandoc import IPC, preview, save, and failure handling are tested with a stubbed
converter; real DOCX/ODT/RTF/EPUB conversion fidelity is likewise not certified.
