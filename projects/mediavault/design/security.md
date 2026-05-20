---
type: design
title: MediaVault Security
created: 2026-05-21
updated: 2026-05-21
status: stable
tags: [design, security, audit, encryption]
---

# MediaVault Security

Canonical reference for what the vault protects against, what it doesn't, and which mechanisms enforce each property. Written after the 2026-05-21 security audit consolidated and hardened the existing protections.

The encryption-at-rest core (Argon2id → AES-256-GCM → AEAD-with-AAD blobs + WAL) was already solid pre-audit. This pass closed gaps around the IPC trust boundary, path safety, integrity binding, and lock-time invalidation.

For implementation detail on the underlying storage, blob format, and WAL: see [[storage]]. For the decisions that shaped each format: ADRs [[../decisions/0001-wal-instead-of-rewriting-snapshot|0001]]–[[../decisions/0006-name-uniqueness|0006]].

---

## 1. Threat model

| Threat | Defended | Mechanism |
|--------|----------|-----------|
| Lost laptop / stolen drive | ✓ | Encryption at rest. Master key derived from password (Argon2id), wrapped under password-derived key. Without the password, nothing decrypts. |
| Cloud-backup leak | ✓ | Same as above — vault folder is self-encrypting. |
| Passive disclosure of blobs | ✓ | Per-chunk AES-256-GCM with random nonce. |
| Active write attack: blob header / chunk tampering | ✓ | v3 blob AAD = header ‖ chunk_idx. Any tamper fails decrypt. |
| Active write attack: WAL record reorder / drop / splice | ✓ | WAL record AAD = byte offset. Moving a record breaks decrypt. |
| Active write attack: KDF parameter downgrade in `vault.json` | ✓ | Master-key wrap AAD = KDF block (memory, iterations, parallelism, salt). Tamper breaks unwrap. Plus runtime floor (`KdfParams::validate_floor`). |
| Frontend XSS exfiltrates blobs via `mediavault://` URLs | ⚠ | CSP restricts `connect-src` to local IPC/scheme; `script-src` is `'self'` only (no `'unsafe-inline'` / `'unsafe-eval'`). Bounded but not zero — see §5. |
| Frontend XSS triggers `purge_*` to destroy live data | ✓ | `purge_file` / `purge_folder` refuse unless `deleted_at.is_some()` (`NotTrashed` error). |
| Path traversal via blob/thumbnail IDs | ✓ | `get_blob` / `get_thumbnail` UUID-validate before reaching `blob_path`'s flat fallback. Same gate on the `mediavault://` URI scheme handler. |
| Path traversal via attacker-controlled filenames in ZIP exports | ✓ | `validate_entity_name` rejects `/`, `\`, `..`, `.`, null, ASCII controls at the import/rename boundary. `sanitize_path_component` replaces them defensively at zip-write time for legacy doc state. |
| Lock-time decryption leakage | ✓ | `AtomicU64` generation counter bumped by `lock()`; long-running exports check it between chunks and abort. |
| Arbitrary file overwrite via `export_*` target | ✓ (partial) | `validate_user_path` rejects Windows reserved names and known system directory prefixes. Parent-must-exist check. Frontend dialog remains the trust anchor for the rest. |
| OOM via attacker-supplied path in import | ✓ | `MAX_IMPORT_BYTES = 8 GiB` enforced via stat before `fs::read`. |
| Filesystem-path leakage via IPC error messages | ✓ | Source paths logged via `dev_log!` (release no-op); IPC error strings are opaque. |
| Pre-unlock vault path disclosure | ✓ | `vault_status` returns folder leaf only while locked; full path returned only post-unlock. |
| Network filesystem lock unreliability | ✗ | Not detected. NFS / SMB / cloud-sync removes cross-process exclusion guarantee. Known limitation. |
| Memory snooping of live process | ✗ | Master key is `Zeroizing` while idle in `VaultInner`; WAL + metadata plaintext also `Zeroizing` during encrypt/decrypt. Debug-privileged process on the same host can still read. |
| Malicious frontend bundle | ✗ | Out of scope — frontend is part of MediaVault and trusted. |
| Side-channel attacks on AES / Argon2 | ✗ | Out of scope. |

---

## 2. Integrity binding scheme

Three independent AEAD bindings, each defending a different mutation surface against an attacker with filesystem write access but no key.

### 2.1 Blob format v3 (per chunk)

```
AAD = [16-byte header bytes] ‖ [chunk_idx as u64 LE]   // 24 bytes
```

Header tampering, chunk reordering, cross-blob splicing, and truncation-via-header-edit all fail decrypt. v2 (no AAD) still readable via legacy code path; `migrate_legacy_blobs` re-encrypts v2 → v3 on demand. Detail: [[storage#6-blob-format]].

### 2.2 WAL record format (per record, post-2026-05-21)

```
AAD = [offset as u64 LE]   // 8 bytes
```

`offset` is the byte position of the record's length prefix in the file. Moving a record to a different offset, or changing an earlier record's length prefix to point past a later valid record, fails decrypt. The reader's legacy fallback (decrypt without AAD on tag failure) supports replay of pre-2026-05-21 WAL records during the upgrade window — once `lock()` runs once and compaction folds those records into the snapshot, the WAL becomes pure new-format and the fallback goes dormant.

Implementation: `src-tauri/src/wal.rs` — `aad_for_record(offset)` helper, `append` queries file size before encrypting, `replay_into` reconstructs AAD per record.

### 2.3 Master-key wrap (in `vault.json`)

```
AAD = [memory_kib u32 LE] ‖ [iterations u32 LE] ‖ [parallelism u32 LE] ‖ [salt 16 B]   // 28 bytes
```

Tampering with any KDF parameter or the salt breaks the wrap. Combined with `KdfParams::validate_floor()` — which refuses to derive a key from `memory_kib < 64 MiB`, `iterations < 2`, or `parallelism ∉ [1, 64]` — an attacker who edits `vault.json` to weaken the KDF can no longer have the legitimate user "unlock" under those weakened parameters. The floor catches it before Argon2 runs; the AAD catches it on unwrap. Legacy vaults (empty-AAD wrap) still unlock via the same fallback pattern as the WAL.

Implementation: `src-tauri/src/vault.rs` — `master_key_aad(params, salt)` helper, `aead_encrypt_with_aad` / `aead_decrypt_with_aad` in `crypto.rs`.

---

## 3. IPC boundary hardening

### 3.1 Content Security Policy

`src-tauri/tauri.conf.json`:

- `default-src 'self' tauri: http://tauri.localhost`
- `img-src` / `media-src` allow blob, data, the `mediavault://` scheme on both platform variants
- `script-src 'self'` — no inline scripts, no `eval`
- `style-src 'self' 'unsafe-inline'` — Naive UI runtime CSS-in-JS requires it
- `connect-src` limited to IPC + dev HMR (`ws://localhost:1420`, `http://localhost:1420`); no external https origins
- `font-src 'self' data:`

