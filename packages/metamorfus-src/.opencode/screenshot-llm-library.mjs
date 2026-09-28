// Screenshot the LLM Library panel of the new dashboard.
// Run AFTER the headless server has been started and seeded with
// several library entries (so the panel shows real configs).

import { chromium } from "/usr/local/lib/node_modules/playwright/index.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML = `file://${path.resolve(__dirname, "../public/dashboard.html")}`;
const OUT = "/workspace/screenshot-llm-library.png";

const browser = await chromium.launch({
  headless: true,
  executablePath: "/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("[browser]", m.text()); });

// Make the page talk to the running headless server (port from argv).
const port = Number(process.argv[2] ?? 3457);
const URL = `http://127.0.0.1:${port}/dashboard.html`;
console.log("[shot] navigating to", URL);

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

await page.click('[data-tab="llm-library"]');
await page.waitForTimeout(1500);

await page.screenshot({ path: OUT, fullPage: false });
console.log("[shot] wrote", OUT);
await browser.close();
