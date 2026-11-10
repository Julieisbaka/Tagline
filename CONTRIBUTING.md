# Contributing to Tagline

Thanks for your interest in contributing to Tagline, an Obsidian-style knowledge vault for policy debaters.

## How to contribute

1. **Fork the repo** and create a feature branch from `main`.
2. **Make your changes** following the existing code style.
3. **Run the checks** locally before opening a pull request:

   ```sh
   npm install
   npm run lint          # ESLint
   npm run format:check  # Prettier
   npm test              # unit tests
   ```

4. **Commit** with a conventional message (e.g., `feat: ...`, `fix: ...`, `docs: ...`).
5. **Open a pull request** against `main`. Describe what changed and why.

## Repo layout

- `src/` — renderer (React) app code, components, styles, locales, themes.
- `electron/` — main/preload Electron processes.
- `tests/` — unit tests (`*.test.cjs`) and smoke tests (`*-smoke.cjs`).
- `scripts/` — build and utility scripts.
- `website/` — static GitHub Pages site and user documentation (`website/docs/`).
- `extensions/registry.json` — community extension registry shown in the in-app extension browser.
- `build/` — app icons and branding.

## Testing

Tagline uses Node's built-in test runner (`node --test`) plus Electron smoke suites.

```sh
npm test              # all unit tests
npm run test:all      # unit + every smoke suite, sequentially
npm run test:<name>   # individual smoke suite, e.g. test:a11y
```

## Vault format changes

Every change to persisted vault data must ship with a migration in `electron/vaultMigrations.cjs`: append the next consecutive version with a user-facing `title`, `description`, `up(stagingRoot)`, and `validate(stagingRoot)`. Never modify a released migration. Include changes to Markdown/frontmatter, flows, canvases, settings stored in the vault, attachments, and hidden metadata. App-profile settings outside the vault are separate.

Unversioned vaults start at version 0. The registry length is the current format; new empty vaults start at that version. Existing vaults run every missing step, in order, through the native migration wizard before becoming active. Steps operate only inside the supplied staging directory, never the active vault or external paths. Validation must reject invalid output before commit. Preserve unknown fields and unrelated files. Add fixtures for older versions, skipped-version upgrades, and failure preservation to `tests/vault-migrations.test.cjs`.

The engine copies the entire vault (including binary files and hidden metadata), applies and validates changes there, then replaces the original directory while retaining it as a sibling `.tagline-backup-<id>` folder. Linked files/directories and special files are refused during migration. The parent folder must be writable and have room for a full copy. Pause cloud sync and close other editors; external concurrent writes are not coordinated. A recovery journal restores the original if the process stops between directory renames. This is not a guarantee against filesystem corruption or power loss. Interrupted staging copies are retained for inspection. To restore manually, close Tagline and replace the upgraded vault folder with its backup.

## Submitting an extension

Community extensions appear in **Settings > Extensions > Browse extensions** when their GitHub URL is listed in [`extensions/registry.json`](extensions/registry.json). To add yours, open a pull request that appends `{ "url": "https://github.com/owner/repo" }` (or `https://github.com/owner/repo/tree/<ref>/<folder>` for a tag, branch, or subfolder). The folder must contain a `manifest.json` that validates against `schemas/extension-manifest.schema.json` and whose `sourceUrl` matches the registry URL exactly (same repository, ref, and folder); the Extension registry workflow checks every listed manifest. See [Browse and publish extensions](https://julieisbaka.github.io/Tagline/docs/extension-api.html#registry).

## Pull requests

- Keep PRs focused on a single change.
- Update or add tests for new behavior.
- Update docs (`website/docs/`) and README when user-facing behavior changes.
- All required CI checks (lint and tests) must pass; run `format:check` locally.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to abide by its terms.
