// Integration test for headless-server — exercises every API route
// without Vite or browser.
//
// Strategy: bypass MHU and OpenCode via dependency injection. We pass
// fake implementations of `complete`, `ping`, `describeImage`, and
// `MHU_5_ProtoODC` so the server logic runs end-to-end against the
// fake, but the HTTP plumbing and JSON contracts are real.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startHeadlessServer } from "../headless-server.mjs";

const fakeMhuEngine = {
  execute_pipeline(instruction) {
    return {
      causal_analysis: { cause: instruction, effect: "test-effect" },
      universal_laws: ["THERMODYNAMICS", "ENTROPY"],
      strategic_plan: { step1: "observe", step2: "decide" },
      recommendations: ["rec-A", "rec-B"],
      counterfactuals: { alt: "alt-outcome" },
    };
  },
};

const fakeBridge = {
  ping: async () => true,
  complete: async (req) => ({
    content: `echo: ${req.messages.at(-1)?.content}`,
    reasoning: "fake-reasoning",
    raw: null,
    model: req.model ?? "fake-model",
    provider: req.provider ?? "fake-provider",
    sessionId: "sess-1",
    usage: { promptTokens: 12, completionTokens: 5, totalTokens: 17 },
  }),
  executeBridgeTool: async (name, args) => {
    if (name === "throw_test") throw new Error("intentional tool error");
    return { output: `${name} ok`, data: { args, echoed: true } };
  },
  FALLBACK_TOOLS: [
    { name: "scan_codebase", description: "walk a dir tree" },
    { name: "vision_describe", description: "describe an image" },
    { name: "forge_skill", description: "write a new skill" },
  ],
};

const fakeDescribeImage = async (req) => {
  if (!req.imageUrl) throw new Error("imageUrl required");
  if (req.imageUrl.startsWith("fail:")) throw new Error("intentional-vision-error");
  return {
    description: `image of ${req.imageUrl}`,
    reasoning: "fake-reasoning",
    model: "fake-vision-model",
    usage: { promptTokens: 3, completionTokens: 7, totalTokens: 10 },
  };
};

let ctx;

before(async () => {
  ctx = await startHeadlessServer({
    port: 0, // ephemeral
    mhuEngine: fakeMhuEngine,
    opencodePing: fakeBridge.ping,
    opencodeComplete: fakeBridge.complete,
    executeBridgeTool: fakeBridge.executeBridgeTool,
    FALLBACK_TOOLS: fakeBridge.FALLBACK_TOOLS,
    describeImage: fakeDescribeImage,
    MHU_5_ProtoODC: function () { return fakeMhuEngine; },
  });
});

after(async () => {
  if (ctx) await ctx.close();
});

const baseUrl = () => `http://127.0.0.1:${ctx.port}`;

// ─── /api/health ────────────────────────────────────────────────────
test("headless: GET /api/health returns ok", async () => {
  const r = await fetch(`${baseUrl()}/api/health`);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.status, "ok");
  assert.equal(j.server, "headless");
});

// ─── /api/admin/system_status ───────────────────────────────────────
test("headless: GET /api/admin/system_status reports opencode", async () => {
  const r = await fetch(`${baseUrl()}/api/admin/system_status`);
  const j = await r.json();
  assert.equal(j.backend, "opencode");
  assert.equal(j.reachable, true);
});

