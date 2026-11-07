/**
 * The model registry must be self-healing.
 *
 * The catalog churns: z-ai/glm-5.3 was alive on 2026-10-23 and was
 * retired on 2026-10-28, which is exactly what broke T14 on
 * 2026-10-29. A registry that is only correct on the day it was
 * written breaks again in a week.
 *
 * The rule that matters: a model is declared dead ONLY on an explicit
 * 404 or 410. A timeout, a 429 or a 5xx proves nothing, and retiring
 * a working model because the network hiccuped would be worse than
 * the original bug.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

/** Runs `fn` with globalThis.fetch stubbed and a dummy key present. */
async function withFetch(stub, fn) {
  const original = globalThis.fetch;
  const originalKey = process.env.NVIDIA_API_KEY;
  globalThis.fetch = stub;
  // The probe refuses to run without a key — it says so instead of
  // pretending the chain is healthy. The key is never used for real
  // here: fetch is stubbed.
  process.env.NVIDIA_API_KEY = originalKey ?? "test-key-not-used";
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
    if (originalKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = originalKey;
  }
}

test("liveness probe: retires a model only on 404 or 410", async () => {
  const { probeModelLiveness, clearLivenessCache } = await import(
    path.join(ROOT, "server/llm-library/model-registry.mjs")
  );
  clearLivenessCache();
  const asked = [];
  const stub = async (url, init) => {
    const body = JSON.parse(init.body);
    asked.push(body.model);
    if (body.model === "gone-410") return { ok: false, status: 410 };
    if (body.model === "ghost-404") return { ok: false, status: 404 };
    if (body.model === "busy-429") return { ok: false, status: 429 };
    if (body.model === "broken-500") return { ok: false, status: 500 };
    if (body.model === "offline") throw new Error("network down");
    return { ok: true, status: 200 };
  };
  await withFetch(stub, async () => {
    const r = await probeModelLiveness({
      force: true,
      models: ["alive", "gone-410", "ghost-404", "busy-429", "broken-500", "offline"],
    });
    // Only the explicit "gone" answers are retired.
    assert.deepEqual(r.dead.sort(), ["ghost-404", "gone-410"]);
    // A rate limit, a server error and a network failure are NOT
    // evidence of death.
    assert.ok(r.live.includes("busy-429"));
    assert.ok(r.live.includes("broken-500"));
    assert.ok(r.live.includes("offline"));
    assert.ok(r.live.includes("alive"));
  });
});

test("liveness probe: the result is cached instead of re-probing", async () => {
  const { probeModelLiveness, clearLivenessCache } = await import(
    path.join(ROOT, "server/llm-library/model-registry.mjs")
  );
  clearLivenessCache();
  let calls = 0;
  const stub = async () => {
    calls++;
    return { ok: true, status: 200 };
  };
  await withFetch(stub, async () => {
    await probeModelLiveness({ force: true, models: ["a", "b"] });
    const second = await probeModelLiveness({ models: ["a", "b"] });
    assert.equal(calls, 2, "the second call should not have re-probed");
    assert.equal(second.cached, true);
  });
  clearLivenessCache();
});

test("liveness probe: without a key it says so instead of pretending", async () => {
  const { probeModelLiveness, clearLivenessCache } = await import(
    path.join(ROOT, "server/llm-library/model-registry.mjs")
  );
  clearLivenessCache();
  const originalKey = process.env.NVIDIA_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  try {
    const r = await probeModelLiveness({ force: true, models: ["a"] });
    assert.equal(r.skipped, "no NVIDIA_API_KEY");
    assert.deepEqual(r.dead, []);
    assert.deepEqual(r.live, ["a"]);
  } finally {
    if (originalKey) process.env.NVIDIA_API_KEY = originalKey;
    clearLivenessCache();
  }
});

test("model registry: the known-dead models are all actually marked", async () => {
  const { DEPRECATED_MODELS, MODEL_FALLBACK_CHAIN, DEFAULT_CODE_MODEL } = await import(
    path.join(ROOT, "server/llm-library/model-registry.mjs")
  );
  // A model on the chain must not also be in the dead table.
  for (const model of MODEL_FALLBACK_CHAIN) {
    assert.equal(DEPRECATED_MODELS[model], undefined, `${model} is on the chain but marked dead`);
  }
  assert.ok(MODEL_FALLBACK_CHAIN.includes(DEFAULT_CODE_MODEL));
  // The chain must have more than one link, or a retirement is fatal.
  assert.ok(MODEL_FALLBACK_CHAIN.length >= 2, "the chain needs a fallback");
});
