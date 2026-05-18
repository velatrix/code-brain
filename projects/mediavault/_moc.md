---
type: project
title: MediaVault
created: 2026-05-18
updated: 2026-05-18
status: active
tags: [project, encryption, tauri, rust, vue]
---

# MediaVault

## Goal
Personal encrypted media vault — a Tauri 2 desktop app that holds the user's photos, videos, and other media in an at-rest-encrypted folder on disk. Open with a password, browse / play / tag / organize, lock to clear the key from RAM. Backend in Rust, frontend in Vue 3 + Naive UI (see [[frontend-app-shell]] for the UI stack).

## Status
Stable. Storage layer hardened over a single multi-pass audit (2026-05-18) — WAL added, blob format upgraded to AEAD-with-AAD, full fsync discipline, cross-process file lock, streaming exports. 67 Rust tests pass.

## Map
- Storage architecture (master reference): [[design/storage]]
- Decisions:
  - [[decisions/0001-wal-instead-of-rewriting-snapshot]]
  - [[decisions/0002-aad-binding-blob-v3]]
  - [[decisions/0003-cross-process-vault-lock]]

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
- Password change / key rotation is unimplemented.
- No mechanism to detect if a vault folder lives on a network share where advisory file locks aren't reliable.

## Milestones
- [x] WAL replace rewrite-everything snapshot writes
- [x] Atomic update_tag (single mutation for combined name+color)
- [x] Full fsync discipline across all persistent writes
- [x] Cross-process file locking (`vault.lock` + fs4)
- [x] AAD-bound blob format (v3) — chunk reordering / header tampering caught
- [x] Streaming exports — peak RAM bounded at one chunk regardless of file size
- [x] v2 → v3 blob migration command
- [ ] Wire migration to a UI menu item
- [ ] Password change / key rotation
