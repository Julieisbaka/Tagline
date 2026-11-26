# Rust vault filesystem probe

This is an opt-in experiment for a narrow Electron-to-Rust filesystem boundary.
It is not included in the renderer, Electron build, or release packaging. The
native build and comparison are opt-in; the adapter tests run in the normal
test suite without building the addon. The existing JavaScript implementation in
`electron/vaultFiles.cjs` remains the application's source of truth.

Run the probe with:

```sh
npm run experiment:rust-vault
```

The command builds a platform-specific N-API addon and compares its read-only
`listNotePaths(root)` result with the JavaScript `listVault(root)` result for a
small temporary vault.
It also compares root `.taglineignore` rules against the JavaScript listing.
The Rust `ignore` crate and Node's `ignore` package are independent matchers;
the fixtures exercise common patterns but do not establish complete parity.

If the output directory contains addons from multiple targets, remove the stale
`.node` files from `experiments/rust-vault/dist` and run the command again.

```text
probe script
  -> electron/rustVaultProbe.cjs
  -> experiments/rust-vault/dist/*.node
  -> Rust std::fs traversal
```

The intended production boundary is unchanged IPC: Electron would continue to
validate the vault and IPC sender, while a Rust addon could replace a private
filesystem primitive behind that handler.

This probe intentionally omits content caching, native file watching, packaging,
and IPC registration. Those belong in later experiments after the build and
error-handling tradeoffs are understood.