The single biggest leverage gain. Pre-fix `csp: null` meant any frontend XSS could `fetch()` every blob URL and POST plaintext to an attacker domain. Post-fix, the most a successful XSS gets is the ability to call IPC commands the renderer was already allowed to call — and those are individually gated (§3.2–§3.4).

### 3.2 UUID gating on blob/thumb IDs

`get_blob`, `get_thumbnail`, and the `mediavault://` URI scheme handler all reject any ID that doesn't parse as a canonical UUIDv4 before reaching `blobs::blob_path`. Without the gate, the function's flat fallback (`dir.join(format!("{id}.enc"))`) would resolve `../../foo` to a path outside the vault.

`blobs::is_uuid_id` is the single source of truth. Used by `dispatch_mv` (always) and by `commands::get_blob` / `get_thumbnail` (added in audit).

### 3.3 Filename validation + sanitization

Two complementary guards at different layers:

**`metadata::validate_entity_name`** (vault layer, called before any mutation that creates or renames a file/folder): rejects `/`, `\`, `..`, `.`, null bytes, ASCII control characters, and empty/whitespace-only names. Refuses with `VaultError::InvalidName`. Applied in `import_file`, `rename_file`, `create_folder`, `rename_folder`, `restore_file`, `restore_folder`.

**`metadata::sanitize_path_component`** (export layer, called when writing zip entries): replaces the same dangerous characters with `_`. Defense in depth for legacy doc state — a pre-validation name in the doc would still export safely.

### 3.4 Trash gating

`purge_file` and `purge_folder` refuse with `VaultError::NotTrashed` unless `entry.deleted_at.is_some()`. The Trash view is the only UI surface that should reach these commands; a stale UI or hostile renderer can't destroy a live file via direct IPC.

### 3.5 Path safety on user-supplied paths

`commands::validate_user_path` is the gate for every command that accepts a free-form filesystem path (`open_existing_vault`, `prepare_new_vault`, `export_file`, `export_zip`). It rejects:

- Windows reserved device names anywhere in the path (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`), with or without extensions
- Paths inside known system directories: Windows (`C:\Windows`, `C:\Program Files`, `C:\Program Files (x86)`, `C:\ProgramData`), Unix (`/etc`, `/usr`, `/bin`, `/sbin`, `/lib`, `/boot`, `/sys`, `/proc`, `/System`, `/Library`)

