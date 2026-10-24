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

Run **Actions > Release > Run workflow** to publish `v<package.json version>`.
Update the version with `npm version <version> --no-git-tag-version` first.
The workflow tests and builds a Windows x64 installer and macOS Intel/Apple
Silicon disk images, then publishes all three with SHA-256 checksums. It never
runs on pushes or tags. Published versions cannot be overwritten; failed
uploads leave a draft that the same commit can retry.

Builds are unsigned and not notarized, so OS security warnings are expected.
There is no automatic updater. Quit Tagline, then run the newer Windows
installer using the same scope/location, or replace Tagline in Applications
on macOS. Keep the existing app ID, product name, and installation scope when
packaging future versions: these identify the app and its persistent profile.
Do not delete the profile when updating. Back up the profile and vaults first.

**Settings > Installation** shows the version, runtime, executable, and profile
location. `npm run build` followed by `npm run test:installation` checks profile
preservation across simulated versions and renderer installation locations;
it does not automate OS installer replacement.

## Documentation

- [Documentation home](./docs/README.md)
- [Features and settings](./docs/features.md)
- [Extension API](./docs/extension-api.md)
- [Theme API and custom CSS](./docs/theme-api.md)

Run `npm test` for unit tests. Electron integration-test commands are listed in
[package.json](./package.json).

`npm run test:startup` measures welcome-screen, vault, and restored-editor
startup with a temporary 200-note vault (three runs per scenario; build time
excluded). Set `TAGLINE_STARTUP_SAMPLES` to change the sample count.
Reports median main/renderer readiness, uncompressed JavaScript bytes, and
process duration (including exit). Editors and dialogs load on demand.
