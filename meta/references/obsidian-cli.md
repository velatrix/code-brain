---
type: reference
title: Obsidian CLI — usage
created: 2026-05-13
updated: 2026-05-13
tags: [reference, tooling]
status: verified
---

# Obsidian CLI

Verified working on Obsidian **v1.12.7** on Windows. Obsidian desktop app must be running — the CLI talks to the live app via IPC.

## 1. Always target the vault

The user has multiple vaults (`Personal`, `CodeBrain`, `Claude`). **Every command must include `vault=CodeBrain`** to avoid hitting the wrong vault.

```powershell
obsidian vault                          # ❌ may target the active vault, not CodeBrain
obsidian --% vault=CodeBrain vault      # ✅ explicit
```

## 2. PowerShell syntax gotcha — the `--%` stop-parsing token

PowerShell parses `key=value` arguments specially (it can swallow `=` or interpret them as named parameters). To pass them literally to a native exe, use the **`--%` stop-parsing token**:

```powershell
obsidian search --% query=Karpathy vault=CodeBrain format=json
```

Everything after `--%` is passed verbatim. Without it, PowerShell may eat or transform the args.

In **bash / git-bash** this is not needed — args pass through cleanly:

```bash
obsidian search query=Karpathy vault=CodeBrain format=json
```

## 3. Argument conventions (from `obsidian --help`)

- `file=<name>` resolves by name (wikilink-style)
- `path=<path>` is exact (folder/note.md)
- Most commands default to the active file if `file`/`path` is omitted
- Quote values with spaces: `name="My Note"`
- Use `\n` for newline, `\t` for tab in content values
- Output formats: most commands take `format=json|tsv|csv` (NOT `--json`)

## 4. Command surface — the 90% we use

### File I/O

| Command | Usage |
|---|---|
| `read` | `obsidian --% read path=wiki/foo.md vault=CodeBrain` |
| `create` | `obsidian --% create path=wiki/foo.md content="..." vault=CodeBrain` |
| `append` | `obsidian --% append path=log.md content="## [2026-05-13] ..." vault=CodeBrain` |
| `prepend` | `obsidian --% prepend path=log.md content="..." vault=CodeBrain` |
| `move` | `obsidian --% move path=inbox/foo.md to=wiki/foo.md vault=CodeBrain` |
| `rename` | `obsidian --% rename path=wiki/foo.md name=bar vault=CodeBrain` |
| `delete` | `obsidian --% delete path=foo.md vault=CodeBrain` |
| `files` | `obsidian --% files folder=wiki ext=md vault=CodeBrain` |

For batch markdown edits, **direct file I/O via Edit/Write tools is fine and faster** — the CLI is for operations that need Obsidian-aware semantics (link resolution, plugin APIs, etc.).

### Search

| Command | Usage |
|---|---|
| `search` | `obsidian --% search query=cqrs vault=CodeBrain format=json` — returns array of paths |
| `search:context` | Same but returns matching lines with surrounding context |
| `tag` | `obsidian --% tag name=concept vault=CodeBrain verbose` |
| `tags` | `obsidian --% tags counts vault=CodeBrain format=json` |

### Frontmatter (properties)

| Command | Usage |
|---|---|
| `properties` | `obsidian --% properties path=wiki/foo.md vault=CodeBrain` — YAML output |
| `property:read` | `obsidian --% property:read path=wiki/foo.md name=type vault=CodeBrain` |
| `property:set` | `obsidian --% property:set path=wiki/foo.md name=updated value=2026-05-13 type=date vault=CodeBrain` |
| `property:remove` | `obsidian --% property:remove path=foo.md name=old vault=CodeBrain` |

Returns `No frontmatter found.` if the note has no YAML block.

### Links & graph (the lint surface)

| Command | What it gives us |
|---|---|
| `orphans` | Pages with no inbound links (candidates for MOC linking) |
| `deadends` | Pages with no outgoing links (often summaries or terminal facts) |
| `unresolved` | Broken `[[wiki-links]]` — pages referenced but not created |
| `backlinks` | `obsidian --% backlinks path=wiki/foo.md vault=CodeBrain format=json` |
| `links` | Outgoing links from a file |

**Lint pattern** — run all three, write findings to `meta/_claude/lint-YYYY-MM-DD.md`:

```powershell
obsidian --% orphans vault=CodeBrain
obsidian --% deadends vault=CodeBrain
obsidian --% unresolved verbose vault=CodeBrain format=json
```

### Templates

| Command | Usage |
|---|---|
| `templates` | `obsidian --% templates vault=CodeBrain` — list template names |
| `template:read` | `obsidian --% template:read name=project resolve title="My Project" vault=CodeBrain` |
| `template:insert` | `obsidian --% template:insert name=project vault=CodeBrain` — into active file |
| `create` with `template=` | `obsidian --% create path=projects/foo/_moc.md template=project vault=CodeBrain` |

