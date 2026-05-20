# Log

Chronological, append-only record of vault operations. Entry format:

```
## [YYYY-MM-DD] <op> | <title>
<1-2 line note about what was done>
```

Where `<op>` is one of: `ingest`, `query`, `lint`, `schema`, `project`, `bootstrap`.

---

## [2026-05-13] bootstrap | Vault initialized
Created folder structure, wrote CLAUDE.md schema, README, index, log, note templates, and reference docs for Excalidraw and Obsidian CLI. Moved Karpathy LLM Wiki gist to meta/references/ as design inspiration. Git initialized; remote configured to git@github.com:velatrix/code-brain.git.


## [2026-05-13] schema | Obsidian CLI verified and reference doc populated
Verified v1.12.7 working; enabled Dataview, Templater, Excalidraw; installed obsidian-git v2.38.2. Populated [[meta/references/obsidian-cli]] with verified syntax, command groups, and patterns for ingest/query/lint. Always-pass `vault=CodeBrain` convention adopted (user has 3 vaults).

## [2026-05-13] wiki | VAppCore entity page + architecture diagram
Wrote [[wiki/vappcore]] from the VAppCore README (v2.2.0). Generated [[wiki/vappcore-architecture]] via meta/tools/render-excalidraw.js — first end-to-end test of the Node/Playwright renderer (using @excalidraw/utils, not @excalidraw/excalidraw@0.17.0 — that pin was wrong). Slimmed global CLAUDE.md VAppCore section: corrected outdated claims (net8.0 → net10.0, removed VDbContext inheritance which is gone since v1.1), reduced to trigger + key constraints + pointer to vault.

## [2026-05-15] schema | Slim CLAUDE.md; split to root files
CLAUDE.md 234→85 lines. Spun out [[structure]], [[notes]], [[operations]]. Added Hard Rules section, `:!<name>` operation prefix, "ask before vault writes" + "capture lessons from corrections" meta-rules. Removed frontmatter from root singletons; renamed AI-specific rules → Agent Rules. Deleted README.md.


## [2026-05-16] schema | Frontend theme ownership rule
Added a theme ownership section to [[guides/frontend-app-shell]]: `theme.ts` is the design-token source of truth; `main.css`, Tailwind `@theme`, component CSS, and duplicated constants must not define token values.
## [2026-05-16] schema | Naive theme var guidance
Clarified [[guides/frontend-app-shell]] theme ownership: custom Vue components should prefer Naive UI `useThemeVars()` for active theme values; project CSS vars are only for plain CSS/global CSS escape hatches.
## [2026-05-16] schema | CSS vars as escape hatch
Updated [[guides/frontend-app-shell]] theme ownership wording so project CSS variables are not the default theme path; they are a minimum, namespaced escape hatch for plain/global CSS only.

## [2026-05-18] project | MediaVault project bootstrapped + storage hardened
New project [[projects/mediavault/_moc|MediaVault]]. Rust storage layer overhauled in a single session: introduced WAL (snapshot + append-only mutation log) replacing rewrite-all-on-every-mutation; bumped blob format to v3 (AEAD-with-AAD binding header + chunk_idx) so chunk reordering / truncation / splicing attacks are caught; added cross-process file lock via `fs4`; full fsync discipline on every persistent write; streaming exports via `stream_blob` so multi-GB videos export with ~4 MiB peak RAM; v2→v3 migration command. 67 Rust tests passing. Comprehensive design doc at [[projects/mediavault/design/storage]], three ADRs in [[projects/mediavault/decisions/0001-wal-instead-of-rewriting-snapshot|0001]] / [[projects/mediavault/decisions/0002-aad-binding-blob-v3|0002]] / [[projects/mediavault/decisions/0003-cross-process-vault-lock|0003]].

## [2026-05-20] project | MediaVault blob storage bucketed by UUID prefix
Flat `blobs/` and `thumbs/` directories were locking Windows File Explorer at scale (~10k+ entries hangs the UI). Switched to `<dir>/<aa>/<uuid>.enc` where `aa` is the first two hex chars of the UUID — 256 buckets, uniform distribution, ~195 files/bucket at 50k-file target. Metadata snapshot stays flat at vault root (non-UUID id). Auto-migration via `blobs::migrate_flat_to_bucketed` runs at unlock; existing flat vaults heal themselves on first open. Tests: 67→82. Cargo check + tests both clean in dev and release. Pushed back on the user's first instinct (mirror app folder tree on disk) because it would leak folder-structure metadata without buying real browseability — see [[projects/mediavault/decisions/0004-bucketed-blob-layout]] for the analysis.

Also separately during this session: gated dev-only `eprintln!` instrumentation in lib.rs / blobs.rs / commands.rs behind a `dev_log!` macro that no-ops in release (via `if false { format_args!(...) }` so the compiler keeps args used and the optimizer DCEs the whole block) — release build is now zero-overhead and zero-warnings. Smart-unit helpers (`fmt_dur_us`, `fmt_bytes`) replaced the integer-truncated `0ms (0MB)` output with readable units.
