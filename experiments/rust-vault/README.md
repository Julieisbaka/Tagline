# Rust vault filesystem probe

This is an opt-in experiment for a narrow Electron-to-Rust filesystem boundary.
It is not included in the renderer, Electron build, release packaging, or the
normal test suite. The existing JavaScript implementation in
`electron/vaultFiles.cjs` remains the application's source of truth.

Run the probe with:

```sh
npm run experiment:rust-vault
```

The command builds a platform-specific N-API addon and compares its read-only
`listNotePaths(root)` result with the JavaScript `listVault(root)` result for a
small temporary vault.

```text
probe script
  -> electron/rustVaultProbe.cjs
  -> experiments/rust-vault/dist/*.node
  -> Rust std::fs traversal
```

The intended production boundary is unchanged IPC: Electron would continue to
validate the vault and IPC sender, while a Rust addon could replace a private
filesystem primitive behind that handler.

This probe intentionally omits ignore-rule parsing, content caching, native file
watching, packaging, and IPC registration. Those belong in later experiments
after the build and error-handling tradeoffs are understood.
