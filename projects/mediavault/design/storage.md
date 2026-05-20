---
type: design
title: MediaVault Storage Architecture
created: 2026-05-18
updated: 2026-05-18
status: stable
tags: [design, storage, encryption, wal, aead]
---

# MediaVault Storage Architecture

Comprehensive reference for everything the Rust backend writes to disk: vault metadata, the mutation log, file blobs, thumbnails, the cross-process lock file. Covers the on-disk byte layout of every format, the in-memory state machine, the lifecycle of every operation, all crash-recovery properties, and the threat model.

This is the document to read before changing anything in `src-tauri/src/{vault,metadata,wal,blobs,crypto,app_config}.rs`.

---

## 1. At a glance

The vault folder is a self-contained encrypted store. Everything in it is derivable from `vault.json` + the master password, except `vault.lock` which carries no state.

```
<vault folder>/
├── vault.json              # plaintext — KDF params + AEAD-wrapped master key
├── metadata.enc            # encrypted snapshot of the whole MetadataDoc
├── metadata.wal            # encrypted, append-only log of mutations since the snapshot
├── vault.lock              # 0-byte file used purely as an OS-level lock token
├── blobs/
│   └── <uuid>.enc          # per-file encrypted ciphertext, chunked, AEAD-with-AAD
└── thumbs/
    └── <uuid>.enc          # per-thumbnail encrypted ciphertext, same format
```

Two things make this design unusual relative to "just encrypt files and call it a day":

1. **Metadata is a single document with a WAL.** All file/folder/tag relationships live in one `MetadataDoc` struct. Mutations append to `metadata.wal`; the WAL is periodically folded into a fresh `metadata.enc` snapshot. This means a mutation costs ~3 ms of WAL append regardless of how many files the vault has, instead of rewriting an N-megabyte snapshot every time.

2. **Per-chunk AEAD with AAD covers the chunk's position in the file.** Each chunk's tag authenticates not just the ciphertext but also the file's header and the chunk's index. Attackers with filesystem write access can no longer truncate, reorder, or splice chunks undetected.

Everything below is the detail behind those two ideas, plus the supporting infrastructure (locking, fsync, .tmp cleanup, etc).

---

## 2. On-disk layout

### 2.1 `vault.json` — the entry point

The only plaintext file. Holds the parameters needed to derive the master key from the password.

```json
{
  "version": 1,
  "createdAt": 1747526400,
  "kdf": {
    "algorithm": "argon2id",
    "memoryKib": 262144,
    "iterations": 4,
    "parallelism": 4,
    "salt": "<16 bytes, base64>"
  },
  "masterKey": {
    "algorithm": "aes-256-gcm",
    "nonce": "<12 bytes, base64>",
    "ciphertext": "<48 bytes, base64 = 32-byte master key + 16-byte tag>"
  }
}
```

- **`kdf`** — Argon2id parameters (the defaults are tuned to ~2-3 s on a modern desktop with 256 MiB memory cost). These are persisted into the file so future code can bump defaults without breaking existing vaults.
- **`masterKey`** — a randomly-generated 32-byte AES-256 key, encrypted with the password-derived key.

When the user types their password:
1. Derive `password_key = Argon2id(password, salt, params)`.
2. AES-GCM decrypt `(nonce, ciphertext)` with `password_key`.
3. The 32-byte result is the master key. Held in `Zeroizing<[u8; 32]>` so it wipes from memory when dropped.

A wrong password produces an AEAD auth failure on step 2, surfaced as `VaultError::InvalidPassword`.

`vault.json` is written via the atomic temp+rename pattern: write to `vault.json.tmp`, `sync_data`, `rename`, fsync parent dir. Power loss can never leave a half-written `vault.json` at the canonical path.

### 2.2 `metadata.enc` — the snapshot

A single encrypted blob (same v3 chunked format as file blobs — see §6) whose plaintext is a `serde_json` serialization of the `MetadataDoc`:

```rust
pub struct MetadataDoc {
    pub version: u32,
    pub files: Vec<FileEntry>,
    pub folders: Vec<Folder>,
    pub tags: Vec<Tag>,
    pub tag_groups: Vec<TagGroup>,
}
```

Each record type:

```rust
pub struct FileEntry {
    pub id: String,                 // UUIDv4
    pub name: String,               // user-visible filename
    pub mime: String,               // e.g. "image/jpeg"
    pub size: u64,                  // plaintext bytes
    pub thumb_id: Option<String>,   // UUIDv4 of the thumb blob, or None
    pub imported_at: u64,           // unix seconds
    pub folder_id: Option<String>,  // UUIDv4 of containing folder, None = root
    pub tag_ids: Vec<String>,       // UUIDv4s; m:n on the file side
}

pub struct Folder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,  // None = root
}

pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub group_id: Option<String>,
}

pub struct TagGroup {
    pub id: String,
    pub name: String,
}
```

This is the entire relational model. The vault's only foreign-key-like structure: files reference folders, files reference tags, tags reference tag groups, folders reference parent folders. All in-memory `Vec`s, indexed by linear scan (fine at ≤ 10k items; see [[#11-performance-characteristics|§11]]).

### 2.3 `metadata.wal` — the write-ahead log

Append-only log of mutations since the last snapshot rewrite. Format documented in §5.

### 2.4 `blobs/<aa>/<uuid>.enc` and `thumbs/<aa>/<uuid>.enc`

Per-file encrypted blobs. Each filename is the UUID assigned at import time, with `.enc` suffix. The blob lives inside a bucket subdir whose name is the first two hex characters of the UUID — 256 buckets, uniform distribution, ~vault_size/256 files per leaf. Format documented in §6. Same format and same layout rules for files and thumbnails — only the parent directory (`blobs/` vs `thumbs/`) differs.

The metadata snapshot (`metadata.enc`) is the exception: it uses the non-UUID id `"metadata"` and stays at the vault root (see §2.2). The bucketing helper in `blobs.rs` checks the id shape and only buckets canonical UUIDv4 strings.

**Why bucketed:** at the design's 50k-file target, a flat `blobs/` directory holds 50k entries. NTFS handles that fine; Windows File Explorer does not — it freezes on open and scrolls choppily. Bucketing puts ~195 files per leaf at that scale, ~2000 at 500k files. Empty buckets aren't materialized — `create_dir_all` runs per write, only buckets that have files exist on disk.

