# Structure

Folder layout, naming conventions, and linking rules for the vault.

---

## Three-layer architecture

Following the [[meta/references/karpathy-llm-wiki|Karpathy LLM Wiki pattern]]:

| Layer | Folder | Role | Who writes |
|---|---|---|---|
| **Raw sources** | `raw/` | Immutable source material (articles, papers, attachments) | Human captures, agents read |
| **Wiki** | `wiki/` | LLM-maintained synthesis (entities, concepts, summaries) | Agents write, humans browse |
| **Schema** | `CLAUDE.md` + `meta/` | Conventions, templates, reference docs, tools | Co-evolved by human and agents |

Plus PARA-style folders for active work that has a lifecycle (`projects/`, `guides/`, `archive/`, `inbox/`).

**Hard rule: `raw/` is immutable.** Agents read from it but never modify. If a source needs annotation, write a wiki summary page in `wiki/` instead.

---

## Folder map

```
CodeBrain/
├── CLAUDE.md            ← vault schema (agent operating manual)
├── index.md             ← content catalog
├── log.md               ← chronological append-only log
├── structure.md         ← this file (folder layout + conventions)
├── notes.md             ← note types, frontmatter, per-type rules
├── operations.md        ← named workflows (ingest, query, lint, triage)
├── playbooks.md         ← project-type → guide router
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

## Naming conventions

- **Filenames**: `kebab-case.md` — lowercase, hyphens. Exception: `CLAUDE.md` at root (convention).
- **Titles in frontmatter**: `Title Case`.
- **Folders**: lowercase, hyphenated if multi-word.
- **Root files**: `CLAUDE.md`, `index.md`, `log.md`, `structure.md`, `notes.md`, `operations.md`, `playbooks.md`.
- **Wiki pages by name**: `wiki/vappcore.md` (the page IS the entity).
- **Project folder names**: descriptive kebab-case, e.g. `projects/web-api-rewrite/`.

---

## Linking rules

- Prefer `[[wikilinks]]` for in-vault references — short, refactor-safe, populates backlinks.
- Use `[display text](path)` only when linking to a sub-section: `[[note#heading]]` is preferred.
- Link to wiki entities from project docs liberally — e.g. a design doc mentioning VAppCore should write `[[vappcore]]`, not just the bare name.
- Never use absolute file paths in links.
- Don't manually maintain backlinks; Obsidian computes them.

---

## Project lifecycle

1. **Start**: Create `projects/<name>/_moc.md` from `project.md` template. Status: `active`. Append to [[log]] and [[index]].
2. **Active**: All project docs (design, decisions, notes) live under `projects/<name>/`. Diagrams in `projects/<name>/diagrams/`.
3. **Mature**: As the project produces durable lessons (e.g. "the way we do paging," "our error handling pattern"), distill them to wiki pages or `guides/` so future projects can reuse.
4. **End**: Mark `_moc.md` status as `done`. Move folder to `archive/<name>/`. Wiki pages and guides remain; archive preserves the project's working notes.
