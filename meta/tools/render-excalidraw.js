#!/usr/bin/env node
/**
 * render-excalidraw.js
 *
 * Renders an .excalidraw JSON file to PNG so agents can verify diagrams
 * before showing them to the user.
 *
 * Usage:
 *   node render-excalidraw.js <input.excalidraw> [output.png]
 *
 * If output.png is omitted, the PNG is written next to the input with .png extension.
 *
 * Setup (one-time):
 *   cd meta/tools
 *   npm install
 *   npx playwright install chromium
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function render(inputPath, outputPath) {
  if (!fs.existsSync(inputPath)) {
    console.error(`Input not found: ${inputPath}`);
    process.exit(1);
  }

  const sceneJson = fs.readFileSync(inputPath, 'utf8');
  const finalOutput = outputPath ||
    inputPath.replace(/\.excalidraw(\.md)?$/i, '.png');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', (msg) => console.log(`[page.${msg.type()}]`, msg.text()));
  page.on('pageerror', (err) => console.error('[page.error]', err.message));
  page.on('requestfailed', (req) => console.error('[page.requestfailed]', req.url(), req.failure()?.errorText));

  const hostUrl = 'file://' + path.resolve(__dirname, 'render-host.html').replace(/\\/g, '/');
  await page.goto(hostUrl);
  await page.waitForFunction(() => window.__ready === true, { timeout: 15000 });

  const dataUrl = await page.evaluate(async (json) => {
    return await window.renderScene(json);
  }, sceneJson);

  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(finalOutput, Buffer.from(base64, 'base64'));

  console.log(`Rendered: ${finalOutput}`);
  await browser.close();
}

const [, , input, output] = process.argv;
if (!input) {
  console.error('Usage: node render-excalidraw.js <input.excalidraw> [output.png]');
  process.exit(1);
}

render(input, output).catch((err) => {
  console.error(err);
  process.exit(1);
});