**Migration from flat layout:** existing pre-bucketing vaults heal themselves at unlock via `blobs::migrate_flat_to_bucketed(dir)`. Pure `fs::rename` on the same filesystem, idempotent, non-fatal on per-file failure. See [[decisions/0004-bucketed-blob-layout]] for the trade-off analysis and migration design.

### 2.5 `vault.lock`

Zero-byte file. Exists only so we have something to hold an OS-level exclusive file lock on (see [[#10-cross-process-locking|§10]]). Created on first unlock/create, never deleted.

---

## 3. In-memory state machine

`VaultState` holds the entire mutable state behind a `parking_lot::Mutex`:

```rust
pub struct VaultState {
    inner: Mutex<VaultInner>,
}

struct VaultInner {
    path: Option<PathBuf>,             // vault folder; None = no vault selected
    master_key: Option<Zeroizing<[u8; 32]>>, // None when locked
    metadata: Option<MetadataDoc>,     // None when locked
    lock_file: Option<std::fs::File>,  // None when locked; holds the cross-process lock when Some
}
```

Three valid states:

| State | path | master_key | metadata | lock_file |
|-------|------|------------|----------|-----------|
| **Cold** (app just started, no vault chosen) | `None` | `None` | `None` | `None` |
| **Locked** (vault chosen, password not entered) | `Some` | `None` | `None` | `None` |
| **Unlocked** (master key derived) | `Some` | `Some` | `Some` | `Some` |

State transitions:

- `set_path(p)`: Cold → Locked (or Locked → Locked with a different path). Refuses if Unlocked — caller must lock first.
- `create(pw)`: Locked → Unlocked. Writes vault.json + fresh empty metadata.enc, acquires lock.
- `unlock(pw)`: Locked → Unlocked. Loads metadata.enc, replays WAL, acquires lock.
- `lock()`: Unlocked → Locked. Compacts WAL into snapshot, drops master key + lock file.

Invariants:
- `master_key.is_some() ⇔ metadata.is_some() ⇔ lock_file.is_some()` — all three are set/cleared together.
- If `path.is_none()`, none of the other three can be Some.
- The mutex is held during every state transition, so no observer can see a partial transition.

---

## 4. Lifecycle of every operation

### 4.1 `create(password)` — make a new vault

1. Acquire mutex.
2. Read `inner.path` (error `PathNotSet` if `None`).
3. Refuse if `<path>/vault.json` already exists (`AlreadyExists`).
4. `create_dir_all(&path)`.
5. **Acquire `vault.lock` exclusive lock** (error `AlreadyOpenElsewhere` if another process has it). This happens BEFORE any destructive setup, so two concurrent creates can't trample each other.
6. Best-effort cleanup of stale state from a previous vault that might have lived here:
   - `wal::truncate(&path)` — delete any leftover `metadata.wal`
   - Remove leftover `metadata.enc`
   - `cleanup_tmp_files(&path)` — delete `*.tmp` orphans
7. Generate random salt + master key. Run Argon2id on the password. AEAD-wrap the master key.
8. Build the `VaultFile` struct and write to `vault.json` via temp+rename+fsync.
9. Write a fresh empty `metadata.enc` snapshot. This means the very next unlock succeeds without needing a first-mutation+compact cycle, AND it overwrites any stale snapshot from a previous vault in the same folder.
10. Commit to `inner`: `master_key = Some(held)`, `metadata = Some(empty)`, `lock_file = Some(lock_file)`.

If any step after (5) fails, the local `lock_file` is dropped on stack unwind → OS releases the lock. `inner` was never updated, so the state stays Locked.

### 4.2 `unlock(password)` — open an existing vault

1. Acquire mutex.
2. Read `inner.path` (error `PathNotSet` if `None`).
3. Open `<path>/vault.json` (error `NotFound` if missing).
4. Parse + version-check the `VaultFile`.
5. Derive `password_key` via Argon2id with the file's stored params + salt.
6. AEAD-unwrap the master key. **Wrong password is caught here** — `aead_decrypt` returns `VaultError::Crypto`, which `unlock` maps to `VaultError::InvalidPassword`.
7. Verify the unwrapped key is exactly 32 bytes (defense against a corrupted `vault.json`).
8. **Acquire `vault.lock` exclusive lock.** Done AFTER password verification so wrong-password attempts can't lock out the real user.
9. `cleanup_tmp_files(&path)` — safe now because we hold the cross-process lock, no concurrent writer races us.
10. `metadata::load(&path, &held)` — decrypt `metadata.enc` to get the base snapshot.
11. `wal::replay_into(&path, &held, &mut metadata)` — apply each WAL entry on top to reach live state. Logs `[unlock] replayed N WAL entries onto snapshot` for non-zero N.
12. If `wal::size(&path) > COMPACT_THRESHOLD_BYTES` (5 MiB), proactively compact in place so the next unlock is fast. Failures here are logged but non-fatal (the WAL is durable).
13. Commit to `inner`: master_key, metadata, lock_file.

### 4.3 Mutation (every state-changing command)

Pattern shared by all 13 mutation methods on `VaultState`:

1. Acquire mutex.
2. Destructure `inner` to get `path`, `key`, `metadata` references.
3. **Precondition check** in memory (e.g. "file exists", "tag group exists"). Return `FileNotFound` if not.
4. (For mutations that produce blob side-effects: import, set_thumbnail) — write the blob to disk first via `write_blob`, which itself does temp+rename+sync_data+parent-dir-sync.
5. Build a `Mutation` enum value capturing the intent (e.g. `Mutation::RenameFile { id, new_name }`).
6. `wal::append(&path, &key, &mutation)` — encrypt + append + fsync. Either succeeds (record is durable) or returns Err (in-memory state untouched).
7. `mutation.apply(metadata)` — infallible in-memory mutation; returns an `ApplyOutcome` capturing cascade info (removed files, removed folder IDs, removed tag IDs).
8. For mutations with disk side-effects on cascade (delete_folder), use the outcome's `removed_files` to delete the matching blob + thumbnail files.
9. Return the appropriate response shape to the Tauri command layer.

Ordering matters:
- WAL append happens BEFORE in-memory apply. If WAL fails, in-memory state is unchanged (clean rollback by virtue of doing nothing).
- Apply happens AFTER WAL succeeds. Apply is infallible (pure pattern-matching + Vec mutation). The only way they can diverge is a panic, which would also poison the mutex — but apply has no panic paths.
- Blob deletion happens AFTER WAL+apply. If we crash after WAL but before blob delete, the blob is orphaned (recoverable disk space leak). If we crash before WAL, nothing changed.

### 4.4 `lock()` — clean shutdown

1. Acquire mutex.
2. If `wal::size(path) > 0`, run `compact(&path, &key, &metadata)`:
   - `metadata::save(&path, &key, &doc)` — rewrite snapshot with current in-memory state.
   - `wal::truncate(&path)` — delete the WAL file.
   - Failures are logged but don't block the lock (WAL stays durable; next unlock recovers).
3. `inner.master_key = None` (drops the `Zeroizing<[u8; 32]>`, wiping the bytes in memory).
4. `inner.metadata = None`.
5. `inner.lock_file = None` (drops the file handle, releasing the OS lock).

### 4.5 `set_path(new_path)` — point at a different vault

1. Acquire mutex.
2. Refuse if `master_key.is_some()` (`PathChangeWhileUnlocked` — caller must lock first).
3. Persist the new path to `app_config.json` FIRST (atomic temp+rename+fsync). If save fails, in-memory state is unchanged and the caller's error matches reality.
4. Update `inner.path` and clear `inner.metadata`.
5. Return a `VaultStatusSnapshot` (built inline to avoid a self-locking re-acquire of the mutex).

---

## 5. WAL format

### 5.1 On-disk byte layout

```
metadata.wal = entry*

entry = [u32 LE: payload_len]              4 bytes
        [12 B nonce]                       12 bytes
        [ciphertext + 16 B GCM tag]        payload_len bytes
```

The length prefix excludes the nonce — it covers exactly the AEAD output. A reader can skip a record without decrypting it.

The plaintext inside the AEAD is `serde_json::to_vec(&mutation)`, where `mutation` is a single variant of the `Mutation` enum (see §7).

### 5.2 Write path — `wal::append`

```
1. serde_json::to_vec(&mutation) → plaintext bytes (~100-400 bytes typically)
2. Generate random 12-byte nonce
3. AES-256-GCM encrypt(nonce, plaintext) → ciphertext (= plaintext + 16-byte tag)
4. Build a single record buffer: [len_le, nonce, ciphertext]
5. OpenOptions::new().create(true).append(true).open(path/metadata.wal)
6. f.write_all(&record)              — one syscall, keeps partial-write window tiny
7. f.sync_data()                     — bytes durable before we return
8. drop(f)                           — close
9. fs::File::open(parent).sync_all() — parent dir entry durable too (best-effort)
```

Each step is bounded. Total append cost: ~2-5 ms on NVMe, mostly fsync. Independent of the vault's total size — this is the whole point of the WAL.

### 5.3 Read path — `wal::replay_into`

Called once at unlock time after loading the snapshot. Decrypts every record in order, applies each `Mutation` to the in-memory doc, and tolerates trailing partial records from a crash:

```
1. If metadata.wal doesn't exist → return 0 (no replay needed)
2. fs::read(metadata.wal) → bytes into RAM
3. cipher = Aes256Gcm::new(key)
4. offset = 0, valid_end = 0, applied = 0
5. while offset < bytes.len():
   a. If offset + 4 > bytes.len(): break (partial length prefix at EOF)
   b. payload_len = u32 from bytes[offset..offset+4]
   c. entry_end = offset + 4 + 12 + payload_len
   d. If entry_end > bytes.len(): break (claimed payload extends past EOF)
   e. nonce = bytes[offset+4..offset+16]
   f. ct = bytes[offset+16..entry_end]
   g. plaintext = cipher.decrypt(nonce, ct)
      - On error: see "decrypt failure handling" below
   h. mutation = serde_json::from_slice(&plaintext)
      - On error: see same
   i. mutation.apply(&mut doc) (outcome discarded — replay doesn't need cascade info)
   j. applied += 1; offset = entry_end; valid_end = entry_end
6. If valid_end < bytes.len(): truncate the file to valid_end (drop trailing garbage)
7. Return applied
```

### 5.4 Decrypt failure handling — the crash-vs-corruption distinction

`replay_into` distinguishes two failure modes:

- **Failure with `applied == 0`** (first record fails to decrypt or parse): refuse and return `VaultError::Corrupt`. This is either bit-rot, wrong key (shouldn't reach replay because the snapshot already decrypted with this key), or whole-file corruption. Silently truncating would destroy data; we'd rather have the user see an error and investigate.

- **Failure with `applied > 0`** (records succeeded then one failed): treat as a partial tail from a crashed `append` — break the loop, truncate the file to the last good boundary. Earlier records are durable and applied; the last record was mid-write when the process died.

This isn't theoretical — without it, an attacker (or transient bug) that produces invalid bytes at the start of the WAL could silently nuke the user's recent mutations.

### 5.5 Truncation — `wal::truncate`

`fs::remove_file(metadata.wal)` (no-op if missing). Called at the end of `compact()`. Not followed by a parent-dir fsync: even if the deletion isn't durable, the next unlock will re-apply the already-snapshotted WAL entries, and `Create*` mutations are idempotent (see §7), so the state is correct either way.

### 5.6 Sizes & costs

| Operation | Cost |
|-----------|------|
| Single mutation (`append`) | ~2-5 ms — small write + fsync × 2 (file, parent dir) |
| Replay 1 entry | ~µs — decrypt + JSON parse + Vec mutation |
| Replay 10k entries | ~30 ms |
| Compact threshold | WAL > 5 MiB (after replay), triggers async compact at end of unlock |

---

## 6. Blob format

### 6.1 Three versions, one read path

`read_blob` / `read_blob_range` / `stream_blob` detect the format by the first 4 bytes:

| Magic | Name | Where written | AAD scheme | Status |
|-------|------|---------------|------------|--------|
| `MV2\0` | **v3** | New writes (this code) | AAD = header(16) ‖ chunk_idx_le(8) | Current |
| `MV1\0` | v2 | Previous code (no AAD) | Empty | Read-only; migration available |
| (no magic) | Legacy | Very old code | (Single AEAD, not chunked) | Read-only |

```rust
enum BlobFormat { V3, V2 }
impl BlobFormat {
    fn detect(header: &[u8]) -> Option<Self> {
        // Some(V3) if MV2, Some(V2) if MV1, None otherwise
    }
}
```

### 6.2 v3 byte layout

```
[magic "MV2\0"]               4 bytes
[chunk_size, u32 LE]          4 bytes
[plaintext_size, u64 LE]      8 bytes  ← total 16 B header
for each chunk:
   [nonce]                    12 bytes
   [ciphertext]               chunk_size bytes (last chunk may be smaller)
   [auth tag]                 16 bytes
```

CHUNK_SIZE constant: 4 MiB. Each chunk has its own random nonce.

### 6.3 v3 AAD

Each chunk's AEAD authenticates a 24-byte AAD constructed at encrypt time and reconstructed at decrypt time:

```rust
fn aad_for_chunk(header: &[u8; HEADER_SIZE], chunk_idx: u64) -> [u8; 24] {
    let mut aad = [0u8; 24];
    aad[..16].copy_from_slice(header);
    aad[16..].copy_from_slice(&chunk_idx.to_le_bytes());
    aad
}
```

This makes the following attacks observable as auth failures (assuming attacker has filesystem write access but no key):

- **Header tampering** — flipping any of the 16 header bytes changes the AAD for every chunk. All chunks fail to decrypt.
- **Chunk reordering** — moving chunk #2 to position #0 means we'd reconstruct AAD with `chunk_idx = 0` and decrypt the bytes that were encrypted with `chunk_idx = 2`. AAD mismatch → fail.
- **Cross-blob splicing** — chunks from a different blob have different header bytes baked into their AAD. Mismatch → fail.
- **Truncation via `total` modification** — same as header tampering: any header byte change breaks all chunks.

What's still allowed:
- **Whole-file deletion** — if attacker deletes the blob, reads fail with `IoError`. There's no auth on existence.
- **Whole-file truncation** — if attacker truncates the on-disk file without touching the header (header still claims big `total`), reads at the missing chunks fail with `IoError` on `read_exact`. Detectable, just as a read error rather than an auth error.

### 6.4 v2 byte layout

Identical to v3 except:
- Magic is `MV1\0`.
- AAD is empty in each chunk's AEAD.

v2 blobs are still readable for backward compat but are vulnerable to the attacks above. Migration is available — see §9.

### 6.5 Legacy single-AEAD layout

For very old blobs from before chunked format existed:

```
[12 B nonce][ciphertext][16 B GCM tag]
```

The entire plaintext is one AEAD blob with no chunking and no header. Reads load the whole file, decrypt it as one ciphertext. No streaming. Still safe for confidentiality (AEAD covers everything) but no benefit from chunked random access.

### 6.6 Atomic write — `write_blob`

```
1. fs::create_dir_all(dir)
2. final_path = dir/<id>.enc
3. tmp_path   = dir/<id>.enc.tmp
4. cipher = Aes256Gcm::new(key)
5. Build header [MAGIC, chunk_size, total]
6. f = File::create(tmp_path)
7. f.write_all(&header)
8. For each chunk of plaintext:
   a. Fresh random nonce
   b. aad = aad_for_chunk(&header, chunk_idx)
   c. encrypt_in_place_detached(nonce, &aad, &mut chunk_buf) → tag
   d. f.write_all(&nonce); f.write_all(&chunk_buf); f.write_all(&tag)
9. f.sync_data()                      — bytes durable
10. drop(f)
11. fs::rename(tmp_path, final_path)  — atomic commit
12. fs::File::open(dir).sync_all()    — dir entry durable (best-effort)
```

The cipher length is validated to fit in u32 before casting (defense against an impossible-in-practice 4 GB single mutation).

### 6.7 Reading — three APIs

| API | Returns | Memory peak | Use for |
|-----|---------|-------------|---------|
| `read_blob` | `Vec<u8>` (full plaintext) | 2× file size (ct + pt loaded) | Internal: snapshot decrypt, small file reads via `get_blob` |
| `read_blob_range(start, end_inclusive)` | `(Vec<u8>, total)` | 4 MiB working + range size | URI scheme handler (range requests from `<video>`/`<img>`) |
| `stream_blob(callback)` | `Result<(), VaultError>` | **4 MiB peak**, regardless of file size | Exports — `export_file`, `export_zip`, `write_folder_to_zip` |

`stream_blob` is the streaming-aware API. Its signature:

```rust
pub fn stream_blob<F>(
    dir: &Path, id: &str, key: &[u8; 32], mut on_chunk: F,
) -> Result<(), VaultError>
where F: FnMut(&[u8]) -> std::io::Result<()>
```

The callback is invoked once per chunk with the chunk's plaintext slice. The slice is owned by `stream_blob` and only valid for the duration of the call — the next iteration overwrites the buffer. `io::Error` from the callback converts via `?` to `VaultError::Io`.

### 6.8 Size — `read_blob_size`

Reads just the 16-byte header (or the first 28 bytes for legacy blobs) to compute the plaintext size without decrypting any content. Used by the URI scheme handler to set `Content-Length` and `Content-Range` headers without paying for decryption.

NOTE: `read_blob_size` returns the *claimed* `total` from the header without verifying it. The actual decrypt (on any subsequent `read_blob_range`) will fail if the header was tampered with — bounded but inconsistent. See [[#13-known-limitations|known limitations]].

### 6.9 Defensive guards

- `chunk_size == 0` in a header → immediate `VaultError::Corrupt`. Without this, `start / chunk_size` panics (divide by zero) and `decrypt_chunked_full` infinite-loops (`remaining -= remaining.min(0) = 0`).

---

## 7. Mutation reference

Every state change to the metadata goes through one of these. Each variant is what gets serialized into the WAL.

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Mutation {
    CreateFile(FileEntry),
    SetThumbnail   { file_id: String, thumb_id: String },
    RenameFile     { id: String, new_name: String },
    DeleteFile     { id: String },

    CreateFolder(Folder),
    RenameFolder   { id: String, new_name: String },
    DeleteFolder   { id: String },                          // cascades

    CreateTagGroup(TagGroup),
    RenameTagGroup { id: String, new_name: String },
    DeleteTagGroup { id: String },                          // cascades

    CreateTag(Tag),
    UpdateTag      { id: String, new_name: Option<String>, color_change: ColorChange },
    DeleteTag      { id: String },                          // scrubs from files
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum ColorChange {
    Unchanged,
    Set { value: String },
    Clear,
}
```

### 7.1 `Mutation::apply` — the single source of truth

Both the live mutation path AND the WAL replay path call this same function. Guarantees: live and replay reach the same state given the same sequence of mutations.

```rust
pub fn apply(&self, doc: &mut MetadataDoc) -> ApplyOutcome
```

`ApplyOutcome` captures cascade info that callers need:

```rust
pub struct ApplyOutcome {
    pub removed_files: Vec<FileEntry>,    // for blob cleanup
    pub removed_folder_ids: Vec<String>,
    pub removed_tag_ids: Vec<String>,
}
```

### 7.2 Per-variant behavior

| Variant | What it does | Cascade |
|---------|--------------|---------|
| `CreateFile(entry)` | Push to `doc.files` IF id doesn't already exist (idempotent) | — |
| `SetThumbnail { file_id, thumb_id }` | Set `file.thumb_id = Some(thumb_id)`, no-op if file missing | — |
| `RenameFile { id, new_name }` | Update name, no-op if file missing | — |
| `DeleteFile { id }` | Remove from `doc.files`, returns removed FileEntry in outcome | — |
| `CreateFolder(folder)` | Push IF id doesn't exist (idempotent) | — |
| `RenameFolder { id, new_name }` | Update name, no-op if folder missing | — |
| `DeleteFolder { id }` | BFS the folder subtree, remove all descendant folders and every file whose `folder_id` falls in the subtree. Returns full `(folder_ids, removed_files)` in outcome | **Folders + files** |
| `CreateTagGroup(group)` | Push IF id doesn't exist (idempotent) | — |
| `RenameTagGroup { id, new_name }` | Update name, no-op if group missing | — |
| `DeleteTagGroup { id }` | Remove group; remove every tag whose `group_id` matches; scrub those tag ids from every file's `tag_ids`. Returns removed tag ids in outcome | **Tags + file tag_ids** |
| `CreateTag(tag)` | Push IF id doesn't exist (idempotent) | — |
| `UpdateTag { id, new_name, color_change }` | If `new_name`, set name; match on `color_change` (Unchanged/Set/Clear). No-op if tag missing | — |
| `DeleteTag { id }` | Remove tag; scrub from every file's `tag_ids` | **File tag_ids** |

### 7.3 Idempotency contract for Create*

All four `Create*` variants check `!iter().any(|x| x.id == new.id)` before pushing. This matters for **crashed compactions**:

```
Time t1: User does some mutations, WAL grows.
Time t2: Compact starts.
Time t3: metadata::save writes new snapshot successfully.
Time t4: ⚡ Power loss before wal::truncate.

Next unlock:
- Load new snapshot (already has all mutations applied).
- Replay WAL (still has all the same mutations on disk).
- Each Create* is a no-op (id already in doc).
- Each Rename/Update reapplies same change (already idempotent).
- Each Delete reapplies (target already gone — no-op).
- State is correct.
```

Without idempotent Creates, the same scenario would produce duplicate file/folder/tag entries.

### 7.4 Folder cycle protection

`DeleteFolder`'s BFS uses a `HashSet<String>` visited tracker. Without it, a corrupted state where `A.parent_id = B` AND `B.parent_id = A` would loop forever, hanging the app. The visited set guarantees termination on any graph, valid or corrupted.

### 7.5 `update_tag` atomicity

`update_tag` builds a single `UpdateTag` mutation that carries both potential changes (name + color). Pre-fix, it emitted two separate mutations and could partially succeed if disk error hit between them. Now it's one WAL record — either both apply or neither does.

---

## 8. Live mutation flow (worked example)

End-to-end trace of what happens when the user renames a file from the frontend:

1. **Frontend**: Vue component calls `invoke('rename_file', { id, name })`.
2. **Tauri IPC**: Routes to `commands::rename_file`. Sync command — runs on the blocking pool.
3. **`VaultState::rename_file`**:
   - Acquires mutex.
   - Destructures `inner` → `path`, `key`, `metadata`.
   - Precondition: `metadata.files.iter().any(|f| f.id == id)` — returns `FileNotFound` if not.
   - Builds `Mutation::RenameFile { id: id.to_string(), new_name }`.
   - `wal::append(path, key, &mutation)` — encrypts the mutation as a ~150-byte record, appends to `metadata.wal`, `sync_data` on file, `sync_all` on parent dir.
   - `mutation.apply(metadata)` — finds the FileEntry, sets `name = new_name`.
   - Reads the updated FileEntry back and returns its clone.
4. **`commands::rename_file`** maps `VaultResult` → `AppResult` and returns.
5. **Frontend** receives the updated FileEntry, updates its Pinia store.

Latency budget on NVMe:
- Mutex acquire: ~µs
- Precondition check: ~µs (small in-memory iteration)
- `wal::append`: ~3-5 ms (the only meaningful cost)
- `apply`: ~µs
- Total: ~5 ms — **independent of vault size**

Compare to the pre-WAL design: every mutation rewrote the entire `metadata.enc`. At 50k files (~18 MB metadata), each mutation took ~150 ms. At 10k files, ~30 ms. The WAL flattens this to ~5 ms regardless.

---

## 9. v2 → v3 migration

The v2 → v3 difference is purely the AAD scheme — both formats have the same magic-headered chunked layout, but v2 chunks use empty AAD while v3 chunks bind the header + chunk_idx.

### 9.1 `migrate_v2_blobs_in_dir`

Public function in `blobs.rs`. Scans a directory for `.enc` files, identifies v2 by the `MV1\0` magic, re-encrypts each in place as v3:

```rust
pub fn migrate_v2_blobs_in_dir(dir: &Path, key: &[u8; 32])
    -> Result<MigrateStats, VaultError>

pub struct MigrateStats {
    pub migrated: u64,
    pub failed: u64,
    pub remaining: u64,
}
```

Per-blob migration (`migrate_one_v2_blob`) is streaming — reads one chunk at a time, decrypts under v2 (empty AAD), re-encrypts under v3 with a **fresh random nonce** and the v3 AAD (header || chunk_idx), writes to a `.migrating.tmp` file. After all chunks, atomic rename swaps the v2 file with the v3 file.

Peak per-blob RAM: one chunk (~4 MiB) regardless of file size. A 10 GB video migrates without ever holding the full plaintext in memory.

### 9.2 Why fresh nonces

AES-GCM security requires that no `(key, nonce)` pair encrypt different plaintexts. Reusing the v2 nonce with the same key but different AAD would produce identical ciphertext bytes (same keystream) — safe for THIS specific re-encrypt where the plaintext is also identical, but a sharp edge. Generating fresh nonces avoids any chance of accidental nonce reuse across blobs.

### 9.3 Safety under concurrent access

The migration uses the same temp+rename atomicity as every other write. Readers see the v2 blob until the rename completes; after, they see v3. No torn state is ever exposed. The vault mutex is NOT held during the long migrate operation (the function takes `(dir, key)` not `&self`), so other commands can run concurrently — but the cross-process file lock IS held by the caller, preventing two app instances from migrating the same vault simultaneously.

### 9.4 Crash recovery

Mid-migration crash leaves a `.migrating.tmp` orphan. The v2 source is intact. On next unlock, `cleanup_tmp_files` removes the orphan, and the migration can be retried — the v2 blob is still there to re-migrate.

### 9.5 Exposed as a Tauri command

```rust
#[tauri::command]
pub async fn migrate_legacy_blobs(state) -> AppResult<MigrateStats>
```

Runs in `spawn_blocking`. Frontend can wire it to a "Upgrade vault security" menu item; not yet done.

---

## 10. Cross-process locking

### 10.1 The problem

Without locking, two MediaVault instances pointing at the same vault folder would race on:
- WAL writes (both append, file gets interleaved garbage)
- Snapshot rewrites (compact races compact)
- Blob writes (rare since UUIDs are unique, but still)

### 10.2 The mechanism

A zero-byte file `<vault>/vault.lock` exists purely to hold an OS-level exclusive file lock. The `fs4` crate provides cross-platform `try_lock_exclusive` — `flock(2)` on Unix, `LockFileEx` on Windows.

```rust
fn acquire_vault_lock(vault_path: &Path) -> VaultResult<std::fs::File> {
    use fs4::fs_std::FileExt;
    let file = OpenOptions::new().read(true).write(true).create(true)
        .open(vault_path.join(VAULT_LOCK))?;
    file.try_lock_exclusive()
        .map_err(|_| VaultError::AlreadyOpenElsewhere)?;
    Ok(file)
}
```

The lock is held for as long as the `File` is alive. The OS releases it automatically on:
- Explicit `drop(file)` (via `lock()` setting `inner.lock_file = None`)
- Process exit (clean or not)
- Process killed (SIGKILL / Task Manager / power loss)

`try_lock_exclusive` is non-blocking — if another process has the lock, we surface `VaultError::AlreadyOpenElsewhere` immediately rather than hanging the UI on a blocking lock attempt.

### 10.3 When acquired

- **`unlock`**: AFTER password verification. Wrong-password attempts can't lock out the real user.
- **`create`**: BEFORE any destructive setup. Two concurrent creates can't both succeed and trample each other's vault.json.

### 10.4 When released

- **`lock()`**: `inner.lock_file = None`.
- **Crash / kill**: OS releases automatically.

### 10.5 Limitations

- **Network filesystems**: advisory locks via `flock` on NFS and similar are unreliable. Putting a vault on a Dropbox / iCloud / network share folder removes the cross-process guarantee. Not currently detected or warned about.
- **Single process**: within one app process, the mutex (not the file lock) is what serializes. The file lock is purely cross-process. Two `VaultState` instances within the same process would NOT block each other via fs4 — but we only ever have one per Tauri app.

---

## 11. Performance characteristics

### 11.1 Storage size

| Component | Per-item | Practical totals |
|-----------|----------|------------------|
| `FileEntry` in JSON | ~350-400 bytes | 50k files ≈ 18-20 MB metadata.enc |
| `Folder` in JSON | ~100-150 bytes | 1k folders ≈ 100-150 KB |
| `Tag` / `TagGroup` | ~60-100 bytes each | typically negligible |
| WAL record overhead | 32 bytes (4 len + 12 nonce + 16 tag) + JSON payload | ~150-400 bytes per mutation |

### 11.2 Operation latency (NVMe + AES-NI hardware)

| Operation | Cost | Notes |
|-----------|------|-------|
| Unlock (password derivation) | ~2-3 s | Argon2id with 256 MiB / 4 iter / 4 par |
| Unlock (snapshot load + WAL replay) | ~50-200 ms | Dominated by snapshot decrypt; ~5 ms per 1000 WAL entries replayed |
| Single mutation | ~3-5 ms | WAL append + 2 fsyncs (file + dir) |
| Lock (with compact) | ~50-150 ms at 10k files | Snapshot rewrite + WAL truncate |
| `read_blob_range` per 4 MiB chunk | ~10-15 ms | Decrypt-bound on AES-NI |
| Export 1 GB via `stream_blob` | ~5-10 s | I/O + decrypt bound; constant ~4 MiB RAM |

### 11.3 Memory peak

- **Idle unlocked**: in-memory `MetadataDoc` (~20 MB at 50k files) + 32-byte master key + a few KB of incidentals.
- **During import of one big file**: file size in RAM (read into Vec<u8>) + file size for the encrypted output buffer (chunked inside write_blob). For a 5 GB video, peak is ~5-10 GB. **This is unfixed; import doesn't stream.** Consider it the next streaming refactor target if it bites.
- **During export of one big file**: ~4 MiB. Streaming via `stream_blob`.
- **During WAL replay**: full WAL file in RAM (`fs::read`). Bounded by compaction at 5 MiB.

### 11.4 Mutex contention

The vault mutex is held during:
- All mutation methods (mostly the WAL append, ~3-5 ms each)
- `unlock` (long — through password derivation + replay)
- `lock` (compact + zeroize)
- `set_path` (config save)
- The path+key snapshot inside read methods (microseconds, then released)

It's NOT held during:
- The actual disk read + decryption in `read_blob`/`read_blob_range`/`stream_blob` (released after `snapshot_path_and_key`)
- The blob writes in `import_file` (mostly — write_blob itself doesn't hold the vault mutex)
- The whole `export_zip` body (snapshots state up front, releases lock, then iterates)

This means concurrent media playback (multiple `<video>` tags via the URI scheme handler) decrypts chunks in parallel, and a long export doesn't freeze the rest of the app.

---

## 12. Crash-recovery property matrix

Where can the process die, and what's the worst that happens?

| Crash point | Persistent state | Recoverable? |
|-------------|------------------|--------------|
| During `wal::append` write_all but before sync_data | Possibly partial bytes in WAL | Yes — replay detects partial tail, truncates |
| During `wal::append` sync_data | Same as above | Yes |
| Between WAL append and `apply` | WAL has the mutation; in-memory state didn't update (but session is dying anyway) | Yes — next unlock replays it |
| During `metadata::save` write to .tmp | `metadata.enc.tmp` partial, `metadata.enc` untouched | Yes — next unlock loads the old `metadata.enc`. .tmp gets cleaned up |
| Between rename and `wal::truncate` in compact | New snapshot written, WAL still has the already-snapshotted records | Yes — idempotent Create* makes WAL replay safe |
| During `write_blob` of a file blob | Either `.tmp` orphan (if before rename) or completed `.enc` (if after) | Yes — .tmp orphan cleaned at next unlock. Completed but unreferenced .enc becomes an orphan blob (disk leak, not data loss) |
| During `delete_file` between WAL append and blob delete | WAL has the deletion; blob file still on disk | Yes — replay applies deletion. Blob is orphan (disk leak) |
| During `migrate_one_v2_blob` | `.migrating.tmp` orphan, original v2 blob intact | Yes — .tmp cleaned, v2 blob still readable, migration retryable |
| Power loss while idle | All state durable | Trivially yes |
| `kill -9` while unlocked | Master key was in RAM, now gone. WAL is durable. | Yes — user re-enters password, replays WAL |
| Filesystem corruption that mangles `metadata.enc` | Snapshot can't decrypt | Partial: WAL replay onto an `MetadataDoc::empty()` would reconstruct partial state, but only from WAL entries newer than the last good snapshot. If user has a backup of `metadata.enc`, restoring it + replaying WAL works |

The whole design's recovery story rests on three properties:
1. **Append + fsync is the WAL commit** — anything before fsync return doesn't count.
2. **Atomic rename is the snapshot/blob commit** — anything before rename doesn't count.
3. **`Mutation::apply` is idempotent for Create variants** — re-applying the same WAL entries onto an already-snapshotted state is a no-op.

---

## 13. Fsync discipline (full summary)

Every persistent write path uses the same pattern:

1. Write to a temp file (or append to the WAL).
2. `sync_data()` on the file before close/rename.
3. `rename` to canonical name (for temp+rename writes).
4. `sync_all()` on the parent directory (best-effort).

Files covered:

| Path | File-level sync | Parent-dir sync |
|------|-----------------|-----------------|
| `vault.json` (create) | ✓ explicit sync_data | ✓ |
| `metadata.enc` (compact) | ✓ via write_blob | ✓ via write_blob |
| `metadata.wal` (append) | ✓ explicit sync_data | ✓ |
| `blobs/<uuid>.enc` (write_blob) | ✓ explicit sync_data | ✓ |
| `thumbs/<uuid>.enc` (write_blob) | ✓ same | ✓ |
| `app_config/.../config.json` (save) | ✓ explicit sync_data | ✓ |

Exception: `wal::truncate` (file deletion) does NOT fsync the parent dir, because idempotent recovery makes it benign (next unlock either sees the WAL or doesn't; either way is correct).

Per-append cost of parent-dir fsync on NVMe: ~0.5-1 ms on Linux, near zero on Windows (FlushFileBuffers on a directory handle is effectively a no-op on NTFS because dirent changes are journaled).

---

## 14. Threat model

What the encryption protects against (the strong guarantees):

- **Lost laptop / stolen drive** — encrypted at rest. Attacker without password reads nothing.
- **Cloud backup leak** — same.
- **Passive disclosure** of any encrypted file by anyone without the password.

What the design now ALSO defends against, after the v3 AAD change:

- **Active write attacks**: an attacker with filesystem write access to the vault folder cannot:
  - Truncate any blob to a shorter plaintext silently (header tampering caught)
  - Reorder chunks within a blob to scramble the plaintext order silently (chunk_idx in AAD caught)
  - Splice chunks from one blob into another (header bytes in AAD differ → caught)

What's NOT protected against:

- **An attacker with the password.** Out of scope by definition.
- **Whole-file deletion.** Attacker deletes a blob → read fails with `IoError`. There's no auth tag on file existence.
- **Whole-file truncation that doesn't touch the header.** Reads at the missing chunks fail with `IoError` rather than `Corrupt`. Still observable, just as a different error mode.
- **Stale data substitution within v2 blobs.** v2 blobs lack AAD; chunk reordering / header tampering remains undetected until migration to v3.
- **Side-channel attacks** on the cipher implementation (timing, power, etc.) — out of scope.
- **Malicious frontend** — the frontend is part of MediaVault and trusted. A malicious replacement could call any Tauri command.
- **Memory snooping while unlocked** — the master key is `Zeroizing` but lives in RAM. A process with debug privileges on the machine could read it.

For the realistic personal-vault threat model ("I lose this disk or someone copies my Dropbox folder"), the encryption is the load-bearing protection and it's intact.

---

## 15. Known limitations

| # | Limitation | Severity / context |
|---|------------|--------------------|
| 1 | v2 blobs still readable but unsafe-vs-active-tampering | Mitigated by `migrate_legacy_blobs` command; needs to be invoked |
| 2 | No password change / key rotation | Feature gap. Implementing would re-encrypt master key under a new password-derived key. |
| 3 | Tauri IPC `get_blob` and the no-Range URI handler path load the full file into RAM | Tauri's `Response<Vec<u8>>` requires materialized body; can't stream. Use URI scheme + Range headers for large files. |
| 4 | Import doesn't stream — peak RAM = file size on import | Symmetric problem to the export streaming we fixed. Same fix would work (chunked write API). Not yet done. |
| 5 | Multi-process locking via `fs4` works on local NTFS/ext4/APFS but is unreliable on NFS / SMB / cloud-sync folders | Document; consider detecting and warning. |
| 6 | `read_blob_size` returns unverified header `total` | Inconsistency only — actual decrypt fails AAD check. Could be hardened by reading + decrypting the first chunk just to validate. |
| 7 | `set_path` uses `path.to_string_lossy()` on Windows paths | Loses fidelity for non-UTF-8 paths. Niche. |
| 8 | Vault folder isn't isolated — if user picks a dir with other files, they coexist | Acceptable; cleanup_tmp_files only touches `*.tmp`. |
| 9 | No explicit "this header isn't authenticated by anything outside its chunks" — if all chunks have valid AAD, header is implicitly authenticated, but only via the chunks themselves. There's no separate header MAC. | The AAD scheme is the de-facto auth; this is by design. |

---

## 16. Test inventory

67 tests, ~190 ms runtime. `cargo test --lib`.

### 16.1 `metadata::tests` (26 tests) — `Mutation::apply` semantics

- File mutations: `create_file_pushes_entry`, `create_file_is_idempotent`, `rename_file_updates_name`, `rename_missing_file_is_noop`, `set_thumbnail_updates_field`, `set_thumbnail_on_missing_file_is_noop`, `delete_file_returns_removed`, `delete_missing_file_is_noop`
- Folder mutations: `create_folder_is_idempotent`, `rename_folder_updates_name`, `delete_folder_cascades_subtree_and_files`, `delete_folder_deep_chain`, `delete_missing_folder_is_noop`, `delete_folder_terminates_on_2_cycle`, `delete_folder_terminates_on_self_cycle`
- Tag group mutations: `create_tag_group_is_idempotent`, `rename_tag_group_updates_name`, `delete_tag_group_cascades_to_tags_and_scrubs_files`, `delete_missing_tag_group_is_noop`
- Tag mutations: `create_tag_is_idempotent`, `update_tag_changes_only_name`, `update_tag_can_set_and_clear_color`, `update_tag_changes_both_atomically`, `update_tag_on_missing_is_noop`, `delete_tag_scrubs_files`
- Serde round-trip: `mutation_json_roundtrip_covers_every_variant`

### 16.2 `wal::tests` (16 tests) — WAL log behavior

- Happy path: `replay_missing_file_returns_zero`, `replay_empty_file_returns_zero_and_trims_nothing`, `append_then_replay_roundtrip`, `replay_preserves_mutation_order`, `truncate_removes_wal_file`, `truncate_on_missing_file_is_noop`
- Integration with cascade: `replay_executes_folder_cascade`
- Partial-tail recovery: `replay_truncates_partial_trailing_record`, `replay_handles_partial_length_prefix_at_eof`, `replay_handles_length_prefix_pointing_past_eof`
- Decryption failures: `replay_with_wrong_key_errors_without_destroying_wal`, `replay_with_corruption_after_good_records_truncates_tail`
- Idempotency: `replay_is_idempotent_against_already_snapshotted_state`
- Format sanity: `record_overhead_matches_format`
- Snapshot+WAL integration: `snapshot_plus_wal_matches_replay_from_empty`, `compact_then_replay_is_no_op`

### 16.3 `blobs::tests` (22 tests) — blob format

- Roundtrip: `write_and_read_roundtrip`, `range_read_returns_requested_slice`, `read_blob_size_works_on_v2`
- Wrong key: `read_with_wrong_key_returns_corrupt_not_panic`
- Defensive: `zero_chunk_size_header_errors_instead_of_panicking`
- v3 AAD protections: `total_field_tamper_is_detected_via_aad`, `magic_tamper_falls_to_legacy_path_and_fails`, `chunk_reordering_is_detected_via_aad`
- v2 backward compat: `v2_blobs_remain_readable`
- `stream_blob`: `stream_blob_roundtrip_single_chunk`, `stream_blob_roundtrip_multi_chunk_preserves_order`, `stream_blob_caps_memory_for_huge_files`, `stream_blob_works_on_v2_blobs`, `stream_blob_propagates_callback_error`, `stream_blob_rejects_zero_chunk_size_header`, `stream_blob_detects_chunk_reorder`
- v2 → v3 migration: `migrate_rewrites_v2_blob_as_v3_preserving_plaintext`, `migrate_handles_multi_chunk_v2_blobs`, `migrate_ignores_already_v3_blobs`, `migrate_is_idempotent`, `migrate_skips_non_enc_files`, `migrate_returns_zero_for_missing_dir`

### 16.4 `vault::tests` (3 tests) — VaultState helpers

- `cleanup_tmp_removes_staging_files_across_all_dirs` — sweeps `*.tmp` in vault root, blobs/, thumbs/, leaves everything else alone
- `cleanup_tmp_is_silent_when_dirs_missing` — safe on a fresh vault folder
- `acquire_vault_lock_creates_lockfile_and_can_be_released` — single-process smoke test for the cross-process lock plumbing

---

## 17. File-level reference

| File | Role | Key functions |
|------|------|---------------|
| `src-tauri/src/main.rs` | Entry point | `main` (just calls `mediavault_lib::run`) |
| `src-tauri/src/lib.rs` | Tauri setup + URI scheme handler | `run`, `dispatch_mv`, `parse_range` |
| `src-tauri/src/commands.rs` | Tauri commands (the IPC surface) | One per user-facing operation |
| `src-tauri/src/vault.rs` | `VaultState` + lifecycle + every mutation method | `create`, `unlock`, `lock`, `set_path`, `import_file`, `set_thumbnail`, `rename_file`, `delete_file`, `create_folder`, `rename_folder`, `delete_folder`, `create_tag_group`, `rename_tag_group`, `delete_tag_group`, `create_tag`, `update_tag`, `delete_tag`, `read_blob*`, `export_file`, `export_zip`, `migrate_legacy_blobs`, `snapshot_path_and_key`, `acquire_vault_lock`, `cleanup_tmp_files`, `compact` |
| `src-tauri/src/metadata.rs` | `MetadataDoc`, `Mutation`, `ColorChange`, `ApplyOutcome`, snapshot read/write | `load`, `save`, `Mutation::apply` |
| `src-tauri/src/wal.rs` | WAL format and operations | `append`, `replay_into`, `truncate`, `size` |
| `src-tauri/src/blobs.rs` | Blob format (v3 / v2 / legacy) and operations | `write_blob`, `read_blob`, `read_blob_range`, `read_blob_size`, `stream_blob`, `delete_blob`, `migrate_v2_blobs_in_dir`, `aad_for_chunk`, `BlobFormat::detect` |
| `src-tauri/src/crypto.rs` | KDF + AEAD primitives | `derive_key`, `aead_encrypt`, `aead_decrypt`, `generate_salt`, `generate_key_bytes`, `KdfParams` |
| `src-tauri/src/error.rs` | `VaultError` enum + frontend mapping | `From<VaultError> for AppError` |
| `src-tauri/src/app_config.rs` | App-level pointer to chosen vault folder | `load`, `save`, `config_file_path`, `suggested_default_vault_path` |
| `src-tauri/src/media.rs` | MIME detection + image thumbnail generation | `detect_mime`, `is_image`, `is_video`, `generate_image_thumbnail` |
| `src-tauri/src/ffmpeg.rs` | Video thumbnail generation via bundled ffmpeg sidecar | `generate_video_thumbnail` |

---

## 18. Design references

- [[decisions/0001-wal-instead-of-rewriting-snapshot]] — why WAL was chosen over the "rewrite metadata.enc on every mutation" pattern.
- [[decisions/0002-aad-binding-blob-v3]] — why every chunk's AEAD authenticates the header + chunk_idx.
- [[decisions/0003-cross-process-vault-lock]] — why a `vault.lock` file + `fs4` rather than the Tauri single-instance plugin.
