# CodeBrain — Vault Schema

This file is the operating manual for the CodeBrain vault. Every agent (Claude Code, Codex, Gemini CLI, etc.) reads this first. Humans should read [[README]] instead.

If something here is wrong or unclear, fix it. This is a living document — update it as conventions emerge, and append a note to [[log]].

---

## 1. Purpose

CodeBrain is a developer's second brain: an AI-maintained knowledge base for accumulating notes, designs, decisions, and synthesis across projects. The owner is a software developer; assume technical fluency.

The vault is **AI-first** — structure and conventions optimize for an LLM reading and writing notes. Humans browse the rendered Obsidian view; agents work directly with the markdown.

---

## 2. Three-layer architecture

Following the [[meta/references/karpathy-llm-wiki|Karpathy LLM Wiki pattern]]:

| Layer | Folder | Role | Who writes |
|---|---|---|---|
| **Raw sources** | `raw/` | Immutable source material (articles, papers, attachments) | Human captures, agents read |
| **Wiki** | `wiki/` | LLM-maintained synthesis (entities, concepts, summaries) | Agents write, humans browse |
| **Schema** | this file + `meta/` | Conventions, templates, reference docs, tools | Co-evolved by human and agents |

Plus PARA-style folders for active work that has a lifecycle (`projects/`, `guides/`, `archive/`).

**Hard rule: `raw/` is immutable.** Agents read from it but never modify. If a source needs annotation, write a wiki summary page in `wiki/` instead.

---

## 3. Folder map

```
CodeBrain/
├── CLAUDE.md            ← this file (vault schema)
├── README.md            ← human entry point
├── index.md             ← content catalog (agents read first to orient)
├── log.md               ← chronological append-only log
├── raw/                 ← immutable sources
│   ├── articles/        ← web articles (via Obsidian Web Clipper)
│   ├── papers/          ← academic papers, PDFs
│   └── attachments/     ← images, downloaded assets
├── wiki/                ← LLM-maintained knowledge (FLAT — no sub-folders)
├── projects/            ← active work, one folder per project
│   └── <project>/
│       ├── _moc.md      ← project index / map of content
│       ├── design/      ← design docs
│       ├── decisions/   ← ADRs (architecture decision records)
│       └── notes/       ← working notes, journals
├── guides/              ← long-lived design guides, conventions, rules
├── archive/             ← retired projects (preserve folder structure)
├── inbox/               ← quick capture, unsorted (triage to permanent home)
└── meta/
    ├── templates/       ← note templates (use these, don't invent format)
    ├── references/      ← deep how-to docs (CLI, Dataview, Excalidraw, etc.)
    ├── tools/           ← actual executable scripts (Node, etc.)
    └── _claude/         ← agent scratch, generated drafts not yet promoted
```

**`wiki/` is flat by design.** Pages are named by the entity or concept (e.g. `wiki/vappcore.md`, `wiki/cqrs.md`). Categorization happens via `type` frontmatter and tags, not folders. This matches how real wikis work and keeps wiki-links short.

---

## 4. Operations

The three named workflows agents perform:

### Ingest
The user drops a source into `raw/` (or asks "ingest this URL"). The agent:
1. Reads the source
2. Discusses key takeaways with the user
3. Writes a summary page in `wiki/<source-slug>.md` (template: `wiki-summary.md`)
4. Updates relevant entity/concept pages in `wiki/` (touching 5–15 wiki pages is normal)
5. Appends an entry to [[log]]: `## [YYYY-MM-DD] ingest | <title>`
6. Adds an entry to [[index]] under the appropriate section

### Query
The user asks a question against the vault. The agent:
1. Reads [[index]] first to find relevant pages
2. Drills into those pages
3. Synthesizes an answer with citations to wiki pages (use `[[wiki-link]]` format)
4. **File-back rule**: if the synthesis is substantive (a comparison, an analysis, a discovered connection), save it as a new wiki page. Don't let valuable explorations die in chat.

### Lint
On user request ("lint the wiki"), the agent health-checks:
- Contradictions between pages
- Stale claims newer sources have superseded
- Orphan pages (no inbound links)
- Important concepts mentioned but lacking their own page
- Missing cross-references
- Suggests new questions to investigate and sources to look for

Output: a report in `meta/_claude/lint-YYYY-MM-DD.md` plus actionable suggestions.

---

## 5. Note types

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

## 6. Frontmatter standard

Every note opens with YAML frontmatter. **Without frontmatter, agents treat all files the same way and lose valuable classification.**

