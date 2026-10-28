# JSON formats and schemas

The Tagline user documentation has moved to the
[Tagline documentation site](https://julieisbaka.github.io/Tagline-pages/docs/index.html).
This local copy may be out of date; see the site for the current version.

[Documentation home](./README.md)

Tagline ships draft-07 JSON Schemas for its user-authored and exchanged formats:

| Format | Schema |
| --- | --- |
| Speech flow (`.flow`) | [flow.schema.json](../schemas/flow.schema.json) |
| Extension `manifest.json` | [extension-manifest.schema.json](../schemas/extension-manifest.schema.json) |
| Imported, exported, or extension theme | [theme.schema.json](../schemas/theme.schema.json) |
| Exported extension settings (`<extension-id>-settings.json`) | [extension-settings.schema.json](../schemas/extension-settings.schema.json) |

Canvas files follow the [JSON Canvas specification](https://jsoncanvas.org/spec/1.0/).

## Editor support

This repository's [VS Code settings](../.vscode/settings.json) associate flows,
bundled/demo themes, extension manifests, and exported settings with
local schemas.

In another workspace, copy the schemas together and add `json.schemas`
associations pointing to that folder. The theme and settings-export schemas
reference definitions in the manifest schema, so keep their relative locations.
Associate `.flow` with the JSON language mode, too.

Alternatively, add a `$schema` property to a document. For example, when the
document is next to a `schemas` folder:

```json
{
  "$schema": "./schemas/flow.schema.json",
  "version": 1,
  "sheets": [{ "name": "Case", "columns": ["1AC", "1NC"], "rows": [["Claim", "Answer"]] }]
}
```

References are relative to each schema's location rather than an absolute
remote `$id`, so copying the schema folder also works offline. Applications
may normalize exported theme and manifest data, so do not rely on `$schema`
being retained by every exporter.
