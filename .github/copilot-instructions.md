# Copilot instructions

## Project structure

Tagline is a local-first debate research workspace built with React, Vite, and Electron. The renderer is assembled in `src/App.jsx`; reusable UI lives in `src/components/`, and renderer-side state and utilities live in `src/lib/`. Electron main-process modules handle filesystem access, operating-system integration, and external services. The renderer accesses those capabilities through the `window.api` bridge in `electron/preload.cjs`; keep that boundary intact.

Vaults are ordinary folders containing Markdown notes and structured files such as `.flow` and canvas documents. Keep file-format behavior and validation consistent with the relevant modules in `src/lib/`, `electron/`, and `schemas/`.

Extensions run in a sandboxed worker and use the `tagline` API, not the application DOM or Node.js. When changing the extension surface, keep its implementation, JSON schemas, `docs/extension-api.md`, and the example under `demo/` in sync.

## Build and test

- `npm run dev` — start Vite and Electron for development.
- `npm run build` — build the renderer.
- `npm test` — run the Node.js unit tests.
- `node --test tests/<file>.test.cjs` — run one unit-test file; add `--test-name-pattern="<pattern>"` to filter its tests.
- `npm run test:<name>` — run a focused smoke suite, such as `npm run test:canvas`.
- `npm run test:all` — run the complete unit and smoke-test suite sequentially.

## Project conventions

- Add renderer-to-main capabilities through the preload API and the corresponding Electron handler or module; do not bypass the bridge from renderer code.
- Keep extension API behavior consistent across its implementation, schema, documentation, and demo.
- When suggesting features, inspect the current README, docs, and implementation first; do not suggest capabilities Tagline already has.
- Follow the user's latest stated direction and constraints when brainstorming. If the user narrows or changes the request, use the new scope.
- Offer several balanced, implementable ideas rather than only tiny conveniences, oversized workflows, or a single idea.
- Ground feature suggestions in Tagline's debate workflows and existing product capabilities rather than generic productivity-app ideas.
