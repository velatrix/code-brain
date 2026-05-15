# CodeBrain — Vault Schema

This file is the operating manual for the CodeBrain vault. Every agent (Claude Code, Codex, Gemini CLI, etc.) reads this first. If something here is wrong or unclear, fix it. This is a living document — update it as conventions emerge, and append a note to [[log]].

---

## Purpose

CodeBrain is a developer's second brain — an AI-maintained knowledge base for notes, designs, decisions, and cross-project synthesis. The owner is a software developer (assume technical fluency). The vault is **AI-first**: structure and conventions optimize for an LLM reading and writing notes; humans browse the rendered Obsidian view, agents work directly with the markdown.

---

## Important files

The root files an agent must know. `[[index]]` and `[[log]]` are touched on every meaningful operation; the rest are load-on-demand references.

**[[index]]** — the vault's content catalog. **Read it first** before any non-trivial operation. **Update it after** any meaningful add.

**[[log]]** — chronological, append-only record of vault operations. Append an entry after any meaningful operation.

**[[structure]]** — folder layout, naming conventions, linking rules. Read when you need to know **where** something goes.

**[[notes]]** — note types, frontmatter, per-type rules. Read when authoring a non-root note.

**[[operations]]** — named workflows. Invoked by prefixing the operation name with `:!`, e.g. `:!ingest <url>`, `:!query <question>`, `:!lint`, `:!triage`. When you see `:!<name>`, load this file and follow the matching workflow.

**[[playbooks]]** — project-type → guide router. Check every session when working on a project (frontend, backend, etc.), not only at project start.

In short: index = **what exists**, log = **what happened**, structure = **where**, notes = **how to shape a note**, operations = **how to do named work**, playbooks = **what to read for project type X**.

---

## Hard Rules

Non-negotiable. Never bend.

- **`raw/` is immutable.** Never modify or delete files in `raw/`. To annotate a source, write a wiki page about it.
- **Don't take action without clear instruction.** Wait for an explicit directive ("go", "yes", "apply", "do it") before acting. Acknowledgments like "makes sense", "good", "I agree" are not directives — they confirm understanding, not permission. **Especially during brainstorming**, do not start implementing — the user wants to talk through ideas and resolve questions before any code or writes happen. If they're still asking or discussing, you're still in talking mode.
- **Ask before vault writes.** Propose content and location, wait for confirmation before creating or modifying any vault file.
- **Don't overwrite human-authored content without confirming.** If a file has substantive prose the user wrote, ask before rewriting.

---

## Agent Rules

- **Use templates from `meta/templates/`** — don't invent note structure from scratch.
- **Generated drafts and scratch work go in `meta/_claude/`** — promote to permanent locations only after user review.
- **Update [[index]] and [[log]] on every meaningful operation** (ingests, new wiki pages, project starts/ends, lint passes).
- **Verify before claiming** — check current vault state when the user asks about something; memory from prior sessions can be stale.
- **Stay flat.** Deep folder nesting costs tokens.
- **Commit liberally** after meaningful changes. The vault is git-tracked.
- **Capture lessons from corrections.** When the user corrects an approach, distill the durable lesson and propose a new entry (usually in `guides/`).

---

## Tooling

- **Obsidian CLI** (built-in v1.12+): see [[meta/references/obsidian-cli]] for command reference and usage.
- **Dataview** (Obsidian plugin): live queries over frontmatter — see [[meta/references/dataview]] (TODO).
- **Templater** (Obsidian plugin): renders templates with dynamic content.
- **Excalidraw** (Obsidian plugin) + custom renderer: see [[meta/references/excalidraw]] for diagram generation workflow.
- **Git**: vault is tracked; `origin` → `git@github.com:velatrix/code-brain.git`. Commit after meaningful changes.

---

## When in doubt

1. Check the Important files above — most answers are in `[[structure]]`, `[[notes]]`, or `[[operations]]`.
2. Check `meta/references/` for deep how-tos (Obsidian CLI, Excalidraw, etc.).
3. Read [[index]] to see what already exists.
4. Ask the user.

If you encounter unfamiliar conventions, files, or branches, **investigate before deleting or overwriting** — it may be the user's in-progress work.

---

## Updating this document

CLAUDE.md is a living document. Update it when:
- A new convention is adopted
- An existing rule turns out to be wrong or incomplete
- New tooling is introduced
- A repeated agent mistake suggests a missing rule

When updating, also append a one-line entry to [[log]]:
`## [YYYY-MM-DD] schema | <what changed>`

Keep this file under ~250 lines. If a section grows depth, move it to a root file like [[structure]]/[[notes]]/[[operations]] or to `meta/references/`, and link from the Important files list.
