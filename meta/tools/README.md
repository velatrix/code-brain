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

**Status: untested.** First diagram rendering will validate this. If it fails, common fixes:
- Bump the `@excalidraw/excalidraw` version pin in `render-host.html` (currently `0.17.0`).
- Check the esm.sh URL still resolves.
- Switch to a different CDN (`esm.run`, `skypack`) if esm.sh has issues.
- If `exportToBlob` isn't available in the bundled export, switch to `@excalidraw/utils` or render via the full React component.

## Adding new tools

- One folder per tool if it has multiple files; single `.js` if it's standalone.
- Pin dependencies in `package.json`.
- Document setup and usage in this README.
- Keep tools auditable — short, readable, no obfuscation.
