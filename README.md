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

Older vault formats open a migration wizard before loading. Review the required upgrades, pause cloud sync and close other editors, then choose **Back up and upgrade**. Upgrades run in order on a separate copy; the original stays beside the vault as a `.tagline-backup-<id>` folder. Cancel leaves the vault unchanged. Newer, unsupported formats are refused rather than rewritten. Keep backups until you have checked your data; to restore, close Tagline and replace the upgraded folder with its backup.

## Releases and updates

Builds are unsigned and not notarized, so OS security warnings are expected.
Use **Settings > Installation > Check for updates** to compare the installed
version with the latest stable GitHub release. Quit Tagline, then run the newer Windows
installer using the same scope/location, or replace Tagline in Applications
on macOS. Keep the existing app ID, product name, and installation scope when
packaging future versions: these identify the app and its persistent profile.
Do not delete the profile when updating. Back up the profile and vaults first.

## Documentation

Start with the [Getting started guide](https://julieisbaka.github.io/Tagline/docs/getting-started.html), browse the
[Tagline documentation site](https://julieisbaka.github.io/Tagline/docs/index.html), or see the
[changelog](https://julieisbaka.github.io/Tagline/changelog.html).