Required on every note:
```yaml
---
type: <one of the types in §5>
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

## 7. Naming conventions

- **Filenames**: `kebab-case.md` — lowercase, hyphens. Exceptions: `CLAUDE.md`, `README.md` at root (convention).
- **Titles in frontmatter**: `Title Case`.
- **Folders**: lowercase, hyphenated if multi-word.
- **Root files**: `CLAUDE.md`, `README.md`, `index.md`, `log.md`.
- **Wiki pages by name**: `wiki/vappcore.md` (the page IS the entity).
- **Project folder names**: descriptive kebab-case, e.g. `projects/web-api-rewrite/`.

---

## 8. Linking rules

- Prefer `[[wikilinks]]` for in-vault references — short, refactor-safe, populates backlinks.
- Use `[display text](path)` only when linking to a sub-section: `[[note#heading]]` is preferred.
- Link to wiki entities from project docs liberally — e.g. a design doc mentioning VAppCore should write `[[vappcore]]`, not just the bare name.
- Never use absolute file paths in links.
- Don't manually maintain backlinks; Obsidian computes them.

---

## 9. Inbox workflow

`inbox/` is for **quick capture**, not permanent residence. When the user drops a note (or asks to "save this for later"):

1. Write to `inbox/<short-name>.md` with minimal frontmatter (just `type: inbox` and `created:`)
2. On a separate session (or when prompted), triage: move to the correct permanent home, update frontmatter, link from relevant places.
3. Inbox should be near-empty at rest. If it has >10 items, the user is overdue for a triage pass — surface this.

---

## 10. AI-specific rules

- **Use templates from `meta/templates/`**. Don't invent note structure from scratch.
- **Generated drafts and scratch work go in `meta/_claude/`**. Promote to permanent locations only after user review.
- **Don't overwrite human-authored content without confirming.** If a file has substantive prose the user wrote, ask before rewriting.
- **`raw/` is immutable.** Never modify or delete files in `raw/`. To "annotate" a source, write a wiki page about it.
- **Update [[index]] and [[log]] on every meaningful operation.** Ingests, new wiki pages, project starts/ends, lint passes.
- **Verify before claiming.** When the user asks about something, check the current vault state (file exists, content current) — memory from prior sessions can be stale.
- **Stay flat.** Deep folder nesting costs tokens. If you find yourself creating `projects/foo/research/topics/sub/`, flatten.
- **Commit liberally.** After meaningful changes, commit. The vault is git-tracked (see `.gitignore` — `.obsidian/` is fully tracked).

---

## 11. Project lifecycle

1. **Start**: Create `projects/<name>/_moc.md` from `project.md` template. Status: `active`. Append to [[log]] and [[index]].
2. **Active**: All project docs (design, decisions, notes) live under `projects/<name>/`. Diagrams in `projects/<name>/diagrams/`.
3. **Mature**: As the project produces durable lessons (e.g. "the way we do paging," "our error handling pattern"), distill them to wiki pages or `guides/` so future projects can reuse.
4. **End**: Mark `_moc.md` status as `done`. Move folder to `archive/<name>/`. Wiki pages and guides remain; archive preserves the project's working notes.

---

## 12. Tooling

- **Obsidian CLI** (built-in v1.12+): see [[meta/references/obsidian-cli]] for command reference and usage.
- **Dataview** (Obsidian plugin): live queries over frontmatter — see [[meta/references/dataview]] (TODO).
- **Templater** (Obsidian plugin): renders templates with dynamic content.
- **Excalidraw** (Obsidian plugin) + custom renderer: see [[meta/references/excalidraw]] for diagram generation workflow.
- **Git**: vault is tracked; `origin` → `git@github.com:velatrix/code-brain.git`. Commit after meaningful changes.

---

## 13. When in doubt

1. Check this file.
2. Check `meta/references/`.
3. Read [[index]] to see what already exists.
4. Ask the user.

If you encounter unfamiliar conventions, files, or branches, **investigate before deleting or overwriting** — it may be the user's in-progress work.

---

## 14. Markdown gotchas (Obsidian + Dataview)

Obsidian extends CommonMark, and Dataview adds another parser on top. Both can collide with technical syntax in subtle ways. Cases learned the hard way:

- **`==text==` is Obsidian highlight syntax.** Don't write inline expressions containing `==` (equality operators, RSQL like `name==John`, C# operator examples). Even backticks don't reliably save it because Obsidian's preview can pair the `==` across inline-code boundaries.

- **Dataview scans inline code for bracket+equals patterns.** Things like `` `[VRateLimit(policy, Cost = N)]` `` or `` `o.Policies[name] = new ...` `` cause Dataview to try parsing the bracketed thing as an inline field with `=` as the value, producing a noisy "Dataview (inline field '='): PARSING FAILED" overlay in preview.

**Rule:** if a span has `=`, `==`, brackets-with-equals, or RSQL-style operators, put it in a **fenced code block** (```` ``` ````) or split across **table cells** (one `=` per cell, no second `=` on the same line). Inline backticks are not enough to hide content from either parser reliably.

## 15. Updating this document

CLAUDE.md is a living document. Update it when:
- A new convention is adopted (e.g. a new note type)
- An existing rule turns out to be wrong or incomplete
- New tooling is introduced
- A repeated agent mistake suggests a missing rule

When updating, also append a one-line entry to [[log]]:
`## [YYYY-MM-DD] schema | <what changed>`

Keep this file under ~400 lines. If a section needs more depth, move it to `meta/references/` and link from here.
