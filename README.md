# Tagline

![Tagline icon](build/icon.png)

A local-first workspace for debate research, Markdown evidence, and `.flow`
speech grids. Includes visual/source editing, citations, search, revision
history, speech tools, and more.

Vaults are ordinary folders. HTML export is built in; other import/export
formats use the optional [Pandoc](https://pandoc.org/) intergration.

## Run

```sh
npm install
npm run dev      # development
npm start        # build and launch
npm run package  # package for this operating system
```

Open a folder as a vault or create the sample vault on first launch.

## Tests

Run the complete unit and smoke-test suite sequentially with:

```sh
npm run test:all
```

Individual smoke suites are available as `npm run test:<name>`. The full runner
includes `npm test` and every `test:*` script except itself and the redundant
`test:shared` / `test:platform` subsets. At the end it summarizes every suite's
result with total execution time and counts for tests run, passed, failed,
skipped, and canceled. Suite output stays hidden during the run; failures and
their full captured output are written to `test-all.log`. Some auth and
password rejection cases intentionally expect errors; they count as passing
when the tests assert those errors correctly. The case count includes
individual `node:test` cases and one case per standalone smoke-test script.

## Releases and updates

Builds are unsigned and not notarized, so OS security warnings are expected.
Use **Settings > Installation > Check for updates** to compare the installed
version with the latest stable GitHub release. This contacts the public GitHub
API only when requested; it sends no vault contents or account credentials.
The same panel links to the repository and releases. Errors will appear in the panel.
There is no automatic updating. Quit Tagline, then run the newer Windows
installer using the same scope/location, or replace Tagline in Applications
on macOS. Keep the existing app ID, product name, and installation scope when
packaging future versions: these identify the app and its persistent profile.
Do not delete the profile when updating. Back up the profile and vaults first.

## Documentation

The Tagline user documentation has moved to the
[Tagline documentation site](https://julieisbaka.github.io/Tagline-pages/docs/index.html).
