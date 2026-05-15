# Notes

The shape of any non-root note in the vault — its type, frontmatter, and per-type rules.

---

## Note types

Every note has a `type` in frontmatter. Use the matching template.

| Type | Template | Lives in | Purpose |
|---|---|---|---|
| `wiki-entity` | `wiki-entity.md` | `wiki/` | A thing: person, library, tool, product (e.g. VAppCore, EF Core) |
| `wiki-concept` | `wiki-concept.md` | `wiki/` | An idea or pattern (e.g. CQRS, RSQL, Zettelkasten) |
| `wiki-summary` | `wiki-summary.md` | `wiki/` | Summary of a specific source from `raw/` |
| `project` | `project.md` | `projects/<name>/_moc.md` | Top-level project index |
| `design` | `design.md` | `projects/<name>/design/` | Design doc for a feature/component |
| `adr` | `adr.md` | `projects/<name>/decisions/` | Architecture Decision Record |
| `research` | `research.md` | `projects/<name>/notes/` or `wiki/` | Research note (project-scoped or general) |
| `guide` | `guide.md` | `guides/` | Long-lived design guide, convention, or rule |

---

## Frontmatter standard

Every non-root note opens with YAML frontmatter. **Without frontmatter, agents treat all files the same way and lose valuable classification.** Root files (`CLAUDE.md`, `index.md`, `log.md`, `structure.md`, `notes.md`, `operations.md`, `playbooks.md`) are singletons and don't use frontmatter.

Required on every note:

```yaml
---
type: <one of the types above>
title: <Title Case>
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
tags: [tag1, tag2]
---
```

Type-specific additions are in the templates. Notably:

- `wiki-summary` requires `source:` (relative path into `raw/`)
- `project` and `adr` require `status:` (one of: `active`, `paused`, `done`, `superseded`)
- `adr` requires `decision-date:` and optionally `supersedes:` / `superseded-by:`

---

## Markdown gotchas (Obsidian + Dataview)

Obsidian extends CommonMark; Dataview adds another parser on top. Both scan source globally. This vault works around the worst case via plugin configuration.

### Vault workaround: Dataview inline-query prefix

Dataview's default `inlineQueryPrefix` is a single equals sign and `inlineJsQueryPrefix` is `$=`. Both contain an equals sign, so any text containing two consecutive equals signs gets parsed as an inline query → noisy "PARSING FAILED" overlay even inside fenced blocks.

This vault changes them in `.obsidian/plugins/dataview/data.json`:

- `inlineQueryPrefix` → `dv:`
- `inlineJsQueryPrefix` → `dvjs:`

Always use these prefixes for inline queries:

```
`dv: this.file.name`
`dvjs: dv.current().file.name`
```

The default equals-sign prefixes are disabled in this vault — don't use them. (Reload Obsidian after editing `data.json` for changes to take effect.)

### Obsidian highlight syntax

A pair of consecutive equals signs renders as a yellow highlight. To show the literal pattern (equality operators, RSQL filters, C# operator examples), wrap it in a fenced code block:

```
==text==
name==John
```

Backticks alone don't fully escape this — Obsidian's preview can pair the markers across inline-code boundaries.

### Bracketed equals patterns

Dataview's inline-field parser can also match square-bracketed expressions containing an equals sign. With the prefix workaround above this is quiet in practice, but use fenced code blocks for literal examples to be safe:

```
[VRateLimit(policy, Cost = N)]
o.Policies[name] = new ...
```

### Rule

1. Use the configured `dv:` / `dvjs:` prefixes for inline queries.
2. Wrap literal `==text==` and `[...=...]` examples in fenced code blocks.
3. Don't write inline-code spans (single backticks) containing these patterns in prose — fenced is safer.