### Plugins

| Command | Usage |
|---|---|
| `plugins` | `obsidian --% plugins filter=community versions format=json vault=CodeBrain` |
| `plugins:enabled` | Same args; only enabled plugins |
| `plugin:install` | `obsidian --% plugin:install id=obsidian-git enable vault=CodeBrain` |
| `plugin:enable` / `plugin:disable` / `plugin:uninstall` | `id=<plugin-id>` |
| `plugin:reload` | For dev; reload after editing plugin code |

### Daily notes

| Command | Usage |
|---|---|
| `daily:read` | Read today's daily note |
| `daily:append` | `obsidian --% daily:append content="- thought" vault=CodeBrain` |
| `daily:prepend` | Same but at top |
| `daily:path` | Get path of today's daily note |

### `eval` — JS in vault context

Executes JavaScript with access to plugin globals (`app`, Dataview API, etc.). **Treat the code as an expression — `return` is not allowed.**

```powershell
obsidian eval --% code="2+2" vault=CodeBrain
# => 4

obsidian eval --% code="app.vault.getMarkdownFiles().length" vault=CodeBrain
```

For multi-line logic, wrap in an IIFE:

```powershell
obsidian eval --% code="(()=>{const f=app.vault.getMarkdownFiles();return f.length})()" vault=CodeBrain
```

Use cases:
- Run a Dataview query: `DataviewAPI.pages('"wiki"').length`
- Inspect plugin state
- Call ExcalidrawAutomate if we ever fall back to it

### Dev tools

| Command | Purpose |
|---|---|
| `dev:screenshot` | `obsidian --% dev:screenshot path=out.png vault=CodeBrain` — for visual verification |
| `dev:console` | View captured console messages (debug plugin issues) |
| `dev:errors` | View captured errors |
| `dev:dom` | Query DOM elements (rendered note inspection) |

### Workspace & navigation

| Command | Usage |
|---|---|
| `open` | `obsidian --% open path=wiki/foo.md vault=CodeBrain` |
| `tabs` | List open tabs |
| `tab:open` | Open new tab with file |
| `recents` | Recently opened files |
| `vault` | Vault info (name, path, file count) |
| `vaults` | List all known vaults |
| `reload` | Reload the vault |

### Bases (Obsidian's database views)

`base:create`, `base:query`, `base:views`, `bases` — for working with `.base` files. Not used yet in CodeBrain; document when we add one.

## 5. Patterns for our operations

### Ingest a source

```powershell
# 1. Source is already in raw/articles/foo.md (user dropped it via Web Clipper)

# 2. Create a wiki summary from the template
obsidian --% create path=wiki/foo-summary.md template=wiki-summary vault=CodeBrain

# 3. Update relevant entity pages (use direct Edit tool for content; CLI for link resolution checks)

# 4. Append to log
obsidian --% append path=log.md content="\n## [2026-05-13] ingest | <title>\nKey takeaways summarized in [[foo-summary]]; updated entities [[a]], [[b]]." vault=CodeBrain

# 5. Verify nothing broke
obsidian --% unresolved vault=CodeBrain
```

### Query

```powershell
# 1. Read index first
obsidian --% read path=index.md vault=CodeBrain

# 2. Search if needed
obsidian --% search query=<term> vault=CodeBrain format=json

# 3. Drill into matched files via read

# 4. If the synthesis is substantive, file it back:
obsidian --% create path=wiki/<synthesis>.md content="..." vault=CodeBrain
obsidian --% append path=log.md content="\n## [date] query | <topic>" vault=CodeBrain
```

### Lint

```powershell
obsidian --% orphans vault=CodeBrain
obsidian --% deadends vault=CodeBrain
obsidian --% unresolved verbose vault=CodeBrain format=json
obsidian --% tags counts sort=count vault=CodeBrain
```

Write findings to `meta/_claude/lint-<date>.md` with proposed actions.

## 6. Gotchas

- **Multi-vault**: always pass `vault=CodeBrain` or you'll edit the wrong vault.
- **PowerShell**: always use `--%` stop-parsing token before key=value args.
- **`eval` is an expression**, not a function body. Use IIFE for multi-statement code. `return` at top level errors out.
- **Output formats vary**: most commands use `format=json|tsv|csv`. `orphans`, `deadends`, `eval`, and a few others return plain text by default.
- **`properties` reads YAML frontmatter**; returns `"No frontmatter found."` if the file has none. Use the property family (`property:read/set/remove`) for individual keys.
- **Obsidian must be running.** If `obsidian` returns nothing or hangs, check the desktop app is up.
- **`plugin:install` may take a moment** as it fetches from the community plugin store.
