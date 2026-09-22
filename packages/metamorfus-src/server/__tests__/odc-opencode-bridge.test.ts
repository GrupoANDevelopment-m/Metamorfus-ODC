/**
 * Tests for odc-opencode-bridge — the thin adapter between server.ts and the
 * OpenCode headless server.
 *
 * Strategy: stub `globalThis.fetch` so each test controls OpenCode's response
 * shape, status, and timing. No live OpenCode instance required.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { ping, complete } from "../odc-opencode-bridge.js";

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

type FetchCall = { url: string; init?: RequestInit };

function installFetchMock(impl: (call: FetchCall) => Promise<Response> | Response) {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  const stub: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    calls.push({ url, init });
    return impl({ url, init });
  };
  globalThis.fetch = stub;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

// ----------------------------------------------------------------------------
// ping()
// ----------------------------------------------------------------------------

test("ping: returns true when OpenCode /health responds 200", async () => {
  const mock = installFetchMock(() => jsonResponse({ ok: true }, 200));
  try {
    const result = await ping();
    assert.equal(result, true);
    assert.equal(mock.calls.length, 1);
    assert.match(mock.calls[0]!.url, /\/health$/);
  } finally {
    mock.restore();
  }
});

test("ping: returns false when OpenCode responds non-2xx", async () => {
  const mock = installFetchMock(() => textResponse("nope", 503));
  try {
    const result = await ping();
    assert.equal(result, false);
  } finally {
    mock.restore();
  }
});

test("ping: returns false when OpenCode is unreachable (network error)", async () => {
  const mock = installFetchMock(() => {
    throw new Error("ECONNREFUSED");
  });
  try {
    const result = await ping();
    assert.equal(result, false);
  } finally {
    mock.restore();
  }
});

test("ping: defaults to http://localhost:4096 when OPENCODE_URL is not set", async () => {
  // OPENCODE_URL is captured at module load. We assert the documented default
  // here. Override behaviour is exercised manually (see docs/ADAPTER_DESIGN.md).
  const mock = installFetchMock(() => jsonResponse({}, 200));
  try {
    await ping();
    assert.match(mock.calls[0]!.url, /^http:\/\/localhost:4096\/health$/);
  } finally {
    mock.restore();
  }
});

// ----------------------------------------------------------------------------
// complete()
// ----------------------------------------------------------------------------

test("complete: creates a session, posts the prompt, returns the bridge response", async () => {
  const mock = installFetchMock((call) => {
    if (call.url.endsWith("/session") && call.init?.method === "POST") {
      return jsonResponse({ id: "sess-abc" }, 200);
    }
    if (call.url.includes("/session/sess-abc/message") && call.init?.method === "POST") {
      return jsonResponse(
        {
          content: "Hello back",
          model: "anthropic/claude-sonnet-4-20250514",
          provider: "anthropic",
          usage: { promptTokens: 12, completionTokens: 5, totalTokens: 17 },
        },
        200,
      );
    }
    return textResponse("not found", 404);
  });

  try {
    const result = await complete({
      messages: [
        { role: "system", content: "you are cortex" },
        { role: "user", content: "hi" },
      ],
      temperature: 0.5,
      maxTokens: 1024,
    });

    assert.equal(result.sessionId, "sess-abc");
    assert.equal(result.content, "Hello back");
    assert.equal(result.model, "anthropic/claude-sonnet-4-20250514");
    assert.equal(result.provider, "anthropic");
    assert.deepEqual(result.usage, {
      promptTokens: 12,
      completionTokens: 5,
      totalTokens: 17,
    });

    // Two calls: one to /session, one to /session/.../message
    assert.equal(mock.calls.length, 2);

    // First call: session create
    assert.equal(mock.calls[0]!.url, "http://localhost:4096/session");
    assert.equal(mock.calls[0]!.init?.method, "POST");

    // Second call: prompt
    const second = mock.calls[1]!;
    assert.equal(second.url, "http://localhost:4096/session/sess-abc/message");
    assert.equal(second.init?.method, "POST");
    const body = JSON.parse(String(second.init?.body));
    assert.equal(body.agent, "cortex");
    assert.equal(body.temperature, 0.5);
    assert.equal(body.maxTokens, 1024);
    assert.deepEqual(body.parts, [
      { type: "text", text: "you are cortex" },
      { type: "text", text: "hi" },
    ]);
  } finally {
    mock.restore();
  }
});

test("complete: forwards provider and model overrides when set", async () => {
  const mock = installFetchMock((call) => {
    if (call.url.endsWith("/session")) return jsonResponse({ id: "s1" });
    return jsonResponse({ content: "ok", model: "openai/gpt-4o", provider: "openai" });
  });

  try {
    await complete({
      messages: [{ role: "user", content: "ping" }],
      provider: "openai",
      model: "openai/gpt-4o",
    });

    const promptCall = mock.calls[1]!;
    const body = JSON.parse(String(promptCall.init?.body));
    assert.equal(body.provider, "openai");
    assert.equal(body.model, "openai/gpt-4o");
  } finally {
    mock.restore();
  }
});

test("complete: omits provider/model fields when not provided", async () => {
  const mock = installFetchMock((call) => {
    if (call.url.endsWith("/session")) return jsonResponse({ id: "s1" });
    return jsonResponse({ content: "ok" });
  });

  try {
    await complete({ messages: [{ role: "user", content: "ping" }] });
    const body = JSON.parse(String(mock.calls[1]!.init?.body));
    assert.equal("provider" in body, false);
    assert.equal("model" in body, false);
  } finally {
    mock.restore();
  }
});

test("complete: throws when session.create fails", async () => {
  const mock = installFetchMock(() => textResponse("down", 502));
  try {
    await assert.rejects(
      () => complete({ messages: [{ role: "user", content: "x" }] }),
      /session\.create failed \(502\)/,
    );
  } finally {
    mock.restore();
  }
});

test("complete: throws when prompt call fails", async () => {
  const mock = installFetchMock((call) => {
    if (call.url.endsWith("/session")) return jsonResponse({ id: "s1" });
    return textResponse("model exploded", 500);
  });
  try {
    await assert.rejects(
      () => complete({ messages: [{ role: "user", content: "x" }] }),
      /prompt failed \(500\)/,
    );
  } finally {
    mock.restore();
  }
});

test("complete: tolerates missing usage field (defaults to 0s)", async () => {
  const mock = installFetchMock((call) => {
    if (call.url.endsWith("/session")) return jsonResponse({ id: "s1" });
    return jsonResponse({ content: "hi" }); // no model, no provider, no usage
  });

  try {
    const result = await complete({ messages: [{ role: "user", content: "x" }] });
    assert.equal(result.content, "hi");
    assert.equal(result.model, "opencode-default");
    assert.equal(result.provider, "opencode-default");
    assert.deepEqual(result.usage, {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  } finally {
    mock.restore();
  }
});

test("complete: passes an AbortSignal that can be triggered externally", async () => {
  // We do not assert the timeout fires (which would slow the suite); we only
  // assert that the request is built with a signal so the timeout path is
  // wired correctly.
  const mock = installFetchMock((call) => {
    assert.ok(call.init?.signal, "complete() must pass an AbortSignal");
    if (call.url.endsWith("/session")) return jsonResponse({ id: "s1" });
    return jsonResponse({ content: "ok" });
  });

  try {
    await complete({ messages: [{ role: "user", content: "x" }] });
  } finally {
    mock.restore();
  }
});
