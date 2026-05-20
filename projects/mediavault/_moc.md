---
type: project
title: MediaVault
created: 2026-05-18
updated: 2026-05-21
status: active
tags: [project, encryption, tauri, rust, vue]
---

# MediaVault

## Goal
Personal encrypted media vault — a Tauri 2 desktop app that holds the user's photos, videos, and other media in an at-rest-encrypted folder on disk. Open with a password, browse / play / tag / organize, lock to clear the key from RAM. Backend in Rust, frontend in Vue 3 + Naive UI (see [[frontend-app-shell]] for the UI stack).

## Status
Stable. Storage layer hardened over a single multi-pass audit (2026-05-18) — WAL added, blob format upgraded to AEAD-with-AAD, full fsync discipline, cross-process file lock, streaming exports. Blob storage bucketed by UUID prefix (2026-05-20) to keep Windows File Explorer responsive at scale. Recycle-bin via soft delete (2026-05-20) — files + folders get `deleted_at`; trashed blobs stay on disk until a manual purge in the new Trash view. Tags/groups stay destructive (their bindings on files are preserved through a file's trash trip automatically). Frontend search shipped (2026-05-20) — quick search from the header + an advanced popover with per-tag-group filters, Pinia-only state that resets on lock. Sort + view-settings shipped (2026-05-20) — per-page NSelect (imported/name/mime/extension/size) + direction toggle + tile-size dropdown, all persisted in `useGalleryViewStore`; gear menu adds non-persistent Show Flat that recursively merges descendant files. `FileEntry` gained a stored, normalised `extension` field that the backend keeps in sync on import + rename. Name-uniqueness validation shipped (2026-05-20) — case-insensitive per-folder/parent/group/global rules enforced on every mutation that creates or renames; frontend `NameConflictDialog` (Replace / Skip / Keep Both + Apply to all + optional tag transfer) for import collisions, inline NFormItem errors in every rename/create modal. Image lightbox got wheel-zoom + drag-pan and dropped background-click-close (2026-05-20). Security audit pass (2026-05-21) — full canonical reference at [[design/security]]: CSP, KDF param floor + AAD-bound master-key wrap, WAL records position-bound via AAD, name validation + zip-export sanitization, UUID gate on `get_blob`/`get_thumbnail`, purge gating on `deleted_at`, generation counter that aborts streaming exports on lock, Windows-reserved-name + system-dir refusal on user paths, 8 GiB import cap, pre-unlock path-disclosure trimmed, `Zeroizing` for WAL/metadata plaintext. 190 Rust tests pass.

## Map
- Storage architecture (master reference): [[design/storage]]
- Security (threat model, audit posture): [[design/security]]
- Search architecture: [[design/search]]
- Gallery view settings (sort, tile size, show flat): [[design/view-settings]]
- Decisions:
  - [[decisions/0001-wal-instead-of-rewriting-snapshot]]
  - [[decisions/0002-aad-binding-blob-v3]]
  - [[decisions/0003-cross-process-vault-lock]]
  - [[decisions/0004-bucketed-blob-layout]]
  - [[decisions/0005-recycle-bin-soft-delete]]
  - [[decisions/0006-name-uniqueness]]

## Repository
`F:\Projects\MediaVault`
- `src/` — Vue 3 frontend (see [[frontend-app-shell]] guide)
- `src-tauri/src/` — Rust backend, the focus of [[design/storage]]

## Key entities & concepts
- [[design/storage|MetadataDoc]] — the in-memory representation of files, folders, tags, tag groups
- [[design/storage#mutation-reference|Mutation enum]] — every state change goes through this
- [[design/storage#blob-format-v3|Blob format v3]] — AEAD-with-AAD chunked encrypted file format
- [[design/storage#wal-format|metadata.wal]] — append-only mutation log

## Open questions
- v2 → v3 migration is exposed via the `migrate_legacy_blobs` Tauri command but not yet wired into a UI button.
- Password change / key rotation is unimplemented. Closing this also retires the legacy AAD-less master-key wrap fallback in `unlock` — see [[design/security#8-open-questions]].
- No mechanism to detect if a vault folder lives on a network share where advisory file locks aren't reliable.
- Restore-collision UX is a generic toast; an upgraded Rename / Cancel dialog would be friendlier.
- Disabling the WebView's native right-click menu is a one-line JS injection but not wired yet (the user wants it before shipping production builds).
- Frontend XSS local-exfiltration channel via `export_*` — CSP blocks remote exfil but a compromised renderer could still write decrypted blobs to disk. Tightening would require a dialog-plugin token instead of free-form target strings.

## Milestones
- [x] WAL replace rewrite-everything snapshot writes
- [x] Atomic update_tag (single mutation for combined name+color)
- [x] Full fsync discipline across all persistent writes
- [x] Cross-process file locking (`vault.lock` + fs4)
- [x] AAD-bound blob format (v3) — chunk reordering / header tampering caught
- [x] Streaming exports — peak RAM bounded at one chunk regardless of file size
- [x] v2 → v3 blob migration command
- [x] Blob storage bucketed by UUID prefix
- [x] Recycle bin (soft delete + per-item restore + manual purge)
- [x] Search (quick from header + advanced popover, per-tag-group filters, store-only state)
- [x] Sort + view settings (sortBy/sortDir + tile size persistent, Show Flat non-persistent)
- [x] Name uniqueness validation (per-folder/parent/group/global, case-insensitive, dialog + inline errors)
- [x] Image lightbox zoom + pan, background-click-close removed
- [x] Security audit pass — CSP, AAD-bound master-key wrap + KDF floor, WAL position binding, name validation + zip sanitization, UUID gate on blob/thumb IPC, purge gating, lock-time export invalidation, system-path refusal, import RAM cap, path-leak strip, pre-unlock disclosure trim, `Zeroizing` for WAL/metadata plaintext (60 new Rust tests, 190 total)
- [ ] Wire migration to a UI menu item
- [ ] Password change / key rotation
- [ ] Trash retention policy (auto-purge after N days) — deferred, see ADR-0005
- [ ] Disable native context menu (one-line JS or `tauri-plugin-prevent-default`)
- [ ] Network-filesystem detection + warning when vault folder is on NFS / SMB / cloud-sync (advisory lock unreliable)