Vault paths are canonicalized to absolute resolved form before persistence to `app_config.json` so symlinks can't be retargeted between sessions.

### 3.6 Resource limits

- `MAX_IMPORT_BYTES = 8 GiB` — `commands::read_import_source` stats before `fs::read`; OOM-via-huge-source path closed.
- Path-leak strip — `commands::import_files` and `open_existing_vault` no longer echo source paths in `VaultError::Io` strings; paths go to `dev_log!` (release no-op).

---

## 4. Lock-time invalidation

`VaultState` carries `generation: AtomicU64`. `lock()` bumps it as the final step. Long-running streaming operations (`export_file`, `export_zip`, `write_folder_to_zip`) capture the generation at start and check between chunks via a closure passed to `stream_blob`'s callback — when it changes, the next chunk write returns `io::Error::Interrupted("vault locked during export")` and the export aborts.

The cloned master key in the export's stack remains valid AES material, but the generation check is what stops it from being used after the user clicks Lock. Short-lived reads (`read_blob_range` for one Range request, capped at one 4 MiB chunk) complete with their cloned key — the leak window is bounded to ~10 ms of post-lock plaintext per active range request.

`Zeroizing` wraps:
- `master_key` in `VaultInner` (already)
- WAL plaintext: encrypt input + decrypt output (added)
- Metadata snapshot plaintext: serialize input + decrypt output (added)

So sensitive cleartext doesn't linger in the heap allocator after the relevant function returns.

---

## 5. What this design does NOT defend against

1. **A successful frontend XSS** — limited by CSP (§3.1) and per-command gates, but if the renderer is compromised it can still call any IPC the legitimate UI calls. The blobs it reads back are decrypted; CSP keeps them from being POSTed to an external origin, but a local exfiltration channel (e.g. writing to a known filesystem location via `export_*`) is harder to fully close.

2. **An attacker with the password** — out of scope by definition.

3. **An attacker who can execute code as the user** — memory snooping defeats `Zeroizing`. Outside MediaVault's threat model.

4. **Whole-blob deletion or whole-file truncation** — fails at read time as `IoError`, not silently. Observable, but not authenticated.

5. **`read_blob_size`'s unverified header `total`** — cosmetic only. Chunk-level AAD catches any actual decryption attempt; the inconsistency window is "Content-Length wrong while content auth-fails." Verifying would cost a chunk-0 decrypt per Range request (~5–10 ms) and was judged not worth the throughput hit. See [[storage#13-known-limitations]].

6. **Network filesystems** — `vault.lock` exclusion is unreliable on NFS / SMB / cloud-sync folders. Not detected or warned about.

---

## 6. Test coverage

Property-based safety tests live alongside their modules. 190 tests passing as of 2026-05-21 (up from 130 pre-audit). Highlights:

