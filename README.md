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

## Releases and updates

Builds are unsigned and not notarized, so OS security warnings are expected.
Use **Settings > Installation > Check for updates** to compare the installed
version with the latest stable GitHub release. This contacts the public GitHub
API only when requested; it sends no vault contents or account credentials.
The same panel links to the repository and releases. Errors, including no
published release or rate limiting, appear in the panel.
There is no automatic checking, downloading, or installing. Quit Tagline, then run the newer Windows
installer using the same scope/location, or replace Tagline in Applications
on macOS. Keep the existing app ID, product name, and installation scope when
packaging future versions: these identify the app and its persistent profile.
Do not delete the profile when updating. Back up the profile and vaults first.

## Documentation

- [Documentation home](./docs/README.md)
- [Features and settings](./docs/features.md)
- [Extension API](./docs/extension-api.md)
- [Theme API and custom CSS](./docs/theme-api.md)
- [JSON formats and schemas](./docs/json-formats.md)
