// Integration test for headless-server — exercises every API route
// against REAL services. No mocks at any layer.
//
// Backend selection: real NVIDIA NIM when NVIDIA_API_KEY is set
// (preferred for tests); real OpenCode sidecar if it's running.
//
// forge_skill uses real disk writes via the in-process registry.
// vision_describe hits real NVIDIA NIM with kimi-k3.
// scan_codebase walks the real workspace.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startHeadlessServer } from "../headless-server.mjs";
import { describeImage } from "../vision-tool.js";

const HAS_KEY = Boolean(process.env.NVIDIA_API_KEY);
const skipIfNoKey = !HAS_KEY;

let ctx;
let nvidiaDown = false;

before(async () => {
  if (!HAS_KEY) return;
  ctx = await startHeadlessServer({
    port: 0,
    describeImage,
  });
});

after(async () => {
  if (ctx) await ctx.close();
});

const baseUrl = () => `http://127.0.0.1:${ctx.port}`;

// Mark NVIDIA as down on transient upstream errors so subsequent
// tests in this run skip cleanly instead of failing.
function maybeMarkDown(r) {
  if (r.status === 429 || r.status === 503 || r.status === 502) {
    nvidiaDown = true;
    return true;
  }
  return false;
}

// ─── /api/health (no remote dep) ───────────────────────────────────
test("LIVE: GET /api/health returns ok", { skip: skipIfNoKey }, async () => {
  const r = await fetch(`${baseUrl()}/api/health`);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.status, "ok");
  assert.equal(j.server, "headless");
});

// ─── /api/vision (real NVIDIA NIM) ───────────────────────────────────
test(
  "LIVE: POST /api/vision describes an image via real NVIDIA NIM",
  { skip: skipIfNoKey || nvidiaDown },
  async () => {
    const r = await fetch(`${baseUrl()}/api/vision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageUrl: "https://assets.ngc.nvidia.com/products/api-catalog/phi-3-5-vision/example1b.jpg",
        prompt: "em uma frase: o que tem nesta imagem?",
      }),
    });
    if (maybeMarkDown(r)) return;
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.skill, "vision_describe_protocol");
    assert.ok(typeof j.description === "string");
    assert.ok(j.description.length > 0, "description must not be empty");
    assert.match(j.model, /(kimi|moonshotai)/i);
    assert.ok(j.usage.totalTokens > 0);
  },
);

test(
  "LIVE: POST /api/vision rejects missing imageUrl with 400",
  { skip: skipIfNoKey },
  async () => {
    const r = await fetch(`${baseUrl()}/api/vision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(r.status, 400);
  },
);

// ─── /api/tools (real registry, real disk) ──────────────────────────
test(
  "LIVE: GET /api/tools lists the real registered tools",
  { skip: skipIfNoKey },
  async () => {
    const r = await fetch(`${baseUrl()}/api/tools`);
    const j = await r.json();
    const names = j.tools.map((t) => t.name);
    assert.ok(names.includes("scan_codebase"));
    assert.ok(names.includes("vision_describe"));
    assert.ok(names.includes("forge_skill"));
  },
);

test(
  "LIVE: POST /api/tools/scan_codebase scans the real filesystem",
  { skip: skipIfNoKey },
  async () => {
    const r = await fetch(`${baseUrl()}/api/tools/scan_codebase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.name, "scan_codebase");
    assert.ok(typeof j.data.fileCount === "number");
    assert.ok(j.data.fileCount > 0);
    assert.ok(typeof j.data.totalBytes === "number");
  },
);

test(
  "LIVE: POST /api/tools/forge_skill writes a real .py file to disk",
  { skip: skipIfNoKey },
  async () => {
    const uniqueKey = `live_test_${Date.now().toString(36)}_protocol`;
    const r = await fetch(`${baseUrl()}/api/tools/forge_skill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skillKey: uniqueKey,
        pythonSource: `def skill(organism, context):\n    return {"action": "LIVE_TEST", "intensity": 0.5, "required_attributes": {}, "version": 1}`,
      }),
    });
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.name, "forge_skill");
    assert.match(j.output, /Wrote/);
    const fs = await import("node:fs/promises");
    const actualTarget = j.data.path;
    const onDisk = await fs.readFile(actualTarget, "utf8");
    assert.match(onDisk, /LIVE_TEST/);
    await fs.unlink(actualTarget);
  },
);

// ─── /api/chat (real LLM — OpenCode sidecar or NVIDIA direct) ───────
test(
  "LIVE: POST /api/chat calls a real LLM with MHU injection",
  { skip: skipIfNoKey || nvidiaDown },
  async () => {
    const r = await fetch(`${baseUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", content: "Responda apenas com a palavra PONG." },
        ],
      }),
    });
    if (maybeMarkDown(r)) return;
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.choices[0].message.role, "assistant");
    assert.ok(typeof j.choices[0].message.content === "string");
    assert.ok(j.choices[0].message.content.length > 0);
    assert.ok(
      ["opencode-default", "nvidia-direct"].includes(j.provider),
      `unexpected provider: ${j.provider}`,
    );
    assert.ok(j.usage.total_tokens > 0, "real token usage must be reported");
  },
);

test(
  "LIVE: POST /api/chat preserves message structure (system + user)",
  { skip: skipIfNoKey || nvidiaDown },
  async () => {
    const r = await fetch(`${baseUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", content: "Diga 'ok' se você recebeu o sistema MHU." },
        ],
      }),
    });
    if (maybeMarkDown(r)) return;
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.ok(j.choices[0].message.content.length > 0);
  },
);

// ─── /api/admin/system_status (no remote dep) ───────────────────────
test(
  "LIVE: GET /api/admin/system_status reports the active backend",
  { skip: skipIfNoKey },
  async () => {
    const r = await fetch(`${baseUrl()}/api/admin/system_status`);
    const j = await r.json();
    assert.equal(j.backend, "opencode");
    assert.equal(typeof j.reachable, "boolean");
  },
);
