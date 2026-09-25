// Live integration test: end-to-end vision via the headless server.
//
// Real HTTP fetch → real headless-server.mjs → real NVIDIA NIM with
// moonshotai/kimi-k3. No mocks at any layer.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startHeadlessServer } from "../headless-server.mjs";
import { describeImage } from "../vision-tool.js";

const KEY = process.env.NVIDIA_API_KEY;
const skipIfNoKey = !KEY;

let ctx;
let nvidiaDown = false;

before(async () => {
  if (!KEY) return;
  ctx = await startHeadlessServer({ port: 0, describeImage });
  // Smoke check: if NVIDIA is unreachable (rate limit / outage) we set
  // nvidiaDown so dependent tests can skip.
  try {
    const r = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "ping" }],
        model: "moonshotai/kimi-k3",
        max_tokens: 4096,
        chat_template_kwargs: { enable_thinking: true },
      }),
    });
    if (!r.ok && (r.status === 429 || r.status === 503)) {
      nvidiaDown = true;
    }
  } catch {
    nvidiaDown = true;
  }
});

after(async () => {
  if (ctx) await ctx.close();
});

const baseUrl = () => `http://127.0.0.1:${ctx.port}`;

test("LIVE: headless server is reachable", { skip: skipIfNoKey }, async () => {
  const r = await fetch(`${baseUrl()}/api/health`);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.status, "ok");
});

test(
  "LIVE: /api/vision describes an image via real NVIDIA NIM",
  { skip: skipIfNoKey || nvidiaDown },
  async () => {
    const r = await fetch(`${baseUrl()}/api/vision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageUrl: "https://assets.ngc.nvidia.com/products/api-catalog/phi-3-5-vision/example1b.jpg",
        prompt: "Em uma frase: o que tem nesta imagem?",
      }),
    });
    if (r.status === 429 || r.status === 503) {
      nvidiaDown = true;
      return;
    }
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.skill, "vision_describe_protocol");
    assert.equal(typeof j.description, "string");
    assert.ok(j.description.length > 0, "description must not be empty");
    assert.match(j.model, /(kimi|moonshotai)/i);
    assert.ok(j.usage && j.usage.totalTokens > 0, "real token usage must be reported");
  },
);

test(
  "LIVE: /api/vision handles unknown image URL gracefully",
  { skip: skipIfNoKey || nvidiaDown },
  async () => {
    const r = await fetch(`${baseUrl()}/api/vision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl: "https://nonexistent-host-xyz.invalid/x.jpg" }),
    });
    assert.ok(
      r.status === 200 || r.status === 502 || r.status === 504,
      `expected 200/502/504, got ${r.status}`,
    );
  },
);

test(
  "LIVE: /api/tools/scan_codebase actually scans the real filesystem",
  { skip: skipIfNoKey },
  async () => {
    const r = await fetch(`${baseUrl()}/api/tools/scan_codebase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.name, "scan_codebase");
    assert.ok(j.data);
    assert.ok(typeof j.data.fileCount === "number");
    assert.ok(j.data.fileCount > 0);
  },
);
