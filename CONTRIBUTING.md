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
- `build/` — app icons and branding.

## Testing

Tagline uses Node's built-in test runner (`node --test`) plus Electron smoke suites.

```sh
npm test              # all unit tests
npm run test:all      # unit + every smoke suite, sequentially
npm run test:<name>   # individual smoke suite, e.g. test:a11y
```

## Pull requests

- Keep PRs focused on a single change.
- Update or add tests for new behavior.
- Update docs (`website/docs/`) and README when user-facing behavior changes.
- All required CI checks (lint and tests) must pass; run `format:check` locally.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to abide by its terms.
