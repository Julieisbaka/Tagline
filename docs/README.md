# Tagline documentation

Tagline is a local-first policy debate workspace. Vaults are ordinary folders of
Markdown notes (`.md`) and JSON flow documents (`.flow`).

## Guides

- [Application features](./features.md): workflows, editing, search, citations,
  flows, settings, shortcuts, import/export, and privacy.
- [Extension API](./extension-api.md): installation, manifests, permissions,
  commands, editor/vault access, storage, examples, and current limitations.
- [Theme API](./theme-api.md): JSON format, every supported color token,
  import/export, theme extensions, and accessibility.
- [Feature suggestions](./feature-suggestions.md): proposed improvements,
  priorities, and possible implementation boundaries. These are not shipped
  features or a committed roadmap.

For installation, development commands, and test commands, see the
[project README](../README.md).

## Status and conventions

These guides describe the current pre-release implementation. The extension
manifest and theme JSON formats both use version `1`; this is not a promise of
long-term API stability.

Keyboard shortcuts shown in the guides are defaults. `Mod` means Ctrl on
Windows/Linux and Cmd on macOS. Change bindings in
**Settings > Keyboard shortcuts**.

Application settings, imported fonts, extensions, credentials, and downloaded
models live in the application profile, not in the vault. Sharing a vault does
not automatically share those preferences or dependencies.
