---
type: reference
title: Excalidraw — diagram workflow
created: 2026-05-13
updated: 2026-05-13
tags: [reference, tooling]
---

# Excalidraw diagram workflow

This vault uses **direct `.excalidraw` JSON generation** for diagrams, with a local Node + Playwright renderer for visual verification. We do **not** use Mermaid blocks, and we do **not** use the `ExcalidrawAutomate` plugin API.

## Why this approach

- JSON is stable, documented, and produces native Excalidraw files the user can edit.
- Generating JSON statically (no plugin globals, no Obsidian-running dependency) keeps failure modes low.
- A render-to-PNG step lets the agent **see** its own output and iterate on layout before showing the user.

## File locations

- **Diagrams**: alongside the doc they illustrate. For projects: `projects/<name>/diagrams/<diagram>.excalidraw`. For wiki entries: `wiki/<entity>-<purpose>.excalidraw` next to the page.
- **Renderer tool**: `meta/tools/render-excalidraw.js` (Node + Playwright).
- **Generated PNGs**: same folder as the source `.excalidraw`, same name with `.png` extension. PNGs are committed alongside JSON — they're cheap and let the user preview without opening Obsidian.

## File naming

- Source: `<topic>.excalidraw` (no `.md` extension — the Obsidian plugin reads both `.excalidraw` and `.excalidraw.md`; we prefer the plain `.excalidraw` form for tool compatibility).
- Render: `<topic>.png`.

## JSON schema (minimum)

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://excalidraw.com",
  "elements": [ /* element objects */ ],
  "appState": {
    "viewBackgroundColor": "#ffffff",
    "gridSize": null
  },
  "files": {}
}
```

Full schema: <https://docs.excalidraw.com/docs/codebase/json-schema>.

## Element types we use

| Type | Fields beyond `x/y/width/height/id/seed/version/versionNonce` |
|---|---|
| `rectangle` | `strokeColor`, `backgroundColor`, `fillStyle`, `strokeWidth`, `roughness`, `roundness` |
| `ellipse` | same as rectangle |
| `diamond` | same as rectangle (for decision nodes) |
| `text` | `text`, `fontSize`, `fontFamily`, `textAlign`, `verticalAlign`, `containerId` (to bind inside a shape) |
| `arrow` | `points: [[x1,y1],[x2,y2]]`, `startBinding`, `endBinding`, `startArrowhead`, `endArrowhead` |
| `line` | `points: [[x1,y1],...]` |

Required fields on every element: `id` (random string), `seed` (random int), `version` (1), `versionNonce` (random int), `isDeleted` (false), `groupIds: []`, `frameId: null`, `boundElements: null`, `updated` (timestamp), `link: null`, `locked: false`.

## Workflow per diagram

1. **Plan** — sketch the layout mentally: how many nodes, rough grid positions, connections.
2. **Write JSON** — produce the `.excalidraw` file. Use the layout patterns below.
3. **Render** — run `node meta/tools/render-excalidraw.js path/to/diagram.excalidraw`.
4. **Inspect the PNG** — read it via the Read tool. Check: overlapping shapes? Arrows hitting the right anchors? Text spilling outside boxes?
5. **Iterate** — fix JSON, re-render, re-check. Don't show the user until it actually looks right.
6. **Commit** — both the `.excalidraw` source and the `.png` render.

## Layout patterns

Standardize so we don't reinvent layout math every time. All units in px.

### Constants
- Default box: `width: 200, height: 80`
- Horizontal spacing between boxes (same row): `100px` gap (so box-to-box x-step = 300)
- Vertical spacing between rows: `60px` gap (so box-to-box y-step = 140)
- Arrow margin from box edge: `0` (bind directly to the box)

### Horizontal flow (left→right)
- Boxes at `y = 0`, `x = 0, 300, 600, ...`
- Arrows: `x1 = boxX + 200, x2 = nextBoxX, y = 40` (vertically centered).

### Vertical stack (top→down)
- Boxes at `x = 0`, `y = 0, 140, 280, ...`
- Arrows: `y1 = boxY + 80, y2 = nextBoxY, x = 100`.

### Grid
- Compute `x = col * 300`, `y = row * 140`.

### Centering text
Text bound to a container (`containerId: <box-id>`) auto-centers. For free text, pick `x = boxX + (boxWidth - estimatedTextWidth) / 2`, `y = boxY + 30`.

## Renderer tool

See [[../tools/README]] for setup. Quick usage:

```bash
cd meta/tools
node render-excalidraw.js ../../projects/foo/diagrams/architecture.excalidraw
# → writes architecture.png next to the source
```

## Gotchas

- **`id` must be unique per element**. Reusing ids breaks Excalidraw's element resolution silently. Use random strings (e.g. timestamp+random suffix).
- **Bindings require valid ids**. `arrow.startBinding.elementId` must match an existing element's `id`, or the arrow renders disconnected.
- **`appState.viewBackgroundColor`** controls the canvas background. Set to `#ffffff` for clean PNG exports.
- **`files: {}`** is required even when empty; omitting it breaks some Excalidraw versions.
- **Long text in boxes needs `roundness: null`** if you want sharp corners, or `{ type: 3 }` for the default rounded style.

## When NOT to use this

- For diagrams smaller than 3 elements, it's faster for the user to draw by hand. Suggest that and offer to write the prose around it.
- For diagrams the user wants to actively edit (whiteboarding sessions), let them drive — we generate the initial structure if asked, but step back.
