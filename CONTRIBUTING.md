# Contributing to Tagline

Thanks for your interest in contributing to Tagline, a knowledge vault and workspace for policy debaters.

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
- `docs/` — Mintlify user guides and technical references.
- `website/` — static GitHub Pages marketing site, changelog, and legal pages.
- `extensions/registry.json` — community extension registry shown in the in-app extension browser.
- `build/` — app icons and branding.

## Documentation

User guides and technical references live in `docs/`. Update the relevant MDX page when behavior changes,
and link to it rather than duplicating workflow instructions in the README or other guides. Add new pages
to `docs/docs.json`. Preserve existing heading IDs and legacy `.html` redirects when changing URLs.
The [documentation home](docs/index.mdx) lists the available guides.

Values marked with `{/* TAGLINE:... */}` and `{/* /TAGLINE */}` are derived from application sources.
Keep both markers and run `npm run sync:docs` when changing the referenced defaults or limits. Unit tests
reject stale values. Do not use these markers in the historical changelog.

To preview and validate the documentation with Node.js 20.17 or newer (not Node 25):

```sh
cd docs
npx mint@4.3.87 dev --no-open
npx mint@4.3.87 validate
npx mint@4.3.87 broken-links --check-anchors
```

The GitHub Pages site is built with `npm run build:website`, which recreates `website-build/`; do not
edit that output. Its documentation links point to the Mintlify site.

### Publishing and hosting

Connect this repository and its deployment branch in Mintlify's
[Git settings](https://app.mintlify.com/settings/project/git-settings), setting the documentation directory
to `/docs`. In [custom domain setup](https://app.mintlify.com/settings/project/custom-domain), configure
`tagline.julieisbaka.dev/docs` as the base path. The directory setting and public base path are separate.
Deploy the documentation before routing traffic to it.

Follow Mintlify's [Cloudflare subpath guide](https://www.mintlify.com/docs/deploy/cloudflare) to deploy the
Worker using the actual `*.mintlify.site` origin. Add Worker routes for `/docs*`, `/_mintlify/*`,
`/mintlify-assets/*`, and `/.well-known/vercel/*`. The Worker must proxy `/docs`, `/docs/*`, and the
asset and verification paths while passing other requests, including `/docs*` matches outside `/docs/`,
to GitHub Pages. Follow the [reverse proxy requirements](https://www.mintlify.com/docs/deploy/reverse-proxy)
for headers and caching. Do not replace the site's DNS or route all traffic to a docs-only Worker.
After routing changes, verify the landing page, docs, assets, search, a legacy `.html` link with an anchor,
and the generated `/docs/llms.txt`. DNS, account authorization, project settings, and the Cloudflare Worker
must be configured by an authorized maintainer.

## Testing

Tagline uses Node's built-in test runner (`node --test`) plus Electron smoke suites.

```sh
npm test              # all unit tests
npm run test:all      # unit tests overlap the sequential smoke suites
npm run test:<name>   # individual smoke suite, e.g. test:a11y
npm run test:all -- --bail     # stop scheduling after the first failure
npm run test:all -- --jobs=2   # opt into concurrent smoke suites
```

Concurrent smoke suites share the desktop and can interfere with focus or clipboard tests.
Use the default one smoke worker for reliable local runs. CI runs four isolated smoke shards;
`--skip-unit --shard=1/4` selects the first shard without repeating the separate unit job.
`--bail` lets already running suites finish. `test:all` builds the renderer once by default;
set `TAGLINE_TEST_DIST_READY=1` only when `dist/` already contains a current build for the
target platform. The same flag lets individual smoke scripts reuse that build.

Name unit tests for the behavior and expected outcome; include the input or scenario in
assertion messages when a test covers several cases. Use `tests/helpers/temporary.cjs`
for temporary directories tied to a Node test's cleanup, and `tests/helpers/smoke.cjs`
for single-process Electron smoke launches. Wrap long smoke scenarios with `scenario()`
and a descriptive name so failures retain both the scenario and the original assertion.
Use `tests/helpers/wait.cjs` for polling with useful timeout diagnostics.

## Vault format changes

Every change to persisted vault data must ship with a migration in `electron/vaultMigrations.cjs`: append the next consecutive version with a user-facing `title`, `description`, `up(stagingRoot)`, and `validate(stagingRoot)`. Never modify a released migration. Include changes to Markdown/frontmatter, flows, canvases, settings stored in the vault, attachments, and hidden metadata. App-profile settings outside the vault are separate.

Unversioned vaults start at version 0. The registry length is the current format; new empty vaults start at that version. Existing vaults run missing steps in order; metadata-only adoption steps can be recorded without the migration wizard, while data-transforming upgrades use it before the vault becomes active. Steps operate only inside the supplied staging directory, never the active vault or external paths. Validation must reject invalid output before commit. Preserve unknown fields and unrelated files. Add fixtures for older versions, skipped-version upgrades, and failure preservation to `tests/vault-migrations.test.cjs`.

The engine copies the entire vault (including binary files and hidden metadata), applies and validates changes there, then replaces the original directory while retaining it as a sibling `.tagline-backup-<id>` folder. Linked files/directories and special files are refused during migration. The parent folder must be writable and have room for a full copy. Pause cloud sync and close other editors; external concurrent writes are not coordinated. A recovery journal restores the original if the process stops between directory renames. This is not a guarantee against filesystem corruption or power loss. Interrupted staging copies are retained for inspection. To restore manually, close Tagline and replace the upgraded vault folder with its backup.

## Submitting an extension

Community extensions appear in **Settings > Extensions > Browse extensions** when their GitHub URL is listed in [`extensions/registry.json`](extensions/registry.json). To add yours, open a pull request that appends `{ "url": "https://github.com/owner/repo" }` (or `https://github.com/owner/repo/tree/<ref>/<folder>` for a tag, branch, or subfolder). The folder must contain a `manifest.json` that validates against `schemas/extension-manifest.schema.json` and whose `sourceUrl` matches the registry URL exactly (same repository, ref, and folder); the Extension registry workflow checks every listed manifest. See [Browse and publish extensions](https://tagline.julieisbaka.dev/docs/extension-api#registry).

Scholarly Search is a bundled core plugin; its source is in `extensions/scholarly-search` and it uses the extension runtime and permissions. An installed customized copy needs a different manifest ID while the bundled plugin is present.

## Pull requests

- Keep PRs focused on a single change.
- Update or add tests for new behavior.
- Update docs (`docs/`) and README when user-facing behavior changes.
- All required CI checks (lint and tests) must pass; run `format:check` locally.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to abide by its terms.
