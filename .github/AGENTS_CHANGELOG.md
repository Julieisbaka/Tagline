# Agent Changelog & Website Documentation Guidelines

When updating release notes, pinned tabs, or any user-facing documentation, follow these conventions so the changelog and website remain consistent.

## Version numbering

- Repo uses [SemVer](https://semver.org/): `MAJOR.MINOR.PATCH` (currently `0.1.3`).
- New releases always start as "In development" under `v0.1.3` (or whatever the version is at the time) until a release tag is cut.
- When the user requests a new release, move the current "In development" section to a released version (e.g., `v0.1.2`) and add a new `v0.1.3` section.

## Updating CHANGELOG.md (root)

### Adding a new fix/feature

1. Place the entry under the **latest** `v0.x.y` "In development" section.
2. Use the appropriate heading:
   - **Added** — New features, capabilities, or significant enhancements.
   - **Improved** — UX, performance, polish, refactors that don't change surface behavior.
   - **Fixed** — Bug fixes, crash repairs, data-loss prevention.
   - **Removed** — Features, capabilities, or elements that have been intentionally removed.
   - **Deprecated** — Features or capabilities that are planned for removal in future releases.
3. Each entry is a single `<li>` item. Keep it concise but descriptive.
4. Group related changes under the same heading if there are multiple.

### Example entry

```markdown
- Fixed: pins writes now retry on EBUSY/EPERM (Windows file-lock hazard).
```

## Updating website/changelog.html

The website changelog lives in `<section id="v0-x-y">` blocks keyed by version. Follow these rules:

### Adding a new entry

1. **Find the latest `v0.x.y` "In development" section** (the one with `aria-current="location"`).
2. Inside that section, add your entry:
   - Under `<h3>Improved</h3>` → `<ul><li>...</li></ul>`
   - Under `<h3>Fixed</h3>` → `<ul><li>...</li></ul>`
3. Use the same formatting as existing entries (no markdown bold inside `<li>` unless the original uses it; prefer plain text or `<code>` for file paths).
4. If the change was already documented in `CHANGELOG.md`, copy the same text (or a concise variant) into the HTML `<li>`.

### Example: Adding a fixed bug

```html
<h3>Fixed</h3>
<ul>
  <!-- existing entries -->
  <li>Fixed: pins.json no longer rewrites on every tab close when the path wasn't pinned.</li>
  <li>Fixed: read failure no longer blocks tab restoration and write persistence.</li>
  <li>Fixed: pins writes now retry on EBUSY/EPERM (Windows file-lock hazard).</li>
</ul>
```

### Adding a new version section

When releasing, duplicate the latest section, increment the version number, and update the heading:

```html
<section id="v0-1-2">
  <p class="article-kicker">Released</p>
  <h2>0.1.2</h2>
  ...
  <a href="#main" aria-current="location">0.1.2 · In development</a>   <!-- keep this for the next version -->
</section>
```

## Workflow checklist

Before marking a changelog update complete:

- [ ] Entry is under the correct version section (`v0.x.y` "In development").
- [ ] Entry uses the right heading (`Improved` vs `Fixed`).
- [ ] `CHANGELOG.md` and `website/changelog.html` both contain the entry (or the HTML entry references the markdown).
- [ ] Version number is correct and consistent between both files.
- [ ] No duplicate entries for the same change.

## Conventions from this project

- File paths in notes are referenced as `.tagline/pins.json`, not `src/lib/useFavorites.js`.
- Bug descriptions focus on user-visible behavior, not internal implementation.
- Keep `<li>` items on a single line when possible; avoid nested lists inside changelog entries.

## Updating website/docs/ (general documentation)

The `website/docs/` folder contains Markdown-filed HTML pages that describe Tagline's features, workflows, and API. Follow these guidelines when changes affect user-visible behavior:

### When a fix changes user-facing behavior

1. **Check if the change affects any documented feature** — search `website/docs/` for keywords related to the change (e.g., "pin", "pinned tab", "favorites", "save", "persist").
2. **If documentation needs updating**:
   - Edit the relevant `.html` file in `website/docs/`.
   - Keep the existing formatting (same CSS classes, heading hierarchy, link patterns).
   - If adding or revising a feature description, follow the style of the existing entries: concise paragraphs, `<code>` for file paths, no nested lists inside feature bullets.
3. **If the change is internal/or does not affect UX**, no doc update is needed — note this in the changelog entry with a brief "internal" note.

### Example: Documenting a pin-related fix

If a fix changes how pinned tabs behave, you might add or modify a sentence in `website/docs/notes-and-evidence.html` or another relevant doc, keeping the same structure:

```html
<li>Fixed: pinned tabs now persist correctly after a read error, instead of going inert.</li>
```

### Workflow checklist (updated)

Before marking a changelog update complete:

- [ ] Entry is under the correct version section (`v0.x.y` "In development").
- [ ] Entry uses the right heading (`Improved` vs `Fixed`).
- [ ] `CHANGELOG.md` and `website/changelog.html` both contain the entry.
- [ ] Version number is correct and consistent between both files.
- [ ] **No duplicate entries for the same change.**
- [ ] If the fix affects user-visible behavior, check `website/docs/` for related topics and update if needed (search for keywords like "pin", "pinned", "favorites", "persist", "save").
- [ ] All three files are in sync: `CHANGELOG.md`, `website/changelog.html`, and any affected `website/docs/*.html`.
