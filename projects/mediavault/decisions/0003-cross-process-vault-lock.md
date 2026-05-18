---
type: adr
title: Cross-process vault locking via fs4 + vault.lock
created: 2026-05-18
updated: 2026-05-18
decision-date: 2026-05-18
status: accepted
tags: [adr, storage, concurrency]
---

# Cross-process vault locking via fs4 + vault.lock

## Status
`accepted`

## Context

`VaultState` uses a `parking_lot::Mutex` to serialize all access within a process. That's correct and necessary, but it only protects against intra-process races.

Two MediaVault instances pointing at the same vault folder (the user launches the app twice, or syncs a vault folder across two machines) would race on:

- **WAL appends**: both processes opening `metadata.wal` in append mode. Each individual write call is typically atomic if small (kernel buffers + atomic page write), but interleaved appends from two processes corrupt the WAL structure — length-prefixed records get spliced wrong. Replay would fail at the first interleaved record, and with my "refuse to truncate on first decryption failure" safety, the entire WAL would be flagged corrupt and unlock would fail.

- **Snapshot rewrites**: two `compact()` calls both writing `metadata.enc.tmp` then `rename`-ing. The second rename wins, but the loser's view of the doc never gets persisted. State silently diverges.

- **Blob writes**: less likely to collide because UUIDs are globally unique, but possible if both processes are mid-import of the same source file.

None of these are likely in normal use (most users run one instance). But sync-folder scenarios (Dropbox / iCloud / Syncthing) make it realistic: two devices, vault folder synced, user unlocks on both → tonight's mutations go to whichever device wins the last write.

Without protection, the failure modes range from "lose recent mutations" to "WAL becomes unreadable, requires manual recovery."

## Decision

Add a cross-process advisory file lock backed by the OS:

- A zero-byte file `<vault>/vault.lock` exists in every vault.
- `unlock` and `create` acquire an exclusive lock on this file via `fs4::FileExt::try_lock_exclusive()`.
- The lock is held by an `Option<std::fs::File>` field on `VaultInner` for the lifetime of the unlocked session.
- `lock()` drops the field → OS releases the lock.
- Process exit (clean, panic, or kill -9) drops the field → OS releases the lock.

`fs4` is the maintained successor to `fs2`. It maps to:
- `flock(2)` on Unix (Linux, macOS, BSD)
- `LockFileEx` with `LOCKFILE_EXCLUSIVE_LOCK` on Windows

We use **`try_lock_exclusive`** (non-blocking) rather than `lock_exclusive` (blocking) so a second instance fails immediately with `VaultError::AlreadyOpenElsewhere` rather than hanging the UI on a blocking wait.

**Timing of lock acquisition:**
- `create`: acquire BEFORE any destructive setup (after `create_dir_all`, before cleanup of stale files). Two concurrent creates can't both succeed.
- `unlock`: acquire AFTER password verification. Wrong-password attempts can't be used as a denial-of-service to lock out the legitimate user.

**Cleanup of `vault.lock` itself:** never deleted. It persists as a 0-byte marker file in every vault folder. `cleanup_tmp_files` only removes `*.tmp`, so vault.lock is never touched.

## Consequences

- **Positive — two MediaVault instances on the same vault folder no longer corrupt each other.** Second instance sees `VAULT_OPEN_ELSEWHERE` and can't proceed.

- **Positive — uses the OS's lock semantics, so it Just Works for the realistic cases.** Process killed → lock released. Power loss → lock released. No stale-lock-from-dead-process problem.

- **Positive — minimal code change.** ~30 lines including the helper, the new `lock_file` field, the integration with `create`/`unlock`/`lock`, and the error variant.

- **Negative — adds a dependency (`fs4`).** Small crate, well-maintained, used by many production projects. ~10 KLOC of Rust. Not a meaningful concern.

- **Negative — leaves a permanent `vault.lock` file in every vault.** Confusing if a user inspects the vault folder. Documented; not removable without a refactor (the file's existence is the lock token).

- **Negative — advisory locks on NFS / SMB / cloud-sync folders are unreliable.** flock semantics over NFS were historically broken; modern Linux kernels emulate via fcntl(F_SETLK) but the semantics aren't always sound. Cloud-sync providers don't typically tunnel file locks at all. **A vault on Dropbox/iCloud effectively has no cross-process protection** even though the lock acquisition would succeed locally. Not currently detected or warned about — known limitation.

- **Negative — within a single process, the lock is a no-op (fs4's per-process semantics on Unix).** Tests can't easily verify cross-process behavior. Trust + the `acquire_vault_lock_creates_lockfile_and_can_be_released` smoke test for the acquire/release plumbing.

## Alternatives considered

- **Tauri's `tauri-plugin-single-instance`.** Rejected — it prevents multiple instances of the whole app, even for different vaults. A user with two separate vaults (work + personal) can't have both open simultaneously. Too restrictive.

- **PID-file based "manual" lock.** Write the current process's PID to `vault.lock`. On open, check if a PID is there and if that process is still alive. Rejected — TOCTOU races (check then create isn't atomic), stale lock handling is brittle, doesn't survive PID reuse, doesn't free on power loss without manual cleanup.

- **Roll our own platform-specific code** with `#[cfg(unix)]` `nix::fcntl::flock` and `#[cfg(windows)]` `winapi::LockFileEx`. Rejected — that's what `fs4` already is, with cross-platform handling and testing. Vendoring it ourselves adds noise.

- **Don't lock at all.** Rejected — accept the race risk because "users don't usually do this." The user explicitly asked for this when they confirmed wanting #5 from the audit list. Risk is bounded but real.

- **Lock the entire vault.json file.** Same idea, but you can't open vault.json before reading it (which we do to parse the KDF params), and Windows LockFileEx on a file you're already reading is awkward. A dedicated `vault.lock` keeps the lock semantics independent of any "real" file's access pattern.

## References

- [[design/storage]] §10 — locking mechanics and limitations
- [[design/storage]] §3 — where `lock_file` fits in the VaultInner state machine
- `fs4` crate: https://crates.io/crates/fs4
