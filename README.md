# Tagline

![Tagline icon](build/icon.png)

A local-first workspace for debate research, Markdown evidence, and `.flow`
speech grids. Includes visual/source editing, citations, search, revision
history, speech tools, and more.

Vaults are ordinary folders. HTML export is built in; other import/export
formats use the optional [Pandoc](https://pandoc.org/) integration.

## Run

```sh
npm install
npm run dev      # development
npm start        # build and launch
npm run package  # package for this operating system
```

Renderer builds target the host OS by default. For cross-platform packaging, set
`TAGLINE_TARGET_PLATFORM` to `win32`, `darwin`, or `linux` before building the
renderer, and package that renderer for the same target. Rebuild for each target.

Open a folder as a vault or create the sample vault on first launch.

## Releases and updates

Builds are unsigned and not notarized, so OS security warnings are expected.
Use **Settings > Installation > Check for updates** to compare the installed
version with the latest stable GitHub release. Quit Tagline, then run the newer Windows
installer using the same scope/location, or replace Tagline in Applications
on macOS. Keep the existing app ID, product name, and installation scope when
packaging future versions: these identify the app and its persistent profile.
Do not delete the profile when updating. Back up the profile and vaults first.

## Documentation

The Tagline user documentation is at the [Tagline documentation site](https://julieisbaka.github.io/Tagline/docs/index.html).
