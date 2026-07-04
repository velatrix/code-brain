---
type: research
title: "Market Research: Multi-Platform Project Structure in Test & Work Management Tools"
created: 2026-07-05
updated: 2026-07-05
tags: [research, spectium, market-research, project-structure, test-management]
---

# Market Research: Multi-Platform Project Structure in Test & Work Management Tools

## Question

Spectium must decide how customers organize a product that spans multiple apps/platforms (e.g. web + Android of the same product). Candidate structures:

- **(a) One project + "Application" dimension** — spec artifacts (requirements, test cases) project-owned with per-app *applicability*; execution artifacts (flows, builds, suites, runs) bound to exactly one application; per-app coverage matrix.
- **(b) Sub-project hierarchies** (Redmine-style parent/child containers).
- **(c) Separate projects per platform.**

Design analysis favored (a). This research checked that lean against real practitioner sentiment: what do users of Jira, Redmine, Azure DevOps, and dedicated test-management tools actually like, complain about, and converge on?

**Method:** five parallel research agents (2026-07-05), each assigned one territory, instructed to read actual discussion threads (not search snippets) and report verbatim quotes with URLs. ~90 threads read across Atlassian Community, redmine.org forums + issue tracker, r/azuredevops (via the pullpush.io archive API — reddit.com blocks direct fetching), Microsoft Learn/Developer Community, Ministry of Testing Club, and vendor docs. Accessibility caveats in "Research gaps" below.

## Verdict

| Option | Verdict | Strongest evidence |
|---|---|---|
| (a) One project + app dimension | **Validated by all five sources independently** | Jira consensus for same-product/same-team; Redmine admins hand-roll "app as a field"; ADO consolidation reversal stories + Microsoft's own guidance; TestLink/TestRail/Xray each built exactly this; QA practitioners: "don't fork the spec" |
| (b) Sub-project hierarchy | **Refuted where it exists, absent where it doesn't** | Redmine's own 15-year unresolved sharing/rollup requests; Jira's 19-year Won't Fix; ADO nested-team footguns; nobody in QA forums proposes hierarchy for multi-platform |
| (c) Separate projects per platform | **Legitimate niche with specific triggers** | Atlassian's own iOS/Android teams — but always org topology (release cadence, separate teams, hard isolation), never "we want duplicate specs" |

**The universal split triggers** (identical across Jira, ADO, Redmine): hard permission isolation, independent release cadence, genuinely separate teams/process. Product architecture never appears as a reason to split. Spectium's answer for those teams — separate projects, one app each — matches what they already choose elsewhere.

**The reversibility asymmetry** (most decision-relevant single fact): splitting later is cheap, merging later is expensive-to-impossible. ADO has no native project merge, test cases can't move cleanly across projects, and a 1,351-vote cross-project dashboard request sat unresolved 5+ years. Starting unified is the safe default *because it is the reversible one*. Greenfield opportunity: "merge two projects into one as two applications" is tractable under the applicability model where ADO/Jira structurally can't offer it.

## Findings

### Jira (~25 threads, mostly Atlassian Community)

