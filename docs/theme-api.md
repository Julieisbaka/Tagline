# Theme API

[Documentation home](./README.md) | [Extension API](./extension-api.md)

Themes are JSON color palettes with optional CSS variable overrides. The format is shared by imported themes
and extension contributions.

Use the [theme JSON schema](../schemas/theme.schema.json) for editor completion.
See [JSON formats and schemas](./json-formats.md) for offline associations and
the additional checks performed at runtime.

## Create, import, and export

1. In **Settings > Appearance**, select a theme close to your desired result.
2. Select **Customize current theme** to adjust its color tokens and CSS variable
   overrides in the in-app editor. CSS variables are edited as JSON with
   CodeMirror.
3. Select **Export current theme** to save its complete palette as JSON, or edit
   the exported file.
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
| `settings` | Optional declarative controls shown in Appearance while this theme is active. |
| `metadata` | Optional author, description, license, tags, and accessibility information. |
| `id` | Optional in an input file; not an author-controlled identity. Standalone imports normalize it to `"custom"`; extension loading assigns its own ID. |

Colors must be strings in `#RRGGBB` or `#RRGGBBAA` notation, case-insensitively.
In the eight-digit form, the final pair is alpha. Shorthand hex, named colors,
`rgb()`, `var()`, gradients, and arbitrary CSS values are rejected.

Unknown color tokens are rejected. An empty `colors` object is valid and yields
the base palette. Import errors are displayed rather than partially applying
the file.

The Appearance file picker and extension theme loading share the configurable
**Theme file bytes** limit (65,536 bytes by default, adjustable from 1,024 to
1,048,576 in **Settings > Advanced settings > Theme and extension limits**).
Keep shared themes at or below the default so they load for other users.

## Color tokens

All 29 tokens below resolve to CSS custom properties named `--<token>`.

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
| `selection-text` | Selected-text foreground, including extension surfaces. |
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

## Built-in themes

| ID | Theme |
| --- | --- |
| `dark` | Dark |
| `light` | Light |
| `high-contrast-dark` | High contrast dark |
| `high-contrast-light` | High contrast light |

The [built-in palettes](../src/themes/) are complete examples.

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

The app also defines `font-text`, `font-ui`, `font-mono`, and
`editor-font-size`. Unknown variable names are accepted, but only affect the
app when a stylesheet uses them.

By default, up to 256 overrides are allowed, each with a name up to 100
characters and a value up to 2,048 characters. Names must start with a lowercase
letter and contain only lowercase letters, digits, or hyphens. Values cannot
contain semicolons, braces, null bytes, `url(...)`, or `@import`. Limits are
configurable under **Settings > Advanced settings > Theme and extension limits**.

Variable overrides take precedence over `colors` and, for `font-text` and
`editor-font-size`, over the corresponding Appearance preferences. The preferences
are retained and resume when switching to a theme without those overrides.
Switching themes clears previous variable overrides rather than leaking them
into the next theme.

## Optional settings and metadata

Theme-only extensions need no script or permissions for these fields:

```json
{
  "version": 1,
  "name": "Readable",
  "mode": "dark",
  "colors": { "selection": "#334466", "selection-text": "#ffffff" },
  "variables": { "editor-font-size": "20px" },
  "settings": [
    {
      "id": "selection-color", "title": "Selection background",
      "type": "string", "default": "#334466", "variable": "selection"
    },
    {
      "id": "reading-size", "title": "Reading size",
      "type": "number", "default": 20, "min": 12, "max": 30,
      "variable": "editor-font-size", "unit": "px"
    }
  ],
  "metadata": {
    "author": "Example", "description": "A reading theme", "license": "MIT",
    "tags": ["reading"],
    "accessibility": {
      "contrast": "high", "colorVision": ["deuteranopia"],
      "reducedMotion": true, "notes": "Describe any testing and limitations."
    }
  }
}
```

Settings use the [extension setting schema](./extension-api.md#typed-extension-settings)
with `string` or `number` types, plus a unique `variable` target: a color token or
a property declared in `variables`. Color settings require hex strings; string
settings can use `enum`. Numeric `unit` may be `px`, `em`, `rem`, `%`, or empty.
IDs and targets must be unique. The extension-setting count limit also applies.
Apply/reset values in Appearance; values persist separately per theme ID.
Export and Customize capture the current resolved values without live controls.

Metadata text fields allow 500 characters each; `tags` allows 20 nonempty
strings of up to 40 characters. Accessibility fields are optional:
`contrast` is `standard` or `high`; `colorVision` lists `protanopia`,
`deuteranopia`, `tritanopia`, or `achromatopsia`; `reducedMotion` is boolean;
`notes` allows 1,000 characters.