- `crypto::tests` (12) — KDF floor edge cases, AAD-bound encrypt/decrypt roundtrip, tamper detection, legacy compatibility.
- `blobs::tests` (3 new) — UUID gate accepts canonical / rejects path-traversal strings / accepts uppercase hex.
- `metadata::tests` (16 new) — `validate_entity_name` across empty, whitespace, `.`, `..`, `/`, `\`, null, control chars, unicode, high-ASCII; `sanitize_path_component` across separators, controls, only-dots, traversal strings, unicode preservation.
- `wal::tests` (4 new) — record swap detection, length-prefix tampering at offset 0 (Corrupt, not silent truncation), legacy no-AAD fallback, two identical mutations produce different ciphertext (AAD-distinct).
- `vault::tests` (16 new) — KDF floor enforcement at unlock, salt-tamper detection via master-key AAD, legacy no-AAD wrap fallback, round-trip after create, generation counter bumps on lock + stable across reads + per-instance, purge live-file rejection, purge folder cascade respects subtree boundary, restore→purge round trip, traversal-name rejection at every entry point.
- `commands::tests` (8 new) — `is_win_reserved_component` across device names + extensions + safe look-alikes, `looks_like_system_path` per-OS, `validate_user_path` composite gate.

Tests added in audit: ~60. None describe Vue component behavior — frontend tests were judged low-value for a solo-developer Tauri app and the vitest setup was reverted (see [[#7-decisions-not-taken]]).

---

## 7. Decisions not taken

- **Frontend test infrastructure**: vitest + @vue/test-utils + happy-dom briefly installed for store + component tests, then removed. The `useGalleryViewStore` per-vault namespacing logic is the only piece with meaningful branching; everything else (`NameConflictDialog` cancel-all wiring, `Lightbox` stale-file watcher) is testing Vue reactivity / Naive UI event routing more than MediaVault behavior. Cost (3 deps + config + brittle DOM selectors) > value for a solo-dev desktop app. Smoke-test in the running app is the verification path.

- **`read_blob_size` header verification**: would decrypt chunk 0 to validate `total`. Costs ~5–10 ms per Range request; protects only against cosmetic Content-Length inconsistency since chunk-level AAD already catches real tampering. Skipped.

- **WAL record AAD migration sweep**: legacy (empty-AAD) records replay correctly via fallback. A forced compact-on-upgrade would close the fallback window sooner but adds boot-path complexity. Deferred — the next normal `lock()` cycle handles it transparently.

- **Master-key wrap re-encryption for legacy vaults**: legacy AAD-less wraps still unlock via the fallback. A re-wrap pass during the next `create()` / password-change flow would close the legacy fallback for vault.json too. Worth doing alongside the password-change feature (open question in [[_moc]]).

---

## 8. Open questions

- Password change / key rotation — would re-derive password key, re-wrap master key under new AAD (current KDF block), invalidate old wrap. Currently unimplemented; closing this also retires the legacy-vault-wrap fallback path.
- Network-filesystem detection — flag vaults on NFS / SMB / cloud-sync folders so the user knows the cross-process lock is advisory only.
- Frontend XSS local-exfiltration channels — even with CSP locked down, a compromised renderer can still call `export_*` to write decrypted blobs to disk. Could be mitigated by requiring a dialog-plugin token instead of free-form target strings.

---

## 9. File-level reference for the audit

| File | What changed |
|------|--------------|
| `src-tauri/tauri.conf.json` | CSP from `null` to strict allowlist (§3.1) |
| `src-tauri/capabilities/default.json` | Removed unused `shell:default` capability |
| `src-tauri/src/crypto.rs` | `KdfParams::validate_floor`, `aead_*_with_aad` variants, tests |
| `src-tauri/src/vault.rs` | KDF floor + AAD wrap, generation counter, `validate_entity_name` plumbed into mutations, purge gating, `cleanup_tmp_files` tightened, pre-unlock path truncation |
| `src-tauri/src/wal.rs` | Offset-bound AAD + legacy fallback, `Zeroizing` plaintext, tests |
| `src-tauri/src/metadata.rs` | `validate_entity_name`, `sanitize_path_component`, `Zeroizing` plaintext in save/load, tests |
| `src-tauri/src/blobs.rs` | `is_uuid_id` exported, traversal-string tests |
| `src-tauri/src/commands.rs` | `is_uuid_id` gate on `get_blob`/`get_thumbnail`, `validate_user_path` (Windows reserved + system-dir), `read_import_source` with 8 GiB cap, path-leak strip from errors, canonicalize on `open_existing_vault` / `prepare_new_vault`, parent-exists checks on `export_*`, tests |
| `src-tauri/src/lib.rs` | `parse_range` overflow now `saturating_add` |
| `src-tauri/src/error.rs` | `NotTrashed`, `InvalidName` variants + codes |
| `src/lib/vaultUrl.ts` | (no change — URL-encoding was already in place) |
| `src/modules/vault/components/Lightbox.vue` | Zoom + pan, background-close removed (pre-audit) |
| `src/modules/vault/components/NameConflictDialog.vue` | `cancel-all` now on `@close` only, not `@update:show` |
| `src/modules/vault/stores/useGalleryViewStore.ts` | Per-vault localStorage namespacing, hydrate on unlock, reset on lock |
| `src/modules/vault/pages/GalleryPage.vue` | Lightbox-stale watcher, import-batch serialization, drag-probe `console.log`s removed |
| `src/modules/vault/pages/SearchPage.vue` | Lightbox-stale watcher |
| `src/modules/vault/pages/TrashPage.vue`, `TagsPage.vue`, `unlock/pages/Setup*.vue`, `unlock/components/SetupForm.vue`, `components/PropertiesSidebar.vue` | Em-dashes stripped from user-facing strings |
