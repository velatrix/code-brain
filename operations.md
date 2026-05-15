# Operations

The named workflows agents perform in the vault.

---

## Ingest

The user drops a source into `raw/` (or asks "ingest this URL"). The agent:

1. Reads the source
2. Discusses key takeaways with the user
3. Writes a summary page in `wiki/<source-slug>.md` (template: `wiki-summary.md`)
4. Updates relevant entity/concept pages in `wiki/` (touching 5–15 wiki pages is normal)
5. Appends an entry to [[log]]: `## [YYYY-MM-DD] ingest | <title>`
6. Adds an entry to [[index]] under the appropriate section

---

## Query

The user asks a question against the vault. The agent:

1. Reads [[index]] first to find relevant pages
2. Drills into those pages
3. Synthesizes an answer with citations to wiki pages (use `[[wiki-link]]` format)
4. **File-back rule**: if the synthesis is substantive (a comparison, an analysis, a discovered connection), save it as a new wiki page. Don't let valuable explorations die in chat.

---

## Lint

On user request ("lint the wiki"), the agent health-checks:

- Contradictions between pages
- Stale claims newer sources have superseded
- Orphan pages (no inbound links)
- Important concepts mentioned but lacking their own page
- Missing cross-references
- New questions to investigate and sources to look for

Output: a report in `meta/_claude/lint-YYYY-MM-DD.md` plus actionable suggestions.

---

## Inbox triage

`inbox/` is for **quick capture**, not permanent residence. When the user drops a note (or asks to "save this for later"):

1. Write to `inbox/<short-name>.md` with minimal frontmatter (just `type: inbox` and `created:`)
2. On a separate session (or when prompted), triage: move to the correct permanent home, update frontmatter, link from relevant places.
3. Inbox should be near-empty at rest. If it has >10 items, the user is overdue for a triage pass — surface this.
