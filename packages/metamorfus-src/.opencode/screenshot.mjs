// Render the 3D dashboard via headless Chromium and write a PNG.
// Uses the playwright npm package installed globally.

import { chromium } from "/usr/local/lib/node_modules/playwright/index.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.resolve(__dirname, "../public/dashboard.html");
const OUT_DIR = path.resolve(__dirname, "../public");
const OUT = path.join(OUT_DIR, "dashboard-screenshot.png");

const browser = await chromium.launch({
  headless: true,
  executablePath: "/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome",
  args: [
    "--use-gl=swiftshader",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--disable-dev-shm-usage",
    "--no-sandbox",
  ],
});

const context = await browser.newContext({
  viewport: { width: 1280, height: 1280 },
  deviceScaleFactor: 2, // crisp Retina-style render
});
const page = await context.newPage();
await page.goto("file://" + HTML, { waitUntil: "networkidle" });
// Wait for WebGL initialization and a few animation frames so the
// ribbons have visibly settled into their loop positions.
await page.waitForTimeout(2200);

// Verify the canvas is rendering pixels (not all black).
const hasContent = await page.evaluate(() => {
  const c = document.querySelector("#canvas-root");
  if (!c) return false;
  const ctx = c.getContext("webgl2") || c.getContext("webgl");
  if (!ctx) return false;
  const pixels = new Uint8Array(4);
  ctx.readPixels(
    Math.floor(c.width / 2),
    Math.floor(c.height / 2),
    1, 1,
    ctx.RGBA,
    ctx.UNSIGNED_BYTE,
    pixels,
  );
  return pixels[0] + pixels[1] + pixels[2] > 0;
});
console.log("[debug] webgl center has content:", hasContent);

await page.screenshot({ path: OUT, fullPage: false, type: "png" });
console.log("[done] wrote", OUT);
await browser.close();
