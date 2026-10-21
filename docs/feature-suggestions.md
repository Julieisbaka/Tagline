# Feature suggestions

[Documentation home](./README.md) | [Current features](./features.md)

These are proposals, **not implemented features or delivery commitments**.
They build on the current workflows without making cloud services necessary.

## Recommended priorities

| Priority | Proposal | Benefit | Initial scope |
| --- | --- | --- | --- |
| 1 | Local note history and recovery | Protect evidence from accidental replacements, extension mistakes, and bad edits. | Bounded per-note snapshots, preview/diff, explicit restore, and a retention setting outside the vault. |
| 2 | Pre-round evidence checklist | Catch missing authors/years, broken URLs, empty highlights, and cards without citations. | Non-destructive report with links to affected cards; never rewrite evidence automatically. |
| 3 | Speech-time calibration | Make syllable-based estimates reflect the individual debater. | Time a known passage and store a local calibration; distinguish estimated from measured duration. |
| 4 | Card-level search and preview | Find the actual card rather than opening an entire file to locate it. | Stable heading-based card results, citation/highlight preview, and send-to-speech action. |
| 5 | Flow-to-evidence links | Move directly from a round argument to supporting evidence. | Per-cell note/card links that survive in-app renames without embedding whole cards in grids. |
| 6 | Theme preview and contrast feedback | Make theme authoring safer and more approachable. | Live preview, foreground/background contrast warnings, and token descriptions; no arbitrary CSS required. |
| 7 | Extension development tools | Reduce trial-and-error and make permissions more understandable. | Manifest validation results, per-extension error log, manual reload, and explicit examples of each permission. |
| 8 | Portable round workspaces | Reopen the evidence, flows, and speech document for a particular round. | Named local tab/layout presets, with warnings for missing or moved notes. |

Start with recovery and evidence validation: both reduce the risk of losing or
misrepresenting evidence during existing workflows.

## Useful follow-ups

### Citation provenance and refresh

Record which fields came from page metadata, URL guesses, or manual entry.
Offer an explicit refresh that previews changes and preserves user edits.
Avoid implying that autofill verifies a source's truth or credibility.

### Duplicate and near-duplicate evidence detection

Use exact normalized-text hashes first, then optional local embedding similarity.
Group candidates with side-by-side previews; never merge or delete automatically.
Keep performance and model-loading costs visible.

### Structured extension settings and lifecycle events

Add typed, permission-reviewed settings and narrowly scoped events such as
active-note changes. Establish cancellation and resource limits before adding
more powerful extension UI or long-running commands.

### Domain-specific embedding evaluation

Evaluate debate-specific query/card retrieval against the existing MiniLM model
before changing the application's default. Keep dataset splitting, training,
evaluation, and model artifacts separate from Electron integration.
Measure Recall@k and MRR on held-out, source-grouped data to reduce evidence
leakage. Training and deployment remain separate design decisions.

### Accessible presentation mode

Offer a distraction-free speech view with adjustable highlight contrast, larger
type, and keyboard navigation between cards. Preserve source Markdown and retain
an obvious exit control.

## Design constraints worth preserving

- Vault content stays portable and readable without Tagline.
- Destructive changes require previews or a recovery route.
- Core offline workflows do not depend on paid APIs.
- Proposed APIs document permission and persistence semantics before exposure.
- New controls remain keyboard accessible and work in both light and dark themes.
- Benchmarks and user testing precede claims of better retrieval or timing.
