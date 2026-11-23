# Tagline

![Tagline icon](build/icon.png)

A local-first workspace for debate research, Markdown evidence, and `.flow`
speech grids. Includes visual/source editing, citations, search, revision
history, speech tools, and more.

Vaults are ordinary folders. HTML export and Google Docs transfer are built in;
document import and other export formats use the optional [Pandoc](https://pandoc.org/) integration.

## Get Tagline

Download the [latest release](https://github.com/Julieisbaka/Tagline/releases/latest) for Windows or macOS.
Release builds are unsigned and not notarized, so your operating system may show a security warning.
The [getting started guide](https://julieisbaka.github.io/Tagline/docs/getting-started.html) covers your first vault and updates;
see [vaults, backups and recovery](https://julieisbaka.github.io/Tagline/docs/vaults-and-backups.html) before upgrading or restoring a vault.

## Develop

```sh
npm install
npm run dev      # development
npm start        # build and launch
npm run package  # package for this operating system
```

Renderer builds target the host OS by default. For cross-platform packaging, set
`TAGLINE_TARGET_PLATFORM` to `win32`, `darwin`, or `linux` before building the
renderer, and package that renderer for the same target. Rebuild for each target.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and checks.

## Documentation

Start with the [Getting started guide](https://julieisbaka.github.io/Tagline/docs/getting-started.html), browse the
[Tagline documentation site](https://julieisbaka.github.io/Tagline/docs/index.html), or see the
[changelog](https://julieisbaka.github.io/Tagline/changelog.html).