// ─── /api/vision ────────────────────────────────────────────────────
test("headless: POST /api/vision describes an image URL", async () => {
  const r = await fetch(`${baseUrl()}/api/vision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl: "https://x/y.jpg" }),
  });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.skill, "vision_describe_protocol");
  assert.match(j.description, /image of https:\/\/x\/y\.jpg/);
  assert.equal(j.model, "fake-vision-model");
});

test("headless: POST /api/vision rejects missing imageUrl", async () => {
  const r = await fetch(`${baseUrl()}/api/vision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.match(j.error, /imageUrl/);
});

test("headless: POST /api/vision surfaces upstream errors as 502", async () => {
  const r = await fetch(`${baseUrl()}/api/vision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl: "fail:oops" }),
  });
  assert.equal(r.status, 502);
  const j = await r.json();
  assert.match(j.error, /intentional-vision-error/);
});

// ─── /api/tools ─────────────────────────────────────────────────────
test("headless: GET /api/tools lists registered tools", async () => {
  const r = await fetch(`${baseUrl()}/api/tools`);
  const j = await r.json();
  assert.ok(Array.isArray(j.tools));
  const names = j.tools.map((t) => t.name);
  assert.ok(names.includes("scan_codebase"));
  assert.ok(names.includes("vision_describe"));
});

test("headless: POST /api/tools/:name invokes a tool", async () => {
  const r = await fetch(`${baseUrl()}/api/tools/scan_codebase`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ root: "." }),
  });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.name, "scan_codebase");
  assert.equal(j.output, "scan_codebase ok");
  assert.deepEqual(j.data.echoed, true);
});

test("headless: POST /api/tools/:name surfaces tool errors as 400", async () => {
  const r = await fetch(`${baseUrl()}/api/tools/throw_test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.match(j.error, /intentional tool error/);
});

// ─── /api/chat — exercises the full pipeline ───────────────────────
test("headless: POST /api/chat returns OpenAI-compatible shape", async () => {
  const r = await fetch(`${baseUrl()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "hello organism" }],
    }),
  });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(j.choices));
  assert.equal(j.choices[0].message.role, "assistant");
  assert.equal(j.choices[0].message.content, "echo: hello organism");
  assert.equal(j.model, "fake-model");
  assert.equal(j.session_id, "sess-1");
  assert.equal(j.usage.total_tokens, 17);
});

test("headless: POST /api/chat injects the MHU preprocessor block", async () => {
  // The fake bridge echoes the last message; if MHU injection worked,
  // the LAST message is still the user message, but a system message
  // was PREPENDED with the MHU context. We capture the messages array.
  let captured = null;
  const capturingBridge = {
    ...fakeBridge,
    complete: async (req) => {
      captured = req.messages;
      return fakeBridge.complete(req);
    },
  };
  // Spin up a second server with this bridge on an ephemeral port.
  const ctx2 = await startHeadlessServer({
    port: 0,
    mhuEngine: fakeMhuEngine,
    opencodePing: fakeBridge.ping,
    opencodeComplete: capturingBridge.complete,
    executeBridgeTool: fakeBridge.executeBridgeTool,
    FALLBACK_TOOLS: fakeBridge.FALLBACK_TOOLS,
    describeImage: fakeDescribeImage,
    MHU_5_ProtoODC: function () { return fakeMhuEngine; },
  });
  try {
    await fetch(`http://127.0.0.1:${ctx2.port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "analyze the surprise" }],
      }),
    });
    assert.ok(Array.isArray(captured));
    assert.equal(captured.length, 2);
    assert.equal(captured[0].role, "system");
    assert.match(captured[0].content, /MHU 5\.0 COGNITIVE ORCHESTRATION/);
    assert.match(captured[0].content, /THERMODYNAMICS/);
    assert.match(captured[0].content, /analyze the surprise/);
    assert.equal(captured[1].role, "user");
  } finally {
    await ctx2.close();
  }
});

test("headless: POST /api/chat returns 503 if OpenCode ping fails", async () => {
  const ctx2 = await startHeadlessServer({
    port: 0,
    mhuEngine: fakeMhuEngine,
    opencodePing: async () => false,
    opencodeComplete: fakeBridge.complete,
    executeBridgeTool: fakeBridge.executeBridgeTool,
    FALLBACK_TOOLS: fakeBridge.FALLBACK_TOOLS,
    describeImage: fakeDescribeImage,
    MHU_5_ProtoODC: function () { return fakeMhuEngine; },
  });
  try {
    const r = await fetch(`http://127.0.0.1:${ctx2.port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    assert.equal(r.status, 503);
    const j = await r.json();
    assert.match(j.error, /OpenCode/);
  } finally {
    await ctx2.close();
  }
});
