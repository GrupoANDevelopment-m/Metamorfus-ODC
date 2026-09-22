// Live integration test: end-to-end vision via the headless server.
//
// This is the "100% functional" check for the vision path: real HTTP
// fetch from a Node client → real headless-server.mjs → real NVIDIA
// NIM endpoint with moonshotai/kimi-k3. No mocks at any layer.
//
// Requires NVIDIA_API_KEY in the environment. Skipped when not set.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startHeadlessServer } from "../headless-server.mjs";
import { describeImage } from "../vision-tool.js";

const KEY = process.env.NVIDIA_API_KEY;
const skipIfNoKey = !KEY;

let ctx;

before(async () => {
  ctx = await startHeadlessServer({
    port: 0,
    describeImage,
  });
});

after(async () => {
  if (ctx) await ctx.close();
});

test("LIVE: headless server is reachable", async () => {
  const r = await fetch(`http://127.0.0.1:${ctx.port}/api/health`);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.status, "ok");
});

test(
  "LIVE: /api/vision describes an image via real NVIDIA NIM",
  { skip: skipIfNoKey },
  async () => {
    const r = await fetch(`http://127.0.0.1:${ctx.port}/api/vision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageUrl: "https://assets.ngc.nvidia.com/products/api-catalog/phi-3-5-vision/example1b.jpg",
        prompt: "Em uma frase: o que tem nesta imagem?",
      }),
    });
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.skill, "vision_describe_protocol");
    assert.equal(typeof j.description, "string");
    assert.ok(j.description.length > 20, "description must be substantive");
    assert.equal(typeof j.model, "string");
    assert.match(j.model, /(kimi|moonshotai)/i);
    assert.ok(j.usage && j.usage.totalTokens > 0, "real token usage must be reported");
  },
);

test(
  "LIVE: /api/vision handles unknown image URL gracefully",
  { skip: skipIfNoKey },
  async () => {
    const r = await fetch(`http://127.0.0.1:${ctx.port}/api/vision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl: "https://nonexistent-host-xyz.invalid/x.jpg" }),
    });
    // Should NOT crash; the upstream will return some 4xx/5xx which
    // gets surfaced as 502.
    assert.ok(r.status === 200 || r.status === 502);
  },
);

test(
  "LIVE: /api/tools/scan_codebase actually scans the real filesystem",
  { skip: skipIfNoKey ? false : false }, // doesn't need the API key
  async () => {
    // We pass through to the real registry which uses the workspace root.
    const r = await fetch(`http://127.0.0.1:${ctx.port}/api/tools/scan_codebase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.name, "scan_codebase");
    assert.ok(j.data);
    assert.ok(typeof j.data.fileCount === "number");
    // If we got here, the filesystem scan actually ran.
  },
);
