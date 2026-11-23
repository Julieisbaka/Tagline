# Changelog and website documentation instructions

Follow these rules whenever a change affects Tagline's release notes or product documentation.

## Version and release status

- The version in `website/changelog.html` is the release version without a suffix, such as `0.1.3`.
- While that version is in development, show it as **In development** in the changelog and set `package.json`'s `version`, `package-lock.json`'s top-level `version`, and `package-lock.json`'s `packages[""].version` to the same version with `-dev` appended, such as `0.1.3-dev`.
- When preparing that version for release, remove `-dev` from both package files and remove the in-development status from its changelog entry. In `website/changelog.html`, change the section's article kicker to `Released`, remove the `In development` badge from its heading, and remove `· In development` from its sidebar link. Keep the version number and section anchor consistent.
- Do not create a new development version, guess a version bump, publish a release, or create a tag unless explicitly requested. Do not modify previous released entries as part of a new release.
- When a new development version is explicitly requested, use the requested version consistently in the package files and add its in-development section and sidebar link above older versions.

## Updating `website/changelog.html`

- This file is the public release changelog. Add relevant user-visible changes to the newest **In development** section, not to an older release.
- Group entries under the existing `Added`, `Improved`, `Fixed`, `Removed`, or `Deprecated` headings as appropriate. Add a heading only when needed.
- Write concise, plain-language entries describing the user-visible result. Use one `<li>` per change, match the surrounding HTML style, and use `<code>` for literal filenames or commands where helpful.
- Avoid duplicate entries and implementation-only details. Preserve the content of already released entries.

## Product and developer documentation

- `docs/` is the authoritative home for Tagline's user-facing and developer documentation. `website/docs/` is a temporary GitHub Pages fallback pending the Mintlify cutover; do not edit it as the primary documentation.
- For every change, check whether it changes documented behavior, workflows, settings, installation or update steps, file formats, or APIs. Update the relevant MDX page under `docs/` when needed; create a new page when no existing page covers a substantial new topic.
- When creating a documentation page, follow the existing MDX conventions, add the page to `docs/docs.json` and the documentation home, and link to it from related pages where useful. Preserve existing heading IDs and legacy redirects.
- Keep documentation accurate to the implementation and explain behavior from the user's perspective. The changelog is not a substitute for documentation.
- A change that does not affect documented user-facing behavior does not need a documentation edit.
- Do not hard-code values that the code defines. In MDX, wrap each rendered value in `{/* TAGLINE:KIND:argument */}` and `{/* /TAGLINE */}` markers, then run `npm run sync:docs`. Supported kinds are `SETTING:key` (defaults in `defaultSettings.json`), `KEY:id`, `KEY_WIN:id`, `KEY_MAC:id` (default shortcuts), `LIMIT:key[.min|.max]` (`electron/customization.mjs`), and `CONST:path#NAME` (numeric constants in source files). Unit tests reject stale or unknown values. Do not use these markers in `website/changelog.html`, which records history rather than current values.

## Completion check

- [ ] Development versions match across the changelog section, `package.json`, and both `package-lock.json` version fields (`X.Y.Z` in the changelog and `X.Y.Z-dev` in package metadata).
- [ ] For a release-preparation change, both package files use `X.Y.Z` and the matching changelog section no longer says `In development`.
- [ ] Relevant website documentation is updated or created when the change affects documented behavior.
- [ ] New documentation pages are linked from the documentation index and related pages as appropriate.
- [ ] No duplicate changelog entries or unrelated edits to released notes were introduced.
