# Tagline

![Tagline icon](build/icon.png)

A local-first policy debate workspace for Markdown evidence and `.flow` speech
grids. Tagline combines visual/source editing, citations, full-text and local
semantic search, speech documents, timers, configurable shortcuts, themes,
and sandboxed extensions.

Your vault is an ordinary folder. Standalone HTML export is built in; other
document import/export formats use an optional, separately installed Pandoc.

## Run

```sh
npm install
npm run dev     # Vite + Electron development
npm start       # build and launch
npm run package # package for the current operating system
```

Open an existing folder as a vault or create the sample vault on first launch.
Windows, macOS, and Linux packaging targets are configured.

## Documentation

- [Documentation home](./docs/README.md)
- [Application features, settings, and shortcuts](./docs/features.md)
- [Extension API](./docs/extension-api.md)
- [Theme API and custom CSS](./docs/theme-api.md)
- [Feature suggestions](./docs/feature-suggestions.md)
- [Debate embedding training pipeline](./model/README.md)

Run `npm test` for unit tests; the available Electron integration-test scripts
are listed in [package.json](./package.json).
