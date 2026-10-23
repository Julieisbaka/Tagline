# Tagline

![Tagline icon](build/icon.png)

A local-first workspace for debate research, Markdown evidence, and `.flow`
speech grids. Includes visual/source editing, citations, search, revision
history, speech tools, themes, and extensions.

Vaults are ordinary folders. HTML export is built in; other import/export
formats use the optional [Pandoc](https://pandoc.org/).

## Run

```sh
npm install
npm run dev      # development
npm start        # build and launch
npm run package  # package for this operating system
```

Open a folder as a vault or create the sample vault on first launch.

## Documentation

- [Documentation home](./docs/README.md)
- [Features and settings](./docs/features.md)
- [Extension API](./docs/extension-api.md)
- [Theme API and custom CSS](./docs/theme-api.md)

Run `npm test` for unit tests. Electron integration-test commands are listed in
[package.json](./package.json).
