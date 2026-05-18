---
type: adr
title: WAL instead of rewriting the metadata snapshot on every mutation
created: 2026-05-18
updated: 2026-05-18
decision-date: 2026-05-18
status: accepted
tags: [adr, storage, performance]
---

# WAL instead of rewriting the metadata snapshot on every mutation

## Status
`accepted`

## Context

Before this decision, every metadata mutation (rename a file, toggle a tag, delete a folder) rewrote the entire `metadata.enc` snapshot:

```rust
metadata.files.retain(|f| f.id != id);
metadata::save(path, key, metadata)?;  // serialize whole MetadataDoc, encrypt, fsync, rename
```

That's a single write that's atomic and trivially correct — but the cost scales with **total vault size**, not with mutation size. Concrete numbers at realistic scales:

| Files in vault | metadata.enc size | Per-mutation cost |
|----------------|-------------------|--------------------|
| 1,000 | ~400 KB | ~3 ms (invisible) |
| 10,000 | ~4 MB | ~30 ms (perceptible on rapid edits) |
| 50,000 | ~20 MB | ~100-200 ms (UI hitches) |
| 100,000 | ~40 MB | ~300-500 ms (visibly laggy) |

Worse, the cost is per-mutation, so bulk operations multiply:
- Tag-toggle 50 selected files at 50k vault size: 50 × 150 ms = **7.5 seconds of locked UI** for a one-second user action.
- Delete 100 files: 100 × 150 ms = 15 seconds.
- Import 200 photos: 200 × 150 ms = 30 seconds of metadata churn (on top of the actual blob encrypt time).

The "rewrite everything" approach is simple and correct, but the wall clamped the practical vault size to a few thousand items.

The user asked: can we make the metadata writes cheap regardless of how big the vault gets, **without** introducing a database engine?

## Decision

Adopt a **write-ahead log + periodic snapshot** model, the same pattern every serious database engine uses internally (SQLite WAL mode, LSM trees, etc.).

Two files:
- `metadata.enc` — encrypted snapshot of the full `MetadataDoc`. Rewritten only at compaction time.
- `metadata.wal` — append-only log of `Mutation` records since the last snapshot.

Each mutation:
1. Apply to the in-memory `MetadataDoc`.
2. Append one encrypted `Mutation` record to `metadata.wal` (~150-400 bytes).
3. fsync.
4. Return.

Cost: ~3-5 ms regardless of vault size.

On unlock:
1. Load `metadata.enc` into RAM.
2. Replay every `Mutation` in `metadata.wal` on top.
3. Optionally compact in place if WAL > 5 MiB.

On lock:
1. Compact: rewrite `metadata.enc` from current in-memory state, truncate `metadata.wal`.

The two files are kept consistent by careful ordering:
- WAL append before in-memory apply, so WAL is durable before the user sees success.
- Compact writes new snapshot BEFORE truncating WAL, so crash between produces redundant-but-correct state (idempotent `Create*` mutations make replay safe).

## Consequences

- **Positive — single-mutation latency is now O(mutation size) instead of O(total metadata size).** ~3-5 ms regardless of whether you have 100 files or 100,000.
- **Positive — bulk operations are fast** because each one is a tiny WAL append. Delete 100 files in ~500 ms instead of 15 seconds.
- **Positive — recovery story is well-understood.** The WAL pattern is decades old. Partial tails from crashed appends are detected and trimmed; the snapshot is always a known-good consistent point.
- **Positive — zero external dependencies.** This is ~500 lines of Rust against existing primitives (`aes-gcm`, `serde_json`, `parking_lot`, std). No SQLite, no embedded KV store.
- **Negative — two files to keep coordinated instead of one.** Crash recovery now has cases like "snapshot written, WAL not yet truncated" that have to be reasoned through. Mitigated by idempotent `Create*` semantics.
- **Negative — every metadata write goes through two formats (serde_json for plaintext, AES-GCM for ciphertext) just like before, but now the JSON serialization is per-mutation rather than per-doc.** Still wildly faster overall.
- **Negative — adding a new field to a record type requires thinking about WAL replay compatibility.** Older WALs that don't have the new field need `#[serde(default)]` to deserialize. Manageable; no migrations have been needed yet.
- **Neutral — the in-RAM `MetadataDoc` model is unchanged.** `read_files`, `read_folders`, `read_tags` etc. all remain in-memory iterators. Search is microseconds.

## Alternatives considered

- **Keep rewriting `metadata.enc` on every mutation.** Rejected — that's the problem we're solving. Acceptable below ~5k files, unacceptable above ~20k.

- **Shard `metadata.enc` per folder.** Rejected — wins on per-folder operations but loses on every cross-cutting operation (global search, tag queries, "recent files"). The in-RAM model goes away because you'd have to load each shard on demand. Worse for the realistic workload of a media vault where most actions span folders.

- **Switch to SQLCipher (encrypted SQLite).** Rejected for now — adds a C dependency with a build-time crypto library link, a schema migration burden, and changes the in-memory model. The WAL achieves the same per-mutation latency win without any of that. SQLCipher remains the natural next step if the vault ever outgrows the "load everything into RAM" assumption (~100k+ items), but that's not the current scale.

- **CRDT-style operational log.** Rejected — overkill for a single-user app. CRDT shines for multi-device sync, which isn't on the roadmap.

- **Append-only log only, no snapshot.** Rejected — unlock cost would grow without bound. Replaying a log of millions of mutations on every unlock is exactly what the periodic snapshot prevents.

## References

- [[design/storage]] §3, §4, §5, §7 — full implementation reference
- [[decisions/0002-aad-binding-blob-v3]] — independent decision about the blob format used by the snapshot file
