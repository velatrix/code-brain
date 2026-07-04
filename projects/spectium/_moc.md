---
type: project
title: Spectium
created: 2026-07-05
updated: 2026-07-05
status: active
tags: [project, spectium, testing, saas]
---

# Spectium

## Goal

Multi-tenant SaaS (and on-prem distributable) visual test automation platform: users author tests as node-graph "flows" in a web editor; server-side runners execute them against real browsers (Playwright) and Android devices (Appium/UiAutomator2); results stream live and persist for history, reporting, traceability, and CI integration.

## Status

Currently: designing the **Applications** project-structure rework — one project holding N platform-typed applications; spec artifacts (requirements/test cases) project-owned with per-app applicability; execution artifacts (flows, builds, suites, runs) bound to one application. Market research validating the direction is done (see notes).

**The repo is the source of truth for all design docs** — `F:\Projects\TestUp` (product name is Spectium; folder name is legacy): `ARCHITECTURE.md`, `TARGET-ARCHITECTURE.md`, `ANDROID-RUNNER.md`, `ENVIRONMENTS.md`, `BACKLOG.md` (cross-session work items), `Backend/Docs/*`. This vault folder holds only cross-cutting research and lessons worth keeping outside the repo.

## Map

- Design docs: in the repo (see above), not the vault
- Working notes: `notes/`
  - [[projects/spectium/notes/market-research-project-structure|Market Research: Multi-Platform Project Structure]] — 5-agent web research validating the Applications design (2026-07-05)

## Key entities & concepts

- [[vappcore]] — the backend builds on it (MVC filters, VQueryParser pagination/filtering)

## Open questions

- Applications design: modules project-wide vs per-app; env vars per-app overrides; web "version under test" identity — tracked in the repo design discussion

## Milestones

- [ ] `APPLICATIONS.md` design doc in the repo (ENVIRONMENTS.md-style: model, semantics, UI projections, migration, phases)
