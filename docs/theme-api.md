# Theme API

[Documentation home](./README.md) | [Extension API](./extension-api.md)

Themes are declarative JSON color palettes with optional CSS variable overrides. They are not executable plugins or
CSS stylesheets. The same format is used for standalone imports and extension
theme contributions.

## Create, import, and export

1. In **Settings > Appearance**, select a theme close to your desired result.
2. Select **Export current theme** to save its complete palette as JSON.
3. Edit supported color values or add CSS variable overrides.
4. Select **Import JSON theme**, then choose the edited file.

Import selects the custom theme immediately and persists it on this device.
There is one standalone custom-theme slot: importing another replaces that
slot. Use an extension to distribute multiple selectable themes.

A minimal theme:

```json
{
  "version": 1,
  "name": "Ocean",
  "mode": "dark",
  "colors": {
    "bg": "#101827",
    "accent": "#9ac7ff",
    "accent-text": "#101827",
    "accent-dim": "#9ac7ff33",
    "selection": "#9ac7ff55"
  }
}
```

Unspecified tokens inherit from the normal dark or light base, according to
`mode`. They do not inherit from the currently selected theme or a high-contrast
theme. Include all desired overrides when deriving from a high-contrast palette.

## JSON contract

| Field | Contract |
| --- | --- |
| `version` | Required; number `1`. |
| `name` | Required; nonblank string, at most 80 characters before trimming. |
| `mode` | Required; `"dark"` or `"light"`. Also controls the browser's native color scheme. |
| `colors` | Required object; zero or more of the tokens listed below. |
| `variables` | Optional object of CSS custom-property overrides; see below. |
| `id` | Optional in an input file; not an author-controlled identity. Standalone imports normalize it to `"custom"`; extension loading assigns its own ID. |

Colors must be strings in `#RRGGBB` or `#RRGGBBAA` notation, case-insensitively.
In the eight-digit form, the final pair is alpha. Shorthand hex, named colors,
`rgb()`, `var()`, gradients, and arbitrary CSS values are rejected.

Unknown color tokens are rejected. An empty `colors` object is valid and yields
the base palette. Import errors are displayed rather than partially applying
the file.

The Appearance file picker accepts files up to 64,000 bytes. Extension theme
loading allows up to 65,536 bytes per file. Keep shared themes at or below
64,000 bytes to work through both routes.

## Color tokens

All 28 tokens below resolve to CSS custom properties named `--<token>`.
Colors apply across application components; exact layout and selectors are not
a public styling API.

| Token | Intended use |
| --- | --- |
| `bg` | Main workspace background. |
| `bg-secondary` | Sidebar and secondary surfaces. |
| `bg-elevated` | Raised surfaces and controls. |
| `bg-hover` | Hovered rows and controls. |
| `border` | Separators, outlines, and control borders. |
| `text` | Normal foreground text. |
| `text-strong` | Emphasized foreground text. |
| `text-muted` | Secondary text and descriptions. |
| `text-faint` | Lower-emphasis metadata and hints. |
| `accent` | Links, active controls, and focus indicators. |
| `accent-text` | Text on accent-colored controls. |
| `accent-dim` | Translucent accent surfaces and selected states. |
| `selection` | Editor/text selection background. |
| `highlight-bg` | Debate-highlight and search-match background. |
| `highlight-text` | Text on highlighted content. |
| `code` | Code foreground. |
| `h1` | Pocket / level-one heading color. |
| `h2` | Hat / level-two heading color. |
| `h3` | Block / level-three heading color. |
| `h4` | Tag / level-four heading color. |
| `aff` | Affirmative-side foreground and graph/flow accents. |
| `neg` | Negative-side foreground and graph/flow accents. |
| `aff-bg` | Affirmative-side tinted backgrounds. |
| `neg-bg` | Negative-side tinted backgrounds. |
| `danger` | Destructive actions and error accents. |
| `warning` | Warnings and cautions. |
| `shadow` | Shadows, often with alpha. |
| `backdrop` | Modal-overlay tint, often with alpha. |

Changing a foreground should prompt a review of its paired background.
For example, review `accent` with `accent-text`, and `highlight-bg` with
`highlight-text`. Transparent colors must be evaluated after compositing
against their actual background.

## Built-in themes and accessibility

| ID | Theme |
| --- | --- |
| `dark` | Dark |
| `light` | Light |
| `high-contrast-dark` | High contrast dark |
| `high-contrast-light` | High contrast light |

The [built-in palettes](../src/themes/) are complete examples.
The [theme tests](../tests/features.test.cjs) check token consistency and at least
7:1 text contrast on tested high-contrast surfaces. Imported themes are validated
for structure and color syntax, **not** automatically certified for contrast.

Check normal and muted text, focus outlines, selected controls, citation text,
highlights, find matches, and aff/neg distinction in both flows and graphs.
Do not rely on color alone to communicate meaning.

## Package themes in an extension

Use the theme-only manifest in the [Extension API](./extension-api.md), with:

```text
ocean-themes/
  manifest.json
  themes/
    ocean.json
```

The theme file is the same JSON format as the minimal example above. After the
extension is enabled, it appears in **Appearance > Theme** with its extension
name. Runtime IDs look like `ext:ocean-themes:0`; changing the contribution order
changes those identities.

When a saved extension theme is unavailable or still loading, the app keeps the
saved selection but temporarily renders the dark palette. A disabled or removed
theme appears as **Unavailable extension theme** in the selector.

## Internal helpers, not sandbox APIs

For contributors to Tagline itself, [themes.js](../src/lib/themes.js) exports:

| Export | Behavior |
| --- | --- |
| `BUILTIN_THEMES` | The four complete built-in theme objects. |
| `COLOR_TOKENS` | Frozen list of supported color-token names. |
| `validateTheme(value)` | Validates input and CSS variables, merges the mode's base colors, and returns a normalized theme with ID `custom`; throws for invalid input. |
| `getTheme(id, customTheme)` | Resolves a built-in, custom, or registered extension theme; unknown non-extension IDs throw. |
| `applyTheme(theme)` | Clears previous variable overrides, sets root colors and variables, `data-theme`, and `color-scheme`; dispatches `themechange`. Expects an already complete, validated palette. |
| `registerExtensionThemes(themes)` | Replaces the renderer's contributed-theme list and dispatches `extensionthemes`. |
| `extensionThemes()` | Returns the current contributed-theme list. |

These module exports and window events are internal renderer integration points.
Sandboxed extensions cannot import them or access the application document;
contribute JSON files through a manifest instead.

## CSS variable overrides

The optional `variables` object can set any CSS custom property, including all
existing application variables and new properties used by your custom CSS.
Names omit the leading `--`. Values are CSS value strings, not declarations.

```json
{
  "version": 1,
  "name": "Large serif",
  "mode": "dark",
  "colors": {},
  "variables": {
    "font-text": "Georgia, serif",
    "font-ui": "system-ui, sans-serif",
    "font-mono": "Menlo, Consolas, monospace",
    "editor-font-size": "19px",
    "accent": "var(--h1)",
    "my-spacing": "calc(8px + 0.2vw)"
  }
}
```

Alongside all 28 color variables above, the application currently defines
`font-text` (note text), `font-ui` (controls), `font-mono` (code), and
`editor-font-size`. Unknown variable names are accepted for future variables
and custom styles. Adding a variable alone does not create a new layout feature;
some stylesheet must consume it.

At most 256 overrides are allowed. Names start with a lowercase letter followed
by lowercase letters, digits, or hyphens (at most 100 characters). Each value must
be nonblank text up to 2,048 characters, without semicolons, braces, null bytes,
`url(...)`, or `@import`. Values are not automatically checked for suitability
for each consuming CSS property. Use the separate unrestricted CSS option for
external resources or full stylesheets.

Variable overrides take precedence over `colors` and, for `font-text` and
`editor-font-size`, over the corresponding Appearance preferences. The preferences
are retained and resume when switching to a theme without those overrides.
Switching themes clears previous variable overrides rather than leaking them
into the next theme. Overrides survive import/export, restart, and extension
theme contributions. Themes cannot change keybindings or application behavior.

## Unrestricted custom CSS

In **Settings > Appearance > Custom CSS**, type CSS or choose **Import CSS file**.
The editor is a draft: choose **Apply CSS** to save it. Enable **Enable custom
CSS** and accept the warning to inject the saved stylesheet into the application.
Disabling the switch immediately removes the stylesheet without erasing the
saved source. **Discard CSS edits** restores the saved draft; **Reset custom
CSS** clears the source and disables it.

CSS is deliberately not selector-scoped or sanitized. It can target the entire
application, use `!important`, media queries, animations, and `@import`, and load
external resources where the browser permits. This can affect privacy, hide
important controls, or make the application unusable. Only enable trusted CSS.
It does not grant JavaScript or Node.js execution.

For example:

```css
.visual-document,
.preview {
  line-height: 1.8;
}

@media (min-width: 1200px) {
  .sidebar {
    min-width: 260px;
  }
}
```

The stylesheet is added after the bundled styles. Some app properties are
inline, so overriding those may require `!important`. Class names and component
structure are internal implementation details and can change. Relative resource
URLs resolve against the application document, not the imported CSS file's
original folder.

CSS is saved in the local application settings, not exported with palette JSON,
shared through the vault, or applied inside extension sandbox documents.
Do not assume that document exports inherit arbitrary application CSS.

### Recovery from broken CSS

The native menu is outside the page stylesheet. Open **View > Toggle Developer
Tools** and run this in the application's main-frame console:

```js
const preferences = JSON.parse(localStorage.getItem('tagline-settings') || '{}');
preferences.customCssEnabled = false;
localStorage.setItem('tagline-settings', JSON.stringify(preferences));
location.reload();
```

This preserves the CSS source for repair but prevents it from applying after
reload. If necessary, set `preferences.customCss = ''` before saving to discard
it entirely.
