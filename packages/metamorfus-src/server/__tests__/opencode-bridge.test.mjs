/**
 * Contract test: the ODC bridge against OpenCode's ACTUAL HTTP API.
 *
 * The bridge used to speak a protocol OpenCode never served:
 *
 *   • it pinged /health, while the server exposes /global/health
 *   • it read `content` off the prompt response, while OpenCode
 *     returns { info, parts }
 *   • it sent `model` as a string, while PromptInput validates a
 *     ModelRef ({ id, providerID })
 *   • it read `usage.promptTokens`, while OpenCode reports
 *     info.tokens.input / .output / .total
 *
 * Every one of those mismatches is silent: the bridge reported the
 * sidecar as unreachable, so /api/chat fell back to the local LLM
 * library and the OpenCode path never ran at all.
 *
 * This test serves the REAL shapes (taken from the vendored source:
 *   packages/opencode/src/server/routes/instance/httpapi/groups/global.ts
 *   packages/opencode/src/server/routes/instance/httpapi/groups/session.ts
 *   packages/opencode/src/session/prompt.ts
 *   packages/schema/src/v1/session.ts)
 * and asserts the bridge understands them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

/** The routes and payload shapes OpenCode actually serves. */
function startFakeOpenCode() {
  const seen = { health: 0, session: 0, message: 0, messageBody: null };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && url.pathname === "/global/health") {
      seen.health++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ healthy: true }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/session") {
      seen.session++;
      // Session.Info
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "ses_abc123", title: "odc", version: "1.0" }));
      return;
    }
    if (req.method === "POST" && /^\/session\/[^/]+\/message$/.test(url.pathname)) {
      seen.message++;
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.messageBody = JSON.parse(body || "{}");
        // SessionV1.WithParts
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            info: {
              id: "msg_1",
              role: "assistant",
              modelID: "nemotron-3-ultra-550b-a55b",
              providerID: "nvidia",
              cost: 0,
              tokens: {
                total: 42,
                input: 30,
                output: 12,
                reasoning: 0,
                cache: { read: 5, write: 0 },
              },
            },
            parts: [
              { type: "text", text: "A resposta do " },
              { type: "reasoning", text: "raciocínio interno" },
              { type: "text", text: "OpenCode." },
            ],
          }),
        );
      });
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port, seen, url: `http://127.0.0.1:${port}` });
    });
  });
}

test("bridge: ping finds OpenCode at /global/health", async () => {
  const fake = await startFakeOpenCode();
  process.env.OPENCODE_URL = fake.url;
  // Fresh import so the bridge picks up the URL.
  const bridge = await import(`../odc-opencode-bridge.js?probe=${Date.now()}`);
  try {
    assert.equal(await bridge.ping(), true, "ping did not find the sidecar");
    assert.ok(fake.seen.health > 0, "the bridge never asked /global/health");
  } finally {
    fake.server.close();
  }
});

test("bridge: complete() parses OpenCode's { info, parts } response", async () => {
  const fake = await startFakeOpenCode();
  process.env.OPENCODE_URL = fake.url;
  const bridge = await import(`../odc-opencode-bridge.js?probe=${Date.now()}`);
  try {
    const r = await bridge.complete({
      messages: [{ role: "user", content: "olá" }],
      model: "nvidia/nemotron-3-ultra-550b-a55b",
    });
    // The text comes from parts[], concatenated, and ONLY from the text
    // parts — a reasoning part must not leak into the answer.
    assert.equal(r.content, "A resposta do OpenCode.");
    assert.equal(r.sessionId, "ses_abc123");
    assert.equal(r.model, "nemotron-3-ultra-550b-a55b");
    assert.equal(r.provider, "nvidia");
    assert.equal(r.usage.promptTokens, 30);
    assert.equal(r.usage.completionTokens, 12);
    assert.equal(r.usage.totalTokens, 42);
    // The model must be sent as a ModelRef, not a string.
    assert.deepEqual(fake.seen.messageBody.model, {
      id: "nvidia/nemotron-3-ultra-550b-a55b",
      providerID: "nvidia",
    });
  } finally {
    fake.server.close();
  }
});

test("bridge: toModelRef splits provider from model id", async () => {
  const bridge = await import(`../odc-opencode-bridge.js?probe=${Date.now()}`);
  assert.deepEqual(bridge.toModelRef("nvidia/nemotron-3-ultra-550b-a55b"), {
    id: "nvidia/nemotron-3-ultra-550b-a55b",
    providerID: "nvidia",
  });
  // A model id with no provider prefix degrades instead of throwing.
  assert.deepEqual(bridge.toModelRef("bare-model"), { id: "bare-model", providerID: "bare-model" });
});

test("bridge: ping is false when the sidecar is down", async () => {
  process.env.OPENCODE_URL = "http://127.0.0.1:1"; // nothing listens here
  const bridge = await import(`../odc-opencode-bridge.js?probe=${Date.now()}`);
  assert.equal(await bridge.ping(), false);
});

test("bridge: rejects a malformed context instead of guessing", async () => {
  const bridge = await import(`../odc-opencode-bridge.js?probe=${Date.now()}`);
  await assert.rejects(
    () => bridge.executeBridgeTool("forge_skill", { skillKey: "x_protocol", pythonSource: "def skill(o,c): pass" }, "not-an-object"),
    /ctx must be/,
    "a bare string context must be rejected, not silently retargeted",
  );
});
