---
type: adr
title: Bucket blob storage by UUID prefix
created: 2026-05-20
updated: 2026-05-20
decision-date: 2026-05-20
status: accepted
tags: [adr, storage, filesystem, scale]
---

# Bucket blob storage by UUID prefix

## Status
`accepted`

## Context

Pre-this-change, every file blob and thumbnail blob lived directly under `<vault>/blobs/<uuid>.enc` and `<vault>/thumbs/<uuid>.enc`. Two flat directories, each potentially holding the entire vault's content.

At the design's stated scale (50k files, see [[design/storage]] §11.1), each flat directory holds ~50k entries. NTFS handles that fine at the filesystem layer — the bottleneck is Windows File Explorer, which becomes unusable (multi-second freeze on open, choppy scrolling, sometimes outright hang) once a directory crosses ~5–10k entries.

The user actually hits this. The flat layout was never documented as a deliberate metadata-hiding choice — it was simply the default. Whether the directory listing is browseable in Explorer matters in real cases: backup verification, recovery from a corrupted vault, manually-copying a vault between disks, eyeballing storage usage.

The user's first instinct was to mirror the app's folder structure on disk (`blobs/<folder-uuid>/<file-uuid>.enc`). Rejected — see Alternatives.

## Decision

Bucket blobs by the first two hex characters of the file's UUID:

```
<vault>/blobs/<aa>/<uuid>.enc
<vault>/thumbs/<aa>/<uuid>.enc
```

256 buckets, uniform distribution (UUIDv4 leading bytes are random), no name collisions. The metadata snapshot (`<vault>/metadata.enc`) uses the non-UUID id `"metadata"` and stays at the vault root — `blob_path` checks the id shape and only buckets canonical UUIDv4 strings.

**Why 2 hex chars (256 buckets):**

At the design's target of 50k files: ~195 files per bucket. Comfortable for Explorer. Holds up through ~500k files (~2000/bucket — Explorer still works). Empty bucket overhead is trivial (~1 MB MFT for 256 dirs, and buckets are created lazily — only buckets that have files exist on disk).

| Prefix chars | Buckets | Files/bucket @ 50k | @ 500k |
|---|---|---|---|
| 1 | 16 | 3,125 | 31k |
| **2 (chosen)** | **256** | **195** | **1,953** |
| 3 | 4,096 | 12 | 122 |
| 4 (2-level git-style) | 65,536 | <1 | 7 |

Three chars or two-level structure is over-engineering for personal-vault scale. If a future user crosses 1M files, the same migration mechanism can extend bucketing depth.

**Migration runs at unlock:**

Existing flat-layout vaults heal themselves the next time the user unlocks. `blobs::migrate_flat_to_bucketed(dir)` walks the top-level of `blobs/` and `thumbs/`, renames every UUID-named flat `.enc` into its bucket subdir. Idempotent (subdirs are skipped by the `is_dir()` guard), non-fatal on per-file failure, logs aggregate counts. Cost on local NTFS: a few seconds for 50k file renames (metadata-only operations on the same filesystem). First unlock pays once; every subsequent unlock finds nothing flat and returns immediately.

**Implementation surface:**

- `blobs.rs`: `is_uuid_id(id)` predicate, `blob_path(dir, id) -> PathBuf`, every read/write/delete/stream/size API and the v2→v3 `migrate_one_v2_blob` switched to use it. New `migrate_flat_to_bucketed` function. `migrate_v2_blobs_in_dir` walks both top-level (legacy) and one bucket-subdir deep so the v2→v3 migration finds blobs regardless of layout.
- `vault.rs`: `cleanup_tmp_files` extended to recurse one level into `blobs/` and `thumbs/` so bucket-local `.tmp` leftovers get swept. `unlock` calls `migrate_flat_to_bucketed` on both dirs after `cleanup_tmp_files`.
- No changes to vault.json, WAL format, blob format (v3 unchanged), or any IPC surface.

## Consequences

- **Positive — Explorer no longer freezes** opening `blobs/<aa>/` at any realistic vault size. Each leaf has ~195 files at 50k-file target, ~2k at 500k.
- **Positive — zero new metadata leakage.** Distribution is uniform-random by construction; a disk reader learns nothing about file→folder relationships, sibling files, or folder structure that they didn't already learn from the flat layout's file count + size distribution.
- **Positive — folder operations stay pure metadata.** Moving a file between UI folders is still a one-line `Mutation::RenameFile`-style change (well, conceptually — there's no MoveFile mutation yet, but if added, it wouldn't touch the disk blob). The blob's bucket is fixed by its UUID at import time.
- **Positive — migration is fast and idempotent.** Pure `fs::rename` on the same filesystem (metadata operations, no I/O). Partial migration is recoverable — re-running picks up where it left off.
- **Negative — adds a `.parent().expect(...)` chain in every blob op.** Trivial, but a new structural assumption: `blob_path` must always have a parent. Documented in the helper.
- **Negative — `cleanup_tmp_files` recursion adds one extra `read_dir` per `blobs/` and `thumbs/`** at unlock time. 256 readdirs is ~tens of ms on local disk; meaningful only on extremely slow storage.
- **Neutral — file names on disk are still UUIDs.** The "browseable Explorer" win is "each bucket opens fast", not "the user can read filenames". Recovery via Explorer requires the metadata snapshot to map UUIDs back to user-visible names — same as before.

## Alternatives considered

- **Mirror the app's folder structure on disk** (`blobs/<folder-uuid>/<file-uuid>.enc`). Rejected. **Leaks the folder tree** to anyone with FS access: file→folder mapping, file-counts-per-folder, tree depth, sibling relationships. Compared to the current threat model where a disk reader sees only the global file count + size distribution, this is a strict expansion. Also: moving a file between UI folders becomes a disk move (extra failure modes); deleting a folder cascade has to clean up nested subdirs. Net cost is higher, net benefit is illusory because filenames are still UUIDs in either layout — the user can't meaningfully browse the vault via Explorer either way.

- **3 hex chars / 4,096 buckets.** Rejected — diminishing returns. Most buckets empty at small vault sizes, ~16 MB of MFT overhead for empty dirs, no real win until the vault crosses 1M files. The same migration mechanism makes adding depth later trivial if needed.

- **Two-level git-style (`<aa>/<bb>/`).** Rejected for the same reason at higher magnitude — 65,536 dirs. Git uses this scheme because its object stores hold millions of objects; personal media vaults are 3-4 orders of magnitude smaller.

- **Time-based bucketing (`<YYYY-MM>/`).** Rejected. Uneven distribution (user binge-imports), bucket boundaries leak import timing (already implied by mtimes, but more directly), and a binge month can still produce a too-large bucket.

- **Defer — accept the Explorer freeze.** Rejected. The user actually hits it, and the fix is small and self-contained.

- **Custom pack format (one big container file holding many blobs).** Rejected. Major architectural change. The current blob format and AAD scheme work; bucketing keeps them intact.

## References

- [[design/storage]] §2.4 — on-disk layout of blob/thumb directories
- [[design/storage]] §6 — blob format (unchanged by this ADR)
- [[design/storage]] §14 — threat model (folder structure was not a deliberately-protected secret pre-this-change; this ADR confirms it stays unprotected by design choice for this layout)
- [[decisions/0001-wal-instead-of-rewriting-snapshot]] — the migration pattern (`Mutation::apply` idempotency) is the precedent for `migrate_flat_to_bucketed` being safely re-runnable
- [[decisions/0002-aad-binding-blob-v3]] — the v2→v3 migration's `migrate_one_v2_blob` got updated in the same change to use the bucket path
