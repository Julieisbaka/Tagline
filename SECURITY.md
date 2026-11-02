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

- Issues in the user's vault files or third-party tools (Pandoc, Google Docs)
- Social engineering or physical-access attacks
- Issues in unsupported Electron/Node versions

## Policy

Tagline builds are unsigned and not notarized; OS security warnings are
expected. The app checks for updates only when you request it via
**Settings > Installation > Check for updates** and contacts the public GitHub
API. It never sends vault contents or account credentials.
