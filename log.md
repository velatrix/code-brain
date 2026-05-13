---
type: log
title: Log
---

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