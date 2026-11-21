# Security Policy

## Supported versions

The current release of Tagline receives security updates. Older, unsigned
development builds are not supported.

## Reporting a vulnerability

Please do **not** file a public issue for security vulnerabilities. Instead,
contact the maintainer directly (via GitHub) with:

- A description of the issue and its impact
- Steps to reproduce
- Any suggested fix or mitigation

We will acknowledge receipt, investigate, and coordinate a fix with you before
any public disclosure.

## What we consider in scope

- Vulnerabilities in the Tagline application itself (renderer, Electron main,
  preload scripts)
- Dependency vulnerabilities reachable by the app

## Out of scope

- Issues in the user's vault files or third-party tools (Pandoc, Google Docs) [^1]
- Social engineering or physical-access attacks [^2]
- Issues in unsupported Electron/Node versions

## Policy

Tagline builds are unsigned and not notarized; OS security warnings are
expected. In packaged installations, Tagline checks the public GitHub Releases
API shortly after startup and downloads a compatible update in the background
by default; it never installs an update without your choice. Turn this off with
**Settings > Installation > Automatically check for and download updates on
startup** (safe mode and `TAGLINE_DISABLE_AUTO_UPDATE=1` also disable it), or
request a check yourself via **Settings > Installation > Check for updates**.
Update checks contact the public GitHub API only; they never send vault
contents or account credentials.

Extension IPC is restricted to the application window's main frame. Extension
workers use the renderer's permission-checked `tagline` API rather than calling
Electron IPC directly.

## Notes

[^1]: We will try to implement workarounds for issues in external tools when possible.

[^2]: We do and will implement standard security features to prevent this. If this happens to you, we would be happy to help mitigate the impact and provide guidance on recovery.