- **Consensus for our exact scenario**: same product + same team → one project, platforms as components/fields, filtered boards. *"Since you are working on the same product with same team, using a single project will be a more suitable approach"* (Deepanshu Natani, 2020). *"One project for the product unless the components can and will be versioned and released independently"* (Jack Brickey, 2017). *"Single backlog, single sprint, single source of truth"* (Thorsten Letschert, 2025). A 10-person web+iOS+Android team was told: one project, components as a multi-select "Platform Impacted" field (Ste Wright, Community Champion).
- **Sub-projects: 19 years of demand, permanently refused.** JRASERVER-12241 ("Support for Product Suites / Sub-Projects", filed 2007, 332 votes) closed **Won't Fix** in 2011; the recurring community answer ever since is components/epics/categories/paid-Advanced-Roadmaps. Flat structure + dimensions absorbed the demand without becoming a business problem for Atlassian.
- **The legitimate minority**: Atlassian's own Jira Mobile team uses **two projects** for iOS/Android — *"different release cycles and different release versions, different story points estimations"* (Carlos Khachikian, Atlassian team lead, 2019). Independent experts also recommend separate projects when **permission isolation** matters: Browse Project boundaries beat Issue Security Schemes for maintainability (Ravi Sagar, 2022).
- **Pains of separate-projects**: fixVersion/release fragmentation (*"so many views/reports in jira rely on fixversion"*), backlog becoming *"just a big long list"* on consolidated boards, cross-platform epic visibility. Native Jira can't share releases across projects at all.
- **Pains of one-project**: coarse permission granularity (the #1 defection driver), multi-component auto-assignment broken, every "stay together" answer requires hand-building quick filters/swimlanes — i.e., per-dimension views are bolted on, not native.
- **Decision heuristic repeated across threads**: team/process topology decides, not product architecture.

Key threads: [iOS+Android same app](https://community.atlassian.com/forums/Jira-questions/How-do-you-best-organize-iOS-and-Android-development-of-the-same/qaq-p/592062), [components vs projects](https://community.atlassian.com/forums/Jira-questions/Should-I-use-multiple-projects-or-components/qaq-p/1491707), [one vs multi for same product](https://community.atlassian.com/t5/Jira-Software-questions/One-project-vs-multi-project-for-same-product/qaq-p/1747108), [JRASERVER-12241](https://jira.atlassian.com/browse/JRASERVER-12241), [platform products](https://community.atlassian.com/forums/Jira-questions/Managing-platform-products-on-Jira/qaq-p/1441528), [multiple projects pain](https://community.atlassian.com/t5/Jira-Software-discussions/How-do-you-deal-with-multiple-projects/td-p/1609794), [projects for permissions](https://community.atlassian.com/t5/Jira-Software-questions/Multiple-projects-or-multiple-boards-components-in-Jira/qaq-p/1912051), [best practices article](https://community.atlassian.com/forums/Jira-articles/Best-Practices-Strategies-for-Defining-your-JIRA-Projects/ba-p/603061)

### Redmine (~23 threads/tickets, redmine.org forums + tracker)

- **Sub-projects are liked only for hard organizational separation** — Eric Davis's (core contributor) four-part test: *"Multiple deliverables, different release cycles, different versioning, separate teams."* Client-per-parent patterns work fine. This maps to "separate Spectium projects", not to platform splits within one product.
- **The predicted hierarchy tax is confirmed with long paper trails**: category sharing across subprojects is a **15-year-old, 119-comment, 60+ vote, still-open** request (#5358); version inheritance still unresolved (#465) with three confusing sharing scopes needing a permission matrix to explain; Reports/Summary excluded subprojects for years (#7970) and the fix is one crude global toggle (#17116); the subproject filter itself has a still-open OR-logic bug with three independent duplicate reports (#3952); member inheritance only arrived in 2.3.0 and every other dimension stayed un-inherited.
- **The single-parent tree fails exactly our scenario**: a company with separate Website/iPhone/Android projects needing shared cross-cutting work said the gap *"pushed us to investigate competing products"* (2010, "MetaProjects" thread). Redmine's oldest high-vote unresolved request is **multiple parent projects** (#5283, ~16 years) — structurally "one artifact applies to several containers", i.e., the applicability shape.
- **Experienced admins converge on dimensions, not containers**: *"custom fields may help... a custom field for all issues of type 'list'"* (Ivan Cenov, repeated across threads); a plugin ecosystem exists to reify "project" as a selectable **field** on issues. Practitioners independently reinvented applications-as-dimension as a workaround.
- Deep nesting produced real harm: corrupted nested-set nearly deleting the wrong project (#3722); "cumbersome very quickly" views (#5938); community split on whether to even allow depth limits.

Key threads: [when to use subprojects](https://www.redmine.org/boards/1/topics/23075), [intertwined projects](https://www.redmine.org/boards/2/topics/2906), [MetaProjects request](https://www.redmine.org/boards/1/topics/16060), [#5283 multiple parents](https://www.redmine.org/issues/5283), [#5358 shared categories](https://www.redmine.org/issues/5358), [#3952 filter bug](https://www.redmine.org/issues/3952), [#7970 report totals](https://www.redmine.org/issues/7970), [project-as-field plugin](https://www.redmine.org/plugins/redmine_project_custom_field), [multiple products thread](https://www.redmine.org/boards/1/topics/24432)

### Azure DevOps (~19 Reddit threads via archive API + Microsoft docs/Developer Community)

- **Microsoft's own guidance**: *"One recommended approach is to use a single project to support your organization... Even if you have many teams working on hundreds of different applications... A project isolates the data stored within it, and moving data from one project to another results in the loss of associated history."* Microsoft's Developer Division (~2,000 engineers) and Windows (~15,000) each run **one** project (Martin Hinshelwood/nkdagility).
- **Practitioner reversal stories** (strongest evidence type): *"We have gone from 1 Org with 4-5 large highly customised projects, to just 1 Org with 1 single project"*; *"When I did my pilot I created projects for everything but quickly realised it would be a maintenance issue"*; *"The fewer projects the better. It's easier to branch out to new ones than consolidate."*
- **Splitting is a one-way door**: no native project merge (*"it is not possible to merge two Azure DevOps projects"* — Microsoft moderator); **test cases explicitly can't move across projects** (work item type disabled for move — copy one-by-one or CSV); pipelines can't reach other projects' repos; the cross-project dashboard request has **1,351 votes, 5+ years unresolved**; a migration-tooling cottage industry exists to paper over the boundary.
- **The minority carve-out is about external isolation**, not platforms: *"Use 1 project for everything unless some groups realllyyyy don't get along... or there's security concerns"*; *"For Customer projects we always create a new project in order to be able to invite the customers users."*
- **Area-paths/teams (scope-as-dimension) works but its mechanics are the footgun catalog**: a real "All 3 apps → app1/app2/app3" area hierarchy works for filtering, but — silent invisibility (a team must explicitly own an area path before items appear in its views), deny-wins permission surprises on overlapping scopes, per-node backlog ordering conflicts (*"you cannot have nested Teams with nested Backlogs"*), the cross-project-query opt-in checkbox nobody finds, and a 188-vote request to stop overloading area paths as team boundaries (Microsoft: *"no immediate plans"*). Area-path **reorganization is disruptive** — changes existing work items, breaks historical trend charts.
- The successful recurring pattern is exactly shape (a): *"1 team for each client so they get their own backlog. Each team may be assigned 1..N areas. Then one 'dev' team assigned to all areas"*; *"Our default is everyone can read everything. It takes a documented exception to have a team's items hidden."*

Key sources: [MS Learn: about projects](https://learn.microsoft.com/en-us/azure/devops/organizations/projects/about-projects?view=azure-devops), [one project to rule them all](https://nkdagility.com/resources/blog/should-you-use-one-project-to-rule-them-all-in-azure-devops/), [r/azuredevops: starting again](https://www.reddit.com/r/azuredevops/comments/1gqapph/), [r/azuredevops: areas & security](https://www.reddit.com/r/azuredevops/comments/1eidfk9/), [r/azuredevops: moving test cases](https://www.reddit.com/r/azuredevops/comments/1gxkcof/), [no project merge](https://learn.microsoft.com/en-us/answers/questions/1336145/is-it-possible-to-merge-two-projects-in-ado-they-a), [1,351-vote dashboard request](https://developercommunity.visualstudio.com/t/single-dashboard-for-multiple-projects/365500), [team fields vs area paths](https://developercommunity.visualstudio.com/t/use-team-fields-instead-of-area-paths-to-support-t/365897), [area path sprawl](https://www.reddit.com/r/azuredevops/comments/1jp3l0b/)

### Dedicated test-management tools (Xray, TestRail, Zephyr, TestLink)

- **Three independent tools implemented spec-shared/execution-per-platform as their anti-duplication feature**: TestLink **Platforms** (one spec, executed N times, counted N times in metrics), TestRail **Configurations** (*"often more efficient... [than] duplicating test cases for each system"* — vendor docs), Xray **Test Environments** (*"Avoid duplication of Tests... track coverage on each environment"*). A decade of market convergence on exactly design (a).
- **Xray's concept is used as we intend** (real case: 147 test cases × 3 environments) **but its aggregation layer is the top complaint**: a requirement's status shown **differently in seven UI surfaces** with identical filters (confirmed bug XRAY-5593); *"Xray coverage is very poorly implemented"* (user, 2023, after hitting duplicate coverage entries and executions created outside plans); the implicit cross-environment AND-rollup (*"For the test to have the status PASS, the last test execution of every environment has to be PASS"*) genuinely confused users expecting one passing run to mean PASS.
- **Executions bound to one environment/configuration is the industry-default shape** — Xray Test Execution per Test Environment, TestRail Run per Configuration (the latter via vendor docs; TestRail's forum is dead-linked post-migration, so practitioner sentiment there is unverified).
- **Shared-case divergence is a real need**: *"you won't be able to tweak shared test cases for any minor changes per project"* (Zephyr thread on centralizing test cases) — with no bulk-propagate tooling. Supports an explicit fork-on-divergence affordance.
- **Saved views must reference stable IDs**: Zephyr folder reorganization silently breaks reports that filter by folder path.
- **RTM demand is unmet**: real teams stack Jira + Xray + a third add-on (R4J) just to get requirement coverage dashboards; qTest dismissed as "expensive and process-heavy". A native requirement × app matrix is a competitive differentiator.
- Practitioner nuance: senior testers distrust count-based metrics as quality proxies (*"testing is not test cases"*) — the matrix should present as *verification status*, not "quality".

Key sources: [Xray test environments docs](https://docs.getxray.app/display/XRAY620/Working+with+Test+Environments), [reused test case results](https://community.atlassian.com/forums/Jira-questions/How-to-display-the-reused-test-cases-execution-result/qaq-p/1921805), [environment status query](https://community.atlassian.com/forums/Jira-questions/Xray-Test-Execution-Test-Environment-query/qaq-p/1084264), [seven-surface discrepancy](https://community.atlassian.com/forums/Jira-questions/Requirement-Test-Status-discrepancies-in-Jira-Xray-plug-in/qaq-p/1627199), [coverage complaints](https://community.atlassian.com/forums/Jira-questions/Xray-reporting-Test-Coverage-using-Tasks-and-Test-Plans/qaq-p/2477762), [Zephyr central store pros/cons](https://community.atlassian.com/forums/Jira-questions/What-are-the-pros-and-cons-of-storing-Zephyr-test-cases-across/qaq-p/2444247), [TestRail configurations](https://support.testrail.com/hc/en-us/articles/23043143013268-Configurations), [TestLink platforms](https://www.tutorialspoint.com/testlink/testlink_platforms.htm), [Xray all-in-one vs separated (MoT)](https://club.ministryoftesting.com/t/xray-users-do-you-prefer-all-in-1-project-or-separated-projets-approach/54562), [RTM tooling thread (MoT)](https://club.ministryoftesting.com/t/has-anyone-used-any-tools-not-excel-be-useful-for-creating-maintaining-requirements-traceability-matrix/74457)

### Tool-agnostic QA practice (Ministry of Testing, Atlassian Community)

- **Don't fork the spec** is the consensus among teams at scale: *"I've had to create a process to ensure testers are not creating dupes leading to a waste of effort"*; *"document functionality exactly once and link to it from anything else using that functionality"* (Kate Paulk).
- **Named practitioner pain matching our coverage matrix exactly**: *"Requirements and estimation do not include the combination to be testing but expectation was must work in all combination"* (Maithilee Chunduri, 2025) — the platform combination is assumed, not tracked; per-app applicability + matrix makes it explicit.
- **Hierarchy is absent from the discourse** as a multi-platform solution — not rejected; simply never proposed. The one vendor voice for separate projects per platform (Testmo's guide) is worded around "multiple apps/products" generically and doesn't address one-product-many-platforms.
- Where teams did split (Atlassian iOS/Android), the driver was **independent release cadence**, never a desire for duplicate specs → applications should carry their own release identity inside a shared project.
- Minority position: session-based/exploratory testers skip formal test case repositories entirely — the shared-vs-duplicated question is moot for them.

Key sources: [best TCM tool thread (MoT)](https://club.ministryoftesting.com/t/what-is-best-test-case-management-tool-you-have-used/68812), [organising test cases (MoT)](https://club.ministryoftesting.com/t/organising-test-cases/70677), [mobile testing world (MoT)](https://club.ministryoftesting.com/t/whats-happening-in-your-mobile-testing-world-right-now/86922), [one vs multiple projects for multiple applications](https://community.atlassian.com/forums/Jira-questions/Should-our-team-use-one-project-or-multiple-projects-for/qaq-p/3167652), [beyond hierarchical structures (PractiTest, vendor)](https://www.practitest.com/resource-center/blog/beyond-hierarchical-structures/)

## Design rules extracted (for the Applications design)

1. **One canonical coverage/status resolver** — every matrix cell, widget, and export calls the same service; never re-derive per surface. (Xray XRAY-5593: seven surfaces, seven answers.)
2. **No implicit cross-app rollup** — show decomposed per-app cells; if an aggregate "requirement verified?" exists, define and label its rule in the UI. (Xray's silent AND-across-environments confusion.)
3. **Per-app permissions modeled from day one** — nullable application scope on project membership (null = whole project), UI can ship later; default-visible with explicit exceptions, never deny-wins surprises or silent invisibility. (#1 defection driver in Jira; ADO's area-path lockouts.)
4. **Per-app dashboards/rollups native, not hand-rolled filters.** (Jira's top consolidation friction; ADO's 1,351-vote request.)
5. **Stable IDs in saved views/dashboards**, never mutable names/paths. (Zephyr folder reports; ADO area-path reorg trauma.)
6. **Applicability and suite membership are one relationship**, never two independently-editable lists. (Xray's duplicate coverage entries.)
7. **Fork-on-divergence for shared test cases** with a one-click "fork for this app" affordance; no master+override step system (needs diff/propagate tooling that historically rots). (Zephyr central-store thread.)
8. **Retroactive coverage attribution as a first-class action** — let existing runs count toward coverage after the fact. (Xray users hit walls.)
9. **Applications carry release identity** — Android has App Builds; decide what "version under test" means for web reporting. (Release cadence is the #1 legitimate split trigger.)
10. **Present the matrix as verification status, not "quality"** — senior testers distrust count-based quality proxies.

## Implications

- **Design (a) confirmed as Spectium's structure**: one project + N platform-typed applications; requirements/test cases project-owned with applicability sets; flows/builds/suites/runs app-bound; environment = project-level name+vars with per-app target bindings; single-app projects collapse the whole dimension in the UI.
- **The one research-driven change**: per-app access control promoted from "future valve" to "in the schema from the start" (rule 3).
- **Suites bound to one application** (user instinct + Xray/TestRail convergence) — cross-app regression = N suites over shared test cases, later orchestrated ("run these suites, one report"), never a mixed suite.
- **Separate projects remain first-class** for the legitimate triggers (isolation, cadence, separate teams) — one app each, UI collapses; cross-project requirement sharing stays explicitly deferred (org-level requirement spaces later, enabled but not implied by the applicability model).
- **Reversibility as a product feature**: consider a supported "merge projects into one project as applications" migration — competitors structurally can't.
- **Competitive positioning**: native requirement × app coverage matrix replaces a Jira+Xray+R4J duct-tape stack.

## Research gaps & caveats

- **Reddit and sqa.stackexchange were unfetchable** for most agents (only the ADO agent found a working archive API), so Atlassian Community, redmine.org, and Ministry of Testing carried the practitioner weight.
- **TestRail's forum is dead post-migration** (discuss.gurock.com → 404 chain; archive.org also blocked) — TestRail suite-mode sentiment is secondary paraphrase of vendor docs, not verified quotes. Dead-linked leads worth chasing manually: "Having same test as part of multiple testsuites, multiple platforms", "Configurations and the Need to have One Testcase".
- **Thin spots**: no direct testimony of teams hacking per-platform coverage with spreadsheets/labels (inferred from vendors building native features); team-topology ↔ tool-structure correlation rests on few named sources (release cadence, not team shape, is the evidenced variable).
- Two agents flagged instruction-looking text in tool results as possible prompt injection; on inspection these matched the harness's own system reminders. No action was taken on them either way.

## Open threads

- Chase the dead TestRail forum threads if suite-mode sentiment ever becomes decision-relevant.
- Open design decisions not settled by research: modules project-wide vs per-app; env vars per-app overrides; web "version under test" identity.
- Next artifact: `APPLICATIONS.md` design doc in the repo, citing this note as the research appendix.

## Sources

Per-section source lists above (all URLs read directly by the research agents, except where marked as secondary paraphrase). Full agent reports with complete per-thread quote extractions were produced in-session on 2026-07-05; this note is their durable distillation.
