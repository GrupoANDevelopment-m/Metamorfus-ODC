// LLM Router — picks a config from the LLM Library and falls over to
// the next one on failure. Categorized so the operator can keep
// separate fallbacks for text, reasoning, and multimodal workloads.

import { callProvider, ProviderError } from "./providers.mjs";

const RATE_LIMIT_COOLDOWN_MS = 60_000;
const SERVER_ERROR_COOLDOWN_MS = 5_000;
const TRANSIENT_COOLDOWN_MS = 1_000;

export class LlmRouter {
  /** @param {import('./store.mjs').LlmLibraryStore} store */
  constructor(store) {
    this.store = store;
  }

  /**
   * Route a chat completion. Tries up to `maxAttempts` configs in the
   * given category, ordered by priority, skipping ones currently in
   * cooldown. Records per-attempt health state in the store.
   *
   * @param {"text"|"reasoning"|"multimodal"} category
   * @param {{messages: Array, temperature?: number, maxTokens?: number, timeoutMs?: number, model?: string}} req
   * @param {{maxAttempts?: number}} [opts]
   * @returns {Promise<{content, reasoning, model, provider, sessionId, usage, attempts: Array, usedConfig: string}>}
   */
  async complete(category, req, { maxAttempts = 5 } = {}) {
    const candidates = this.store
      .list({ category, enabledOnly: true })
      .filter((c) => this.isAvailable(c))
      .sort((a, b) => a.priority - b.priority);

    if (candidates.length === 0) {
      throw new Error(`No available LLM in category "${category}". Add one via the LLM Library or set ${categoryEnvHint(category)}.`);
    }

    const attempts = [];
    const tryCount = Math.min(maxAttempts, candidates.length);

    for (let i = 0; i < tryCount; i++) {
      const config = candidates[i];
      const t0 = Date.now();
      try {
        const result = await callProvider(config, req);
        const latency = Date.now() - t0;
        this.store.setHealth(config.id, {
          status: "healthy",
          lastError: null,
          latencyMs: latency,
          cooldownUntil: null,
        });
        // Increment success counter
        const c = this.store.get(config.id);
        if (c) c.health.successCount = (c.health.successCount ?? 0) + 1;
        return {
          ...result,
          attempts,
          usedConfig: config.id,
          failoverFrom: attempts[0]?.configId ?? null,
        };
      } catch (e) {
        const latency = Date.now() - t0;
        const status = e instanceof ProviderError ? e.status : 0;
        const isRateLimit = status === 429 || /rate/i.test(e.message);
        const isServerError = status >= 500 && status < 600;
        const healthStatus = isRateLimit ? "rate-limited" : isServerError ? "degraded" : "unhealthy";
        const cooldownMs = isRateLimit
          ? RATE_LIMIT_COOLDOWN_MS
          : isServerError
            ? SERVER_ERROR_COOLDOWN_MS
            : TRANSIENT_COOLDOWN_MS;
        this.store.setHealth(config.id, {
          status: healthStatus,
          lastError: e.message.slice(0, 200),
          latencyMs: latency,
          cooldownUntil: new Date(Date.now() + cooldownMs).toISOString(),
        });
        const c = this.store.get(config.id);
        if (c) c.health.failureCount = (c.health.failureCount ?? 0) + 1;
        attempts.push({
          configId: config.id,
          provider: config.provider,
          model: config.model,
          category: config.category,
          priority: config.priority,
          status: healthStatus,
          httpStatus: status,
          error: e.message.slice(0, 200),
          latencyMs: latency,
        });
        // Continue to next candidate.
      }
    }
    const err = new Error(
      `All ${tryCount} LLM candidate(s) in category "${category}" failed. ` +
      `Last error: ${attempts.at(-1)?.error ?? "unknown"}`,
    );
    err.attempts = attempts;
    throw err;
  }

  /**
   * Cheap reachability check. Sends a tiny "ping" message. Returns
   * { ok, latencyMs, provider, model, error? }.
   */
  async ping(config) {
    const t0 = Date.now();
    try {
      const result = await callProvider(config, {
        messages: [{ role: "user", content: "ping" }],
        maxTokens: 4,
        temperature: 0,
      });
      const latency = Date.now() - t0;
      this.store.setHealth(config.id, {
        status: "healthy",
        lastError: null,
        latencyMs: latency,
        cooldownUntil: null,
      });
      return { ok: true, latencyMs: latency, provider: result.provider, model: result.model };
    } catch (e) {
      this.store.setHealth(config.id, {
        status: "unhealthy",
        lastError: e.message.slice(0, 200),
      });
      return { ok: false, error: e.message.slice(0, 200) };
    }
  }

  /**
   * A config is "available" if it's enabled AND not currently in a
   * cooldown window. Cooldown is set by previous failed attempts
   * (rate-limit → 60s, server error → 5s, transient → 1s).
   */
  isAvailable(c) {
    if (!c.enabled) return false;
    if (c.health?.cooldownUntil) {
      const until = new Date(c.health.cooldownUntil).getTime();
      if (until > Date.now()) return false;
    }
    return true;
  }

  /** Number of configs in a category that are currently usable. */
  availableCount(category) {
    return this.store.list({ category, enabledOnly: true }).filter((c) => this.isAvailable(c)).length;
  }

  /** Total configs in a category (enabled or not). */
  totalCount(category) {
    return this.store.list({ category }).length;
  }
}

function categoryEnvHint(category) {
  switch (category) {
    case "text":       return "OPENAI_API_KEY or similar";
    case "reasoning":  return "ANTHROPIC_API_KEY or similar";
    case "multimodal": return "NVIDIA_API_KEY or similar";
    default:           return "an LLM_API_KEY env var";
  }
}
