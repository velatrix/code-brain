---
type: adr
title: Bind blob header + chunk index into AEAD AAD (blob format v3)
created: 2026-05-18
updated: 2026-05-18
decision-date: 2026-05-18
status: accepted
tags: [adr, storage, encryption, aead]
---

# Bind blob header + chunk index into AEAD AAD (blob format v3)

## Status
`accepted`

## Context

The previous blob format (v2, magic `MV1\0`) had this structure:

```
[magic][chunk_size u32][total u64]   ← 16-byte header
for each chunk:
  [nonce][ciphertext][16-byte GCM tag]
```

Each chunk's AEAD authenticated its own ciphertext+nonce — strong protection for chunk content. **But the AEAD's AAD was empty**, which meant nothing tied:
- The chunk to its position in the file
- The chunk to any other chunk in the file
- The chunk to the header bytes

An attacker with filesystem write access to the vault folder (cloud-sync provider, shared-machine adversary, malware) could do three attacks the encryption did NOT catch:

**A. Truncation attack — modify `total`.** Header isn't authenticated → flip the `total` u64 to a smaller value → reader serves only the first N bytes of plaintext. The bytes returned are real plaintext; the rest is silently dropped. For a video, the ending is invisibly cut off.

**B. Chunk reordering — swap chunks on disk.** Each chunk is self-authenticating, but its position isn't. Swap chunk #0's bytes with chunk #2's bytes → both still authenticate (the AEAD tag covers the chunk's own bytes, not its position) → reader assembles `chunk #2 || chunk #1 || chunk #0` and serves it as if it were the original. Garbled but apparently-intact.

**C. Cross-blob splicing — substitute chunks from a different blob.** If two blobs are encrypted with the same key (which they are — all vault blobs share the master key), and they have the same chunk_size, you could swap chunk #N of file A into the chunk #N slot of file B. Both authenticate. The reader gets a corrupted file with one foreign chunk.

For the realistic personal-vault threat model (lost disk, leaked cloud backup), these attacks don't matter — passive disclosure is what we protect against, and the encryption is intact. But for the "vault on a synced folder where the sync provider could in theory tamper" model, and for general defense-in-depth, the gap was real.

The chunk_size=0 DoS panic (now patched with an explicit guard) was an early symptom of the same underlying issue: header bytes feed into computation but aren't authenticated.

## Decision

Introduce blob format **v3** (magic `MV2\0`) that binds the 16-byte header AND each chunk's index into the AEAD's Additional Authenticated Data:

```
AAD per chunk = header (16 B) || chunk_idx (u64 LE) = 24 bytes
```

Both encrypt and decrypt sides reconstruct the same AAD by reading the on-disk header bytes and tracking the chunk position. AES-GCM's auth tag now covers (ciphertext, AAD), so any modification to either fails the tag check.

The chunk byte layout is otherwise unchanged from v2. Only the AAD value differs. The header byte layout is unchanged except for the magic.

Reader dispatches on magic:
- `MV2\0` → v3 (AAD = header || chunk_idx)
- `MV1\0` → v2 (AAD = empty) — read-only, no new writes produce these
- otherwise → legacy single-AEAD format (no chunking, no header)

Writers always emit v3. v2 blobs from older code remain readable for backward compatibility, with `migrate_v2_blobs_in_dir` providing in-place re-encryption when the user wants to take the security upgrade.

## Consequences

- **Positive — attacks A, B, C are now caught.**
  - **Truncation**: modifying `total` changes the header bytes, which changes the AAD for every chunk, which fails every chunk's auth tag check. Reader sees `VaultError::Corrupt`, not partial data.
  - **Chunk reordering**: the moved chunk's bytes were encrypted with `chunk_idx=N` in its AAD, but at the new position the reader reconstructs AAD with `chunk_idx=M`. Mismatch → auth fail.
  - **Cross-blob splicing**: the spliced chunk's bytes were encrypted with file A's header in its AAD. At file B's position the reader uses file B's header → AAD differs → auth fail.

- **Positive — header bytes are now implicitly authenticated.** No separate header MAC needed; if any chunk decrypts successfully, the header bytes used to construct its AAD are guaranteed to match what was used at encrypt time.

- **Positive — defense in depth for the `chunk_size=0` DoS vector.** Even without the explicit guard, an attacker setting `chunk_size=0` would change the AAD and the chunks would fail to decrypt. The explicit guard remains because it provides a cleaner error message and avoids the divide-by-zero / infinite-loop reachability earlier in the read path.

- **Negative — format change.** v2 blobs written by older code are now flagged as "unsafe-vs-active-tampering" until migrated. Migration is provided but requires explicit invocation; vaults that never migrate keep v2 blobs around.

- **Negative — 24 extra bytes of AAD per chunk's AEAD call.** Computationally trivial (GCM AAD is folded into GHASH at ~constant per byte). Not a perf concern.

- **Negative — slightly more complex read paths.** Each of `read_blob`, `read_blob_range`, `stream_blob`, and `decrypt_chunked_full` dispatches on `BlobFormat`. The branching is local and tested.

- **Neutral — no impact on the WAL or the snapshot's format choice.** Both use `write_blob` which produces v3, so they get the AAD protection automatically.

## Alternatives considered

- **Separate HMAC over the header.** Compute HMAC-SHA256 over the header bytes, store it at a known offset, verify on read. Rejected — adds a second crypto primitive and an extra format field for a protection that AAD already provides cleanly. AAD is what AES-GCM was designed for.

- **Don't authenticate the header — accept the attack surface.** Rejected after the user pushed back on "is this an attack ground? might it be?" — the truncation and reordering attacks were real-but-low-likelihood, but the fix is small enough that the trade is clearly worth it.

- **Bump to a totally different format (e.g. age, AEAD framing libraries).** Rejected — we already had a working chunked format. The change is one AAD field, not a re-architecture.

- **Auto-migrate v2 → v3 on first read.** Rejected — read paths shouldn't have write side-effects. Race conditions if two readers hit the same v2 blob. Explicit migration is cleaner.

- **Force migration on next unlock.** Rejected for now — could take hours on a large vault. Better to expose the migration as a command the user invokes when convenient.

## References

- [[design/storage]] §6 — blob format details for v3, v2, and legacy
- [[design/storage]] §9 — migration mechanics
- [[design/storage]] §14 — full threat model
