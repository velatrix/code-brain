---
type: project
title: Spectium
created: 2026-07-05
updated: 2026-09-12
status: active
tags: [project, spectium, testing, saas]
---

# Spectium

## Goal

Multi-tenant SaaS (and on-prem distributable) visual test automation platform: users author tests as node-graph "flows" in a web editor; server-side runners execute them against real browsers (Playwright) and Android devices (Appium/UiAutomator2); results stream live and persist for history, reporting, traceability, and CI integration.

## Status

As of 2026-09-12: the Applications rework (AP1–AP4), Multi-App Flows (MA0–MA5), Device Profiles (DP0–DP6), Capacity Awareness (CA0–CA7), Scheduling (SC0–SC5) and Run Reports (R0–R5) are all implemented and committed on `main`, and the backend adopted the [[vappcore|VAppCore]] package in place of its vendored query layer (repo BACKLOG B13, 2026-09-12). Owed across initiatives: the manual browser passes, `helm template`, the on-device multi-app walk. Open backlog: B2 (cross-tenant user endpoints, security), B11 (CI trigger by group), B12 (notifications), B14/B15 (two UI truncations).

**The repo is the source of truth for all design docs** — `F:\Projects\TestUp` (product name is Spectium; folder name is legacy): `ARCHITECTURE.md`, `TARGET-ARCHITECTURE.md`, `ANDROID-RUNNER.md`, `ENVIRONMENTS.md`, `BACKLOG.md` (cross-session work items), `Backend/Docs/*`. This vault folder holds only cross-cutting research and lessons worth keeping outside the repo.

## Map

- Design docs: in the repo (see above), not the vault
- Working notes: `notes/`
  - [[projects/spectium/notes/market-research-project-structure|Market Research: Multi-Platform Project Structure]] — 5-agent web research validating the Applications design (2026-07-05)

## Key entities & concepts

- [[vappcore]] — the backend builds on it (MVC filters, VQueryParser pagination/filtering)

## Open questions

- None held in the vault; open design questions live in the repo initiative docs and `BACKLOG.md`

## Milestones

- [x] `APPLICATIONS.md` design doc in the repo (ENVIRONMENTS.md-style: model, semantics, UI projections, migration, phases) — done, AP1–AP4 implemented
