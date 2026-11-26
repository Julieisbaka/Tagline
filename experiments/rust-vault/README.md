# Rust vault filesystem probe

This is an opt-in experiment for a narrow Electron-to-Rust filesystem boundary.
It is not used by the renderer or production vault handlers. The Electron
adapter is included by the release file glob, but the native addon is not
packaged. The native build and comparison are opt-in locally and run in CI on
Linux, Windows, and macOS; the adapter tests run in the normal test suite
without building the addon. The existing JavaScript implementation in
`electron/vaultFiles.cjs` remains the application's source of truth.

Run the probe with:

```sh
npm run experiment:rust-vault
```

The command builds a platform-specific N-API addon and compares its read-only
`listNotePaths(root)` result with the JavaScript `listVault(root)` result for a
small temporary vault. The experiment also exposes `listVault(root, base)` and
`readVaultSnapshot(root)` through the adapter and compares trees, timestamps,
contents, cache invalidation, errors, and root `.taglineignore` rules with the
JavaScript implementation. Tree ordering uses JavaScript `localeCompare` in
the adapter; filesystem traversal, metadata, reads, and snapshot caching run
in a native worker for the asynchronous vault APIs. `listNotePaths` remains
synchronous and can block the main thread.
The Rust `ignore` crate and Node's `ignore` package are independent matchers;
the fixtures exercise common patterns but do not establish complete parity.
Rules the Rust parser cannot compile are skipped individually so other valid
rules remain effective.

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

This probe intentionally omits native file watching, native addon packaging,
and IPC registration. Snapshot caching, like the JavaScript implementation,
uses file mtime and size and prunes entries missing from a successful snapshot.
Native filesystem errors expose common Node error codes through the adapter,
but their messages and other error properties are not identical to Node's.
Parity is not established for all ignore rules, platforms, or filesystem races.
