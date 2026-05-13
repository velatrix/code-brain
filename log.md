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