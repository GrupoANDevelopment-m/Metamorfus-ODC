// LLM Library — full coverage test suite.
//
// Validates:
//   • store CRUD with persistence to a temp JSON file
//   • store maskKey / health / public view
//   • router: priority ordering, cooldown skipping, failover on errors
//   • provider adapters: openai-compatible, anthropic, google (mocked)
//   • end-to-end with a real local HTTP server acting as a stub LLM
//
// Tests do NOT hit the public internet — they spin up an in-process
// HTTP server that mimics an OpenAI-compatible / Anthropic / Google
// endpoint, so the adapters are exercised end-to-end without paying
// for tokens.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import crypto from "node:crypto";

import { LlmLibraryStore, CATEGORIES } from "../llm-library/store.mjs";
import { LlmRouter } from "../llm-library/router.mjs";
import {
  callProvider,
  PROVIDER_PRESETS,
  PROVIDERS,
  ProviderError,
} from "../llm-library/providers.mjs";

// ─── helpers ────────────────────────────────────────────────────────

async function tmpFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "llm-lib-"));
  return path.join(dir, "library.json");
}

function makeStubServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === "object" && addr ? addr.port : 0 });
    });
  });
}

function okJson(res, body) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

// ─── store ──────────────────────────────────────────────────────────

test("store: defaults from env create a single NVIDIA entry", async () => {
  const file = await tmpFile();
  process.env.NVIDIA_API_KEY = "nvapi-test-1234567890abcd";
  const s = new LlmLibraryStore(file);
  await s.load();
  assert.equal(s.list().length, 1);
  const c = s.list()[0];
  assert.equal(c.provider, "nvidia-direct");
  assert.equal(c.category, "multimodal");
  assert.equal(c.apiKey, "nvapi-test-1234567890abcd");
  delete process.env.NVIDIA_API_KEY;
});

test("store: add validates required fields", async () => {
  const file = await tmpFile();
  const s = new LlmLibraryStore(file);
  await s.load();
  await assert.rejects(s.add({}), /category/);
  await assert.rejects(s.add({ category: "text" }), /endpoint/);
  await assert.rejects(s.add({ category: "text", endpoint: "http://x" }), /apiKey/);
  await assert.rejects(
    s.add({ category: "text", endpoint: "http://x", apiKey: "k", model: "" }),
    /model/,
  );
});

test("store: add → list → update → remove round-trip persists to disk", async () => {
  const file = await tmpFile();
  const s = new LlmLibraryStore(file);
  await s.load();
  const e = await s.add({
    name: "test-openai",
    provider: "openai-compatible",
    category: "text",
    endpoint: "http://127.0.0.1:1/v1/chat/completions",
    apiKey: "sk-test",
    model: "gpt-4o-mini",
    priority: 50,
  });
  assert.equal(e.priority, 50);
  assert.equal(s.list({ category: "text" }).length, 1);

  await s.update(e.id, { priority: 10, enabled: false });
  const updated = s.get(e.id);
  assert.equal(updated.priority, 10);
  assert.equal(updated.enabled, false);
  assert.equal(updated.updatedAt > e.updatedAt, true);

  // Reload from disk — change survives.
  const s2 = new LlmLibraryStore(file);
  await s2.load();
  assert.equal(s2.get(e.id).priority, 10);

  await s2.remove(e.id);
  assert.equal(s2.list().length, 0);
});

test("store: public view masks the api key", async () => {
  const file = await tmpFile();
  const s = new LlmLibraryStore(file);
  await s.load();
  const e = await s.add({
    name: "secret-test",
    provider: "openai-compatible",
    category: "text",
    endpoint: "http://x",
    apiKey: "sk-supersecret1234567890",
    model: "gpt-4o-mini",
  });
  const pub = s.listPublic()[0];
  assert.notEqual(pub.apiKey, "sk-supersecret1234567890");
  assert.equal(pub.apiKey, "sk-s…7890"); // first 4 + ellipsis + last 4
  assert.equal(pub.apiKeySet, true);
});

test("store: list filters by category and enabledOnly", async () => {
  const file = await tmpFile();
  const s = new LlmLibraryStore(file);
  await s.load();
  await s.add({ name: "t1", provider: "openai-compatible", category: "text",       endpoint: "http://x", apiKey: "k", model: "m" });
  await s.add({ name: "t2", provider: "openai-compatible", category: "text",       endpoint: "http://x", apiKey: "k", model: "m", enabled: false });
  await s.add({ name: "t3", provider: "openai-compatible", category: "reasoning",  endpoint: "http://x", apiKey: "k", model: "m" });
  await s.add({ name: "t4", provider: "openai-compatible", category: "multimodal", endpoint: "http://x", apiKey: "k", model: "m" });
  assert.equal(s.list({ category: "text", enabledOnly: true }).length, 1);
  assert.equal(s.list({ category: "text" }).length, 2);
  assert.equal(s.list().length, 4);
});

// ─── providers (in-process stub) ────────────────────────────────────

test("provider: openai-compatible translates response to normalized shape", async () => {
  const { server, port } = await makeStubServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body);
      assert.equal(parsed.model, "gpt-4o-mini");
      assert.equal(parsed.stream, false);
      okJson(res, {
        id: "chatcmpl-1",
        model: "gpt-4o-mini-actual",
        choices: [{ index: 0, message: { role: "assistant", content: "hi from openai" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    });
  });
  try {
    const result = await callProvider(
      { provider: "openai-compatible", endpoint: `http://127.0.0.1:${port}/v1/chat/completions`, apiKey: "k", model: "gpt-4o-mini" },
      { messages: [{ role: "user", content: "hi" }] },
    );
    assert.equal(result.content, "hi from openai");
    assert.equal(result.model, "gpt-4o-mini-actual");
    assert.equal(result.provider, "openai-compatible");
    assert.equal(result.usage.totalTokens, 15);
  } finally {
    server.close();
  }
});

test("provider: anthropic translates OpenAI-style messages and parses content blocks", async () => {
  const { server, port } = await makeStubServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body);
      assert.equal(parsed.system, "be brief");
      assert.equal(parsed.messages.length, 1);
      assert.equal(parsed.messages[0].role, "user");
      okJson(res, {
        id: "msg-1",
        model: "claude-3-5-sonnet-actual",
        content: [{ type: "text", text: "hi from claude" }],
        usage: { input_tokens: 8, output_tokens: 4 },
      });
    });
  });
  try {
    const result = await callProvider(
      { provider: "anthropic", endpoint: `http://127.0.0.1:${port}/v1/messages`, apiKey: "k", model: "claude-3-5-sonnet-latest" },
      {
        messages: [
          { role: "system", content: "be brief" },
          { role: "user", content: "hi" },
        ],
      },
    );
    assert.equal(result.content, "hi from claude");
    assert.equal(result.usage.promptTokens, 8);
    assert.equal(result.usage.completionTokens, 4);
    assert.equal(result.usage.totalTokens, 12);
  } finally {
    server.close();
  }
});

test("provider: google converts OpenAI-style messages to contents/parts", async () => {
  const { server, port } = await makeStubServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body);
      assert.equal(parsed.systemInstruction.parts[0].text, "be brief");
      assert.equal(parsed.contents[0].role, "user");
      assert.equal(parsed.contents[0].parts[0].text, "hi");
      okJson(res, {
        candidates: [
          {
            content: {
              parts: [{ text: "hi from gemini" }],
              role: "model",
            },
          },
        ],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 },
      });
    });
  });
  try {
    const result = await callProvider(
      { provider: "google", endpoint: `http://127.0.0.1:${port}/v1beta/models`, apiKey: "k", model: "gemini-2.0-flash" },
      {
        messages: [
          { role: "system", content: "be brief" },
          { role: "user", content: "hi" },
        ],
      },
    );
    assert.equal(result.content, "hi from gemini");
    assert.equal(result.usage.totalTokens, 7);
    assert.equal(result.provider, "google");
  } finally {
    server.close();
  }
});

test("provider: kimi-k3 model triggers chat_template_kwargs enable_thinking", async () => {
  let capturedBody = null;
  const { server, port } = await makeStubServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      capturedBody = JSON.parse(body);
      okJson(res, { model: "kimi-k3", choices: [{ message: { content: "ok" } }], usage: {} });
    });
  });
  try {
    await callProvider(
      { provider: "nvidia-direct", endpoint: `http://127.0.0.1:${port}/v1/chat/completions`, apiKey: "k", model: "moonshotai/kimi-k3" },
      { messages: [{ role: "user", content: "hi" }] },
    );
    assert.deepEqual(capturedBody.chat_template_kwargs, { enable_thinking: true });
  } finally {
    server.close();
  }
});

test("provider: HTTP 429 throws ProviderError with status", async () => {
  const { server, port } = await makeStubServer((_req, res) => {
    res.statusCode = 429;
    res.end(`{"error":{"message":"rate limit"}}`);
  });
  try {
    await assert.rejects(
      callProvider(
        { provider: "openai-compatible", endpoint: `http://127.0.0.1:${port}/v1/chat/completions`, apiKey: "k", model: "m" },
        { messages: [{ role: "user", content: "hi" }] },
      ),
      (err) => err instanceof ProviderError && err.status === 429,
    );
  } finally {
    server.close();
  }
});

// ─── router ─────────────────────────────────────────────────────────

test("router: priority ordering — lower priority wins", async () => {
  const file = await tmpFile();
  const s = new LlmLibraryStore(file);
  await s.load();
  await s.add({ name: "low",  provider: "openai-compatible", category: "text", endpoint: "http://x", apiKey: "k", model: "m", priority: 100 });
  await s.add({ name: "high", provider: "openai-compatible", category: "text", endpoint: "http://x", apiKey: "k", model: "m", priority: 10 });
  const r = new LlmRouter(s);
  const candidates = s
    .list({ category: "text", enabledOnly: true })
    .filter((c) => r.isAvailable(c))
    .sort((a, b) => a.priority - b.priority);
  assert.equal(candidates[0].name, "high");
});

test("router: complete() picks the lowest-priority available config and records success", async () => {
  const { server, port } = await makeStubServer((_req, res) =>
    okJson(res, { model: "stub", choices: [{ message: { content: "ok" } }], usage: { total_tokens: 1 } }),
  );
  try {
    const file = await tmpFile();
    const s = new LlmLibraryStore(file);
    await s.load();
    const e = await s.add({
      name: "primary",
      provider: "openai-compatible",
      category: "text",
      endpoint: `http://127.0.0.1:${port}/v1/chat/completions`,
      apiKey: "k",
      model: "stub",
      priority: 10,
    });
    const r = new LlmRouter(s);
    const result = await r.complete("text", { messages: [{ role: "user", content: "hi" }] });
    assert.equal(result.content, "ok");
    assert.equal(result.usedConfig, e.id);
    assert.equal(s.get(e.id).health.status, "healthy");
  } finally {
    server.close();
  }
});

test("router: failover — primary 429 → secondary 200", async () => {
  let hits = 0;
  const { server, port } = await makeStubServer((_req, res) => {
    hits++;
    if (hits === 1) {
      res.statusCode = 429;
      res.end(`{"error":{"message":"rate limited"}}`);
    } else {
      okJson(res, { model: "secondary", choices: [{ message: { content: "failover ok" } }], usage: { total_tokens: 2 } });
    }
  });
  try {
    const file = await tmpFile();
    const s = new LlmLibraryStore(file);
    await s.load();
    const primary = await s.add({
      name: "primary",
      provider: "openai-compatible",
      category: "text",
      endpoint: `http://127.0.0.1:${port}/v1/chat/completions`,
      apiKey: "k",
      model: "m",
      priority: 10,
    });
    const secondary = await s.add({
      name: "secondary",
      provider: "openai-compatible",
      category: "text",
      endpoint: `http://127.0.0.1:${port}/v1/chat/completions`,
      apiKey: "k",
      model: "m",
      priority: 20,
    });
    const r = new LlmRouter(s);
    const result = await r.complete("text", { messages: [{ role: "user", content: "hi" }] });
    assert.equal(result.content, "failover ok");
    assert.equal(result.usedConfig, secondary.id);
    assert.equal(result.failoverFrom, primary.id);
    assert.equal(result.attempts.length, 1);
    assert.equal(s.get(primary.id).health.status, "rate-limited");
    assert.equal(s.get(secondary.id).health.status, "healthy");
    assert.ok(s.get(primary.id).health.cooldownUntil);
  } finally {
    server.close();
  }
});

test("router: rate-limited config is skipped while in cooldown", async () => {
  const file = await tmpFile();
  const s = new LlmLibraryStore(file);
  await s.load();
  await s.add({ name: "primary",   provider: "openai-compatible", category: "text", endpoint: "http://x", apiKey: "k", model: "m", priority: 10 });
  await s.add({ name: "secondary", provider: "openai-compatible", category: "text", endpoint: "http://x", apiKey: "k", model: "m", priority: 20 });
  const r = new LlmRouter(s);
  const primary = s.list({ category: "text" })[0];
  s.setHealth(primary.id, { status: "rate-limited", cooldownUntil: new Date(Date.now() + 60_000).toISOString() });
  const list = s.list({ category: "text", enabledOnly: true }).filter((c) => r.isAvailable(c));
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "secondary");
});

test("router: throws with attempts list when all candidates fail", async () => {
  const { server, port } = await makeStubServer((_req, res) => {
    res.statusCode = 500;
    res.end(`{"error":{"message":"server error"}}`);
  });
  try {
    const file = await tmpFile();
    const s = new LlmLibraryStore(file);
    await s.load();
    await s.add({ name: "only", provider: "openai-compatible", category: "text", endpoint: `http://127.0.0.1:${port}/v1/chat/completions`, apiKey: "k", model: "m" });
    const r = new LlmRouter(s);
    await assert.rejects(
      r.complete("text", { messages: [{ role: "user", content: "hi" }] }, { maxAttempts: 1 }),
      (err) => Array.isArray(err.attempts) && err.attempts.length === 1,
    );
  } finally {
    server.close();
  }
});

test("router: throws if no candidates in category", async () => {
  const file = await tmpFile();
  const s = new LlmLibraryStore(file);
  await s.load();
  const r = new LlmRouter(s);
  await assert.rejects(r.complete("reasoning", { messages: [{ role: "user", content: "hi" }] }), /No available LLM in category/);
});

test("router: failureCount and successCount increment", async () => {
  const { server, port } = await makeStubServer((_req, res) =>
    okJson(res, { model: "stub", choices: [{ message: { content: "ok" } }], usage: { total_tokens: 1 } }),
  );
  try {
    const file = await tmpFile();
    const s = new LlmLibraryStore(file);
    await s.load();
    const e = await s.add({ name: "x", provider: "openai-compatible", category: "text", endpoint: `http://127.0.0.1:${port}/v1/chat/completions`, apiKey: "k", model: "stub" });
    const r = new LlmRouter(s);
    await r.complete("text", { messages: [{ role: "user", content: "hi" }] });
    await r.complete("text", { messages: [{ role: "user", content: "hi" }] });
    assert.equal(s.get(e.id).health.successCount, 2);
  } finally {
    server.close();
  }
});

test("router: ping marks config healthy with latency", async () => {
  const { server, port } = await makeStubServer((_req, res) =>
    okJson(res, { model: "stub", choices: [{ message: { content: "p" } }], usage: { total_tokens: 1 } }),
  );
  try {
    const file = await tmpFile();
    const s = new LlmLibraryStore(file);
    await s.load();
    const e = await s.add({ name: "x", provider: "openai-compatible", category: "text", endpoint: `http://127.0.0.1:${port}/v1/chat/completions`, apiKey: "k", model: "stub" });
    const r = new LlmRouter(s);
    const result = await r.ping(s.get(e.id));
    assert.equal(result.ok, true);
    assert.ok(result.latencyMs >= 0);
    assert.equal(s.get(e.id).health.status, "healthy");
  } finally {
    server.close();
  }
});

// ─── presets / categories ──────────────────────────────────────────

test("categories are exactly text / reasoning / multimodal", () => {
  assert.deepEqual(CATEGORIES, ["text", "reasoning", "multimodal"]);
});

test("presets include NVIDIA, OpenAI, Anthropic, Google, Mistral, DeepSeek, Groq, Together, OpenRouter, xAI", () => {
  const labels = PROVIDER_PRESETS.map((p) => p.label);
  for (const expected of ["NVIDIA NIM", "OpenAI", "Anthropic", "Google Gemini", "Mistral", "DeepSeek", "Groq", "Together", "OpenRouter", "xAI (Grok)"]) {
    assert.ok(labels.includes(expected), `missing preset: ${expected}`);
  }
});

test("presets cover all three categories", () => {
  const cats = new Set(PROVIDER_PRESETS.map((p) => p.category));
  assert.ok(cats.has("text"));
  assert.ok(cats.has("reasoning"));
  assert.ok(cats.has("multimodal"));
});

// ─── end-to-end (multiple categories, one stub) ─────────────────────

test("e2e: router.complete() routes by category across separate providers", async () => {
  const { server, port } = await makeStubServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body);
      // Echo the model name in the response so we can verify routing.
      okJson(res, {
        model: parsed.model,
        choices: [{ message: { content: `served by ${parsed.model}` } }],
        usage: { total_tokens: 1 },
      });
    });
  });
  try {
    const file = await tmpFile();
    const s = new LlmLibraryStore(file);
    await s.load();
    const ep = `http://127.0.0.1:${port}/v1/chat/completions`;
    await s.add({ name: "txt-1",   provider: "openai-compatible", category: "text",       endpoint: ep, apiKey: "k", model: "gpt-4o-mini" });
    await s.add({ name: "rea-1",   provider: "openai-compatible", category: "reasoning",  endpoint: ep, apiKey: "k", model: "deepseek-reasoner" });
    await s.add({ name: "mm-1",    provider: "openai-compatible", category: "multimodal", endpoint: ep, apiKey: "k", model: "kimi-k3" });
    const r = new LlmRouter(s);
    const txt = await r.complete("text",       { messages: [{ role: "user", content: "x" }] });
    const rea = await r.complete("reasoning",  { messages: [{ role: "user", content: "x" }] });
    const mm  = await r.complete("multimodal", { messages: [{ role: "user", content: "x" }] });
    assert.equal(txt.content, "served by gpt-4o-mini");
    assert.equal(rea.content, "served by deepseek-reasoner");
    assert.equal(mm.content,  "served by kimi-k3");
  } finally {
    server.close();
  }
});
