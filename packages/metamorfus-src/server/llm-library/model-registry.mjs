/**
 * LLM model registry — VERIFIED LIVE against integrate.api.nvidia.com.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Every cognitive step (auto-forge, auto-reform, evolve-skill, directional
 * forge, intent classification) used to hardcode `moonshotai/kimi-k3`.
 * That model hit end-of-life on 2026-10-15 and every call now returns
 * `410 Gone`. The forge silently stopped working.
 *
 * Worse, `GET /v1/models` still lists models that are NOT reachable —
 * `moonshotai/kimi-k2.6` is listed but answers `404 Function not found`.
 * Listing is not availability. So the table below was built by probing
 * each candidate with a real chat completion AND a real code-generation
 * task, then running the returned Python through the REAL invoker
 * (server/skills/invoker.py) and checking the value it produced.
 *
 * PROBE RESULTS (2026-10-29, api key verified against real completions)
 *
 *   model                                    status    note
 *   ----------------------------------------------------------------------------
 *   nvidia/nemotron-3-ultra-550b-a55b         ✅ 200   codegen OK, invoker ran it
 *   nvidia/nemotron-3-nano-omni-30b-a3b-re   ✅ 200   codegen OK, invoker ran it
 *   openai/gpt-oss-20b                       ✅ 200   codegen OK, invoker ran it
 *
 *   z-ai/glm-5.3                             ❌ 410   EOL 2026-10-28 (yesterday)
 *   nvidia/nemotron-3-super-120b-a12b         ❌ 404   ghost entry
 *   nvidia/nemotron-3.5-lightning-30b-a3b    ❌ 200   replies, but emits no function
 *   openai/gpt-oss-120b                      ❌ 410   EOL 2026-09-03
 *   qwen/qwen3-coder-480b-a35b-instruct       ❌ 410   EOL 2026-06-11
 *   qwen/qwen3-next-80b-a3b-instruct          ❌ 410   EOL 2026-07-27
 *   meta/llama-4-maverick-17b-128e-instruct   ❌ 410   EOL 2026-07-27
 *   moonshotai/kimi-k2                       ❌ 404   ghost entry
 *   deepseek-ai/deepseek-v3.1                ❌ 404   ghost entry
 *   mistralai/mistral-large-3.1-24b-...      ❌ 404   ghost entry
 *
 * The catalog churns. The previous revision of this file, dated 2026-10-23,
 * listed `z-ai/glm-5.3` as the second link in the chain; it was alive then
 * and was retired on 2026-10-28, which is exactly what broke T14 on
 * 2026-10-29. That is why the chain is probed rather than assumed, and
 * why every entry below was confirmed by a live completion AND a live
 * execution today.
 *
 * The ordering below is the fallback chain: if the primary 410s or 404s,
 * the LlmRouter already moves to the next candidate. Putting the model
 * that actually compiles Python first matters — the whole organism
 * depends on it for self-modification.
 */

/** Primary: verified to produce Python that compiles AND executes. */
export const DEFAULT_CODE_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";

/** Fallback chain, best-first. Verified reachable as of 2026-10-29. */
export const MODEL_FALLBACK_CHAIN = [
  // Verified reachable AND producing Python that passes validation on
  // 2026-10-29 (see the probe table at the top of this file).
  "nvidia/nemotron-3-ultra-550b-a55b",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
  "openai/gpt-oss-20b",
];

/**
 * Known-dead models. Kept explicit rather than deleted so that anyone
 * still carrying these ids gets a clear error instead of a silent 410
 * halfway through a forge cycle.
 *
 * RE-PROBED 2026-10-29. The catalog churns: nemotron-3-super-120b, which
 * was the primary in the previous revision of this file, now answers 404;
 * z-ai/glm-5.3, which was the second link in the chain, was retired on
 * 2026-10-28 and now answers 410. Every entry below was confirmed by a
 * live completion attempt today, not inferred from the catalog —
 * /v1/models still lists several of them.
 */
