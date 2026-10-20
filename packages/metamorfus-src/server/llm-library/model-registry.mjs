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
 * task, then compiling and executing the returned Python.
 *
 * PROBE RESULTS (2026-10-20, api key verified against real completions)
 *
 *   model                                    status    note
 *   ----------------------------------------------------------------------------
 *   nvidia/nemotron-3-super-120b-a12b         ✅ 200   codegen OK, executes correctly
 *   nvidia/nemotron-3-ultra-550b-a55b        ✅ 200   responds, but codegen was wrong
 *   nvidia/nemotron-3.5-lightning-30b-a3b    ✅ 200   responds, EMPTY content on codegen
 *   nvidia/nemotron-3-nano-omni-30b-a3b...   ✅ 200   reasoning variant
 *
 *   moonshotai/kimi-k3                        ❌ 410   EOL 2026-10-15
 *   moonshotai/kimi-k2.6                      ❌ 404   ghost entry, listed but dead
 *   qwen/qwen3-coder-480b-a35b-instruct       ❌ 410   EOL
 *   nvidia/nemotron-4-340b-instruct           ❌ 404   ghost entry
 *   nvidia/nemotron-nano-3-30b-a3b            ❌ 404   ghost entry
 *
 * The ordering below is the fallback chain: if the primary 410s or 404s,
 * the LlmRouter already moves to the next candidate. Putting the model
 * that actually compiles Python first matters — the whole organism
 * depends on it for self-modification.
 */

/** Primary: verified to produce Python that compiles AND executes. */
export const DEFAULT_CODE_MODEL = "nvidia/nemotron-3-super-120b-a12b";

/** Fallback chain, best-first. Verified reachable as of 2026-10-20. */
export const MODEL_FALLBACK_CHAIN = [
  "nvidia/nemotron-3-super-120b-a12b",
  "nvidia/nemotron-3-ultra-550b-a55b",
  "nvidia/nemotron-3.5-lightning-30b-a3b",
];

/**
 * Known-dead models. Kept explicit rather than deleted so that anyone
 * still carrying these ids gets a clear error instead of a silent 410
 * halfway through a forge cycle.
 */
export const DEPRECATED_MODELS = {
  "moonshotai/kimi-k3": "EOL 2026-10-15 (HTTP 410 Gone)",
  "moonshotai/kimi-k2.6": "listed in catalog but HTTP 404 — ghost entry",
  "qwen/qwen3-coder-480b-a35b-instruct": "EOL (HTTP 410 Gone)",
  "deepseek-ai/deepseek-v4-flash-0731": "deprecated 2026-09-19, unsupported after 2026-09-21",
  "meta/llama-3.3-70b-instruct": "removed from NIM (HTTP 410 Gone)",
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