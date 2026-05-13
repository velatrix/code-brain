---
type: reference
title: meta/tools
created: 2026-05-13
updated: 2026-05-13
tags: [reference, tooling]
---

# meta/tools

Executable scripts for the vault. Auditable, kept short, language pinned to Node where possible (aligns with Obsidian's Electron/JS ecosystem).

## Tools

### render-excalidraw

Renders an `.excalidraw` JSON file to PNG so agents can verify diagrams before showing the user. See [[../references/excalidraw|the Excalidraw reference]] for the full workflow.

**Setup (one-time):**

```bash
cd meta/tools
npm install
npx playwright install chromium
```

**Usage:**

```bash
node render-excalidraw.js <input.excalidraw> [output.png]
```

If `output.png` is omitted, output is written next to the input with `.png` extension.

**How it works:**

1. Loads `render-host.html` in headless Chromium via Playwright.
2. The page imports `@excalidraw/excalidraw` from the [esm.sh](https://esm.sh) CDN (no bundler needed).
3. The script reads the `.excalidraw` JSON, calls `window.renderScene()` which invokes `exportToBlob`.
4. The blob is converted to a base64 data URL, returned to Node, decoded, and written to disk.

**Status: verified working** (first render on 2026-05-13 produced `wiki/vappcore-architecture.png` correctly).

Implementation notes:
- Uses `@excalidraw/utils` (NOT `@excalidraw/excalidraw`) — utils is the headless utility package, no React component bloat.
- The URL is unpinned (`https://esm.sh/@excalidraw/utils`) — esm.sh resolves to the latest. If a future Excalidraw release breaks the API, pin a known-good version (e.g. `@excalidraw/utils@0.1.x`).
- esm.sh URLs are cached by Playwright's browser cache; first run downloads, subsequent runs are fast.
- The renderer logs page console messages, page errors, and failed requests by default — useful when things break.

If it ever fails:
- Check page errors / requestfailed logs in stderr (the renderer already routes them).
- Try `https://esm.sh/@excalidraw/utils@latest` explicitly.
- Try the full `@excalidraw/excalidraw` package — it also exports `exportToBlob`.

## Adding new tools

- One folder per tool if it has multiple files; single `.js` if it's standalone.
- Pin dependencies in `package.json`.
- Document setup and usage in this README.
- Keep tools auditable — short, readable, no obfuscation.