export const DEPRECATED_MODELS = {
  "moonshotai/kimi-k3": "EOL 2026-10-15 (HTTP 410 Gone)",
  "moonshotai/kimi-k2.6": "listed in catalog but HTTP 404 — ghost entry",
  "moonshotai/kimi-k2": "HTTP 404 — ghost entry",
  "z-ai/glm-5.3": "EOL 2026-10-28 (HTTP 410 Gone)",
  "z-ai/glm-5.3-flash": "responds but returns empty content on codegen",
  "nvidia/nemotron-3-super-120b-a12b": "was primary 2026-10-20; HTTP 404 as of 2026-10-29",
  "nvidia/nemotron-4-340b-instruct": "HTTP 404",
  "nvidia/nemotron-nano-3-30b-a3b": "HTTP 404",
  "nvidia/llama-3.1-nemotron-ultra-253b-v1": "HTTP 404",
  "nvidia/llama-3.3-nemotron-super-49b-v1.5": "EOL (HTTP 410 Gone)",
  "nvidia/llama-3.1-nemotron-70b-instruct": "HTTP 404",
  "nvidia/nemotron-3.5-lightning-30b-a3b": "responds but emits no function on codegen",
  "nvidia/nemotron-nano-12b-v2": "HTTP 404",
  "nvidia/nemotron-nano-9b-v2": "HTTP 404",
  "nvidia/qwen3-coder-480b-a35b-instruct": "HTTP 404",
  "nvidia/deepseek-v3.1": "HTTP 404",
  "nvidia/gpt-oss-120b": "HTTP 404",
  "nvidia/gpt-oss-20b": "HTTP 404",
  "nvidia/mistral-large-3.1-24b-instruct-2503": "HTTP 404",
  "nvidia/glm-5.3": "HTTP 404",
  "nvidia/kimi-k2": "HTTP 404",
  "openai/gpt-oss-120b": "EOL 2026-09-03 (HTTP 410 Gone)",
  "deepseek-ai/deepseek-v4.1-flash": "listed but times out on long generations",
  "deepseek-ai/deepseek-v3.1": "HTTP 404 — ghost entry",
  "deepseek-ai/deepseek-v4-flash-0731": "deprecated 2026-09-19, unsupported after 2026-09-21",
  "qwen/qwen3-coder-480b-a35b-instruct": "EOL 2026-06-11 (HTTP 410 Gone)",
  "qwen/qwen3-next-80b-a3b-instruct": "EOL 2026-07-27 (HTTP 410 Gone)",
  "meta/llama-4-maverick-17b-128e-instruct": "EOL 2026-07-27 (HTTP 410 Gone)",
  "meta/llama-3.3-70b-instruct": "removed from NIM (HTTP 410 Gone)",
  "mistralai/mistral-large-3-1-24b-instruct-2503": "HTTP 404 — ghost entry",
  "mistralai/mistral-large-3.1-24b-instruct-2503": "HTTP 404 — ghost entry",
  "mistralai/mistral-large-3-675b-instruct-2512": "EOL (HTTP 410 Gone)",
};

/**
 * Vision-capable models for the vision_describe tool. The old default
 * (kimi-k3) is gone; these were reachable at probe time.
 */
export const VISION_MODELS = [
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
  "meta/llama-3.2-90b-vision-instruct",
];

export function resolveModel(requested) {
  if (!requested) return DEFAULT_CODE_MODEL;
  if (DEPRECATED_MODELS[requested]) {
    return DEFAULT_CODE_MODEL;
  }
  return requested;
}

export function isDeprecated(model) {
  return Boolean(DEPRECATED_MODELS[model]);
}

/**
 * LIVENESS PROBE
 * --------------
 * The catalog churns. `z-ai/glm-5.3` was alive on 2026-10-23 and
 * retired on 2026-10-28, which is what broke T14 on 2026-10-29. A
 * registry that is only correct on the day it was written is a
 * registry that breaks again in a week.
 *
 * So the chain is checked before it is used. A model is declared dead
 * ONLY on an explicit 404 or 410 from the endpoint — a network error
 * or a timeout proves nothing and must never retire a working model.
 *
 * The result is cached, because a probe costs a round trip and the
 * registry is consulted on every forge.
 */
const LIVENESS_TTL_MS = 30 * 60 * 1000;
let livenessCache = { checkedAt: 0, live: null, dead: null };

/** Forces the next chain lookup to re-probe. */
export function clearLivenessCache() {
  livenessCache = { checkedAt: 0, live: null, dead: null };
}

/**
 * Probes each model with the smallest possible completion and reports
 * which ones answer.
 *
 * @param {object} opts
 * @param {string[]} [opts.models]  candidates (defaults to the chain)
 * @param {boolean} [opts.force]    ignore the cache
 * @param {number} [opts.timeoutMs]
 */
export async function probeModelLiveness({ models = MODEL_FALLBACK_CHAIN, force = false, timeoutMs = 8000 } = {}) {
  const now = Date.now();
  if (!force && livenessCache.live && now - livenessCache.checkedAt < LIVENESS_TTL_MS) {
    return { live: livenessCache.live, dead: livenessCache.dead, checkedAt: livenessCache.checkedAt, cached: true };
  }
  const key = process.env.NVIDIA_API_KEY;
  if (!key) {
    // No key: nothing can be probed. Say so instead of pretending the
    // chain is healthy.
    return { live: models, dead: [], checkedAt: now, cached: false, skipped: "no NVIDIA_API_KEY" };
  }

  const live = [];
  const dead = [];
  for (const model of models) {
    try {
      const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        live.push(model);
      } else if (res.status === 404 || res.status === 410) {
        // An explicit "gone" — this model is retired.
        dead.push(model);
      } else {
        // 429, 5xx, network hiccup: not evidence of death.
        live.push(model);
      }
    } catch {
      // Timeout / DNS / offline: unknown, not dead.
      live.push(model);
    }
  }
  livenessCache = { checkedAt: now, live, dead };
  return { live, dead, checkedAt: now, cached: false };
}

/**
 * The chain, filtered to the models that actually answer right now.
 * Falls back to the static chain when nothing could be determined.
 */
export async function liveModelChain() {
  const r = await probeModelLiveness();
  if (!r.live || !r.live.length) return [...MODEL_FALLBACK_CHAIN];
  return r.live;
}
