---
type: reference
title: Obsidian CLI — usage
created: 2026-05-13
updated: 2026-05-13
tags: [reference, tooling]
status: stub
---

# Obsidian CLI

> **Status: stub.** The CLI requires Obsidian v1.12+ and must be enabled in **Settings → General**, then added to the system PATH. This doc will be expanded once the CLI is verified working on the user's machine.

## Prerequisites

- Obsidian v1.12 or newer
- CLI enabled: **Settings → General → enable CLI option, register PATH**
- Obsidian desktop app must be running for most commands (the CLI talks to the live app via IPC)

## Verify

```bash
obsidian --help
```

If that prints help, the CLI is wired up.

## Command groups (planned coverage)

Once verified, this doc will cover:

| Group | Purpose |
|---|---|
| `files` | read, create, append, move, delete, rename notes |
| `daily` | open, append, list daily notes |
| `search` | full-text search, scoped, JSON output |
| `tasks` | list/query tasks across the vault |
| `tags` | list, search by tag |
| `links` | outbound, backlinks, broken links |
| `properties` | get/set frontmatter properties |
| `plugins` | list, enable, disable, reload |
| `themes` | list, switch |
| `eval` | execute JS in vault context (gives access to plugin globals like Dataview API) |
| `screenshot` | capture rendered note as PNG |

## Common patterns (to be filled in)

- Append a log entry to `log.md`
- Search for orphan pages (lint operation)
- Read a note's frontmatter as JSON
- Run a Dataview query programmatically via `eval`

## Gotchas (placeholders pending verification)

- Paths are vault-relative.
- JSON output via `--json` flag (where supported).
- Stderr handling differs from typical Unix tools — needs verification.
- Windows: may require a `.com` redirector for PATH registration.
- Headless Linux: requires `xvfb` for the desktop app dependency.

---

**Next step**: once the user enables the CLI, run `obsidian --help` and each subcommand's help, then populate this doc with verified syntax, examples, and a usage patterns section for the operations defined in [[../../CLAUDE]].
