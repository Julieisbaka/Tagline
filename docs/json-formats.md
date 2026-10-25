# JSON formats and schemas

[Documentation home](./README.md)

Tagline ships draft-07 JSON Schemas for its user-authored and exchanged formats:

| Format | Schema |
| --- | --- |
| Speech flow (`.flow`) | [flow.schema.json](../schemas/flow.schema.json) |
| JSON Canvas (`.canvas`) | [canvas.schema.json](../schemas/canvas.schema.json) |
| Extension `manifest.json` | [extension-manifest.schema.json](../schemas/extension-manifest.schema.json) |
| Imported, exported, or extension theme | [theme.schema.json](../schemas/theme.schema.json) |
| Exported extension settings (`<extension-id>-settings.json`) | [extension-settings.schema.json](../schemas/extension-settings.schema.json) |

Internal profile configuration, credentials, caches, private extension storage,
and app settings are not public interchange formats and are not covered.

## Editor support

This repository's [VS Code settings](../.vscode/settings.json) associate flows,
canvases, bundled/demo themes, extension manifests, and exported settings with
local schemas. No network access is needed for these associations or schema
tests. Schemas are also included in packaged applications.

In another workspace, copy the schemas together and add `json.schemas`
associations pointing to that folder. The theme and settings-export schemas
reference definitions in the manifest schema, so keep their relative locations.
Associate `.flow` and `.canvas` with the JSON language mode, too.

Alternatively, add a `$schema` property to a document. For example, when the
document is next to a `schemas` folder:

```json
{
  "$schema": "./schemas/flow.schema.json",
  "version": 1,
  "sheets": [
    { "name": "Case", "columns": ["1AC", "1NC"], "rows": [["Claim", "Answer"]] }
  ]
}
```

References are relative to each schema's location rather than an absolute
remote `$id`, so copying the schema folder also works offline. Applications
may normalize exported theme and manifest data, so do not rely on `$schema`
being retained by every exporter.

## Runtime validation still applies

Schemas provide completion, descriptions, and structural validation; they do
not replace Tagline's existing parsers and permission checks.

- Flow rows must have exactly as many cells as the sheet has columns.
- Canvas node/edge IDs must be unique, and edges must reference existing nodes.
  Unknown Canvas and flow fields remain supported. Canvas link targets include
  local files and wiki links, not only HTTP(S).
- Extension contribution IDs must be unique; ribbon commands must be declared.
  Referenced files must stay inside the extension folder, including symlinks.
- Theme setting targets must exist and be unique. Defaults must satisfy their
  declared bounds, string lengths, enum choices, and color constraints.
- Imported extension settings must match the receiving extension ID and its
  current manifest's declared settings. The generic export schema cannot know
  another extension's per-setting rules.
- Configurable collection, variable, and value limits use their maximum
  supported values in the schemas. A profile can enforce smaller limits.

Run `node --test tests/schemas.test.cjs` (also included in `npm test`) to compile
all schemas offline and check fixtures against both schemas and runtime parsers.
