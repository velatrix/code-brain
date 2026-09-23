---
type: project
title: Spectium
created: 2026-07-05
updated: 2026-09-23
status: active
tags: [project, spectium, testing, saas]
---

# Spectium

## Goal

Multi-tenant SaaS (and on-prem distributable) visual test automation platform: users author tests as node-graph "flows" in a web editor; server-side runners execute them against real browsers (Playwright) and Android devices (Appium/UiAutomator2); results stream live and persist for history, reporting, traceability, and CI integration.

## Status

As of 2026-09-23: the Applications rework (AP1–AP4), Multi-App Flows (MA0–MA5), Device Profiles (DP0–DP6), Capacity Awareness (CA0–CA7), Scheduling (SC0–SC5), Run Reports (R0–R5), Android screen orientation (`ANDROID-RUNNER.md` A7, 2026-09-13) and Notifications (N0–N6, 2026-09-14: a schedule's outcome or a device going offline becomes an email or a chat webhook, which closed BACKLOG B12) are all implemented and committed on `main`, and the backend adopted the [[vappcore|VAppCore]] package in place of its vendored query layer (repo BACKLOG B13, 2026-09-12). Owed across initiatives: the manual browser passes, `helm template`, the on-device walks. Backlog: B2 and B10–B16 done; B1 and B3–B9 parked until the org/authz redesign; B17–B25 open.

Also on `main` since 2026-09-12 (`336a16d`): a second pair of **test targets** — `WebTestApps/vuestore` and `AndroidTestApps/flutterstore` over a shared `TestAppsApi/storeapi`. Where the login pair is deliberately backend-free, these have real state and make real requests, which is what makes the Network panel, `networkidle`, loading states and server-side failures testable at all. Building them surfaced three runner defects, each now with a fixture built to make it visible: **B16** an Android text selector could not match a Flutter label, though `Backend/Docs/AndroidNodes.md` and `flutterlogin`'s README both said it could (fixed 2026-09-14); **B17** the two frame nodes cannot act inside an iframe; **B18** a native browser dialog is auto-dismissed before a flow can answer it. **B19** is the owed pass of running these targets through Spectium itself.

**In progress: Map Interactions & Gestures** (repo `MAPS.md`, phases MI0–MI5, branch `feat/maps`). For Android flows it adds multi-finger gestures, coordinates that mean the same place on every device kind, a settle wait built into every gesture, location and route simulation, and markers found by their icon. The user's hard constraints: independent of the map SDK, no customer code, gestures first, no screenshot-baseline comparison, and no billing, so the first example app is MapLibre rather than Google Maps. MI0 (the plan, `903a5da`) and MI1 (`5721397`, 2026-09-23) are done: MI1 built `AndroidTestApps/maplibremaps` and ran sixteen device fact checks, which amended the plan and recorded B23–B25. Next: MI2 (gestures). The reusable lessons are in the 2026-09-23 [[log]] entry.

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
