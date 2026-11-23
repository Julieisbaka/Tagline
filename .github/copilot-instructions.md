# Copilot instructions

## Project structure

Tagline is a local-first debate research workspace built with React, Vite, and Electron. The renderer is assembled in `src/App.jsx`; reusable UI lives in `src/components/`, and renderer-side state and utilities live in `src/lib/`. Electron main-process modules handle filesystem access, operating-system integration, and external services. The renderer accesses those capabilities through the `window.api` bridge in `electron/preload.cjs`; keep that boundary intact.

`src/lib/` is organized by domain; add new modules to the matching folder rather than the `src/lib/` root, and create a new domain folder only when none fits:

- `evidence/` — cards, citations, evidence checkup, recut/NLI checks
- `speech/` — timers, reading time, speech rate
- `flow/` — flow cell, row, text, and card-link helpers
- `vault/` — vault index, tabs, favorites, pending edits, vault state hooks
- `editor/` — CodeMirror and visual-editor helpers, paste and formatting transforms
- `extensions/` — the extension host, helper API, capabilities, and hooks
- `settings/`, `commands/` — persisted settings and ribbon/status items; command palette and keybindings
- `markdown/`, `search/`, `canvas/`, `ui/`, `i18n/` — Markdown and frontmatter, search, canvas links, themes and focus handling, localization
- `shared/` — dependency-free helpers used across domains (dates, stored JSON)

Several `src/lib/` modules are also loaded by the Electron main process (for example, the MCP evidence tools and `keybindings.json`). Any such file must be listed in `build.files` in `package.json`, and `tests/mcp-archive-smoke.cjs` verifies the packaged set; update both when you move or add one.

Vaults are ordinary folders containing Markdown notes and structured files such as `.flow` and canvas documents. Keep file-format behavior and validation consistent with the relevant modules in `src/lib/`, `electron/`, and `schemas/`.

Extensions run in a sandboxed worker and use the `tagline` API, not the application DOM or Node.js. When changing the extension surface, keep its implementation, JSON schemas, the Tagline documentation site, and the example under `demo/` in sync.

## Build and test

If build, lint, or unit tests fail because a tool or module listed in `package-lock.json` is missing, run `npm ci` from the repository root and retry the affected check.

- `npm run dev` — start Vite and Electron for development.
- `npm run build` — build the renderer.
- `npm test` — run the Node.js unit tests.
- `node --test tests/<file>.test.cjs` — run one unit-test file; add `--test-name-pattern="<pattern>"` to filter its tests.
- `npm run test:<name>` — run a focused smoke suite, such as `npm run test:canvas`.
- `npm run test:all` — run the configured unit and smoke-test suite sequentially.

## Project conventions

- Add renderer-to-main capabilities through the preload API and the corresponding Electron handler or module; do not bypass the bridge from renderer code.
- When suggesting features, inspect the current README, docs, and implementation first; do not suggest capabilities Tagline already has.
- Follow the user's latest stated direction and constraints when brainstorming. If the user narrows or changes the request, use the new scope.
- Offer several balanced, implementable ideas rather than only tiny conveniences, oversized workflows, or a single idea.
- Ground feature suggestions in Tagline's debate workflows and existing product capabilities rather than generic productivity-app ideas.
