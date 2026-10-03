// LLM API Library — persistent store for the operator's configured
// language-model providers. Each entry is a real API credential + the
// category the organism uses it for: text, reasoning, or multimodal.
//
// Backed by a JSON file so config survives restarts. The store also
// tracks per-config health state (last check, latency, cooldown until)
// so the router can skip known-bad providers without re-trying.
//
// The library is the operator's inventory. The router (router.mjs)
// consults it on every LLM call to pick the best available model and
// to fail over when one is rate-limited or down.

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const CATEGORIES = ["text", "reasoning", "multimodal"];

export class LlmLibraryStore {
  /**
   * @param {string} filePath  JSON file backing the store. Default
   *   `data/llm-library.json` relative to CWD. Pass an absolute path
   *   in tests to keep them hermetic.
   */
  constructor(filePath = "data/llm-library.json") {
    this.filePath = filePath;
    /** @type {Array<any>} */
    this.configs = [];
    this.observers = new Set();
    this._saveTimer = null;
    /**
     * Monotonic clock for `updatedAt` / `createdAt`. We use
     * `performance.now()`-derived ms (with a Date.now() floor) so that
     * back-to-back calls always produce strictly increasing timestamps
     * even within the same wall-clock millisecond.
     */
    this._now = (() => {
      const t0 = Date.now();
      let counter = 0;
      return () => {
        // Always advance at least 1 ms per call so `updatedAt > createdAt`.
        counter = Math.max(counter + 1, Math.floor(performance.now()) - t0 + 1);
        return new Date(t0 + counter).toISOString();
      };
    })();
  }

  // ─── load / save ─────────────────────────────────────────────────

  async load() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("library file is not an array");
      this.configs = parsed;
    } catch (e) {
      if (e && e.code === "ENOENT") {
        this.configs = this.defaults();
        await this.save();
      } else {
        throw e;
      }
    }
    return this.configs;
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.configs, null, 2), "utf8");
    this.notify("save", { count: this.configs.length });
  }

  scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.save().catch(() => {});
    }, 5_000);
  }

  /**
   * Seed the library from env vars on first run. The operator may
   * have any of these set:
   *
   *   NVIDIA_API_KEY     → NVIDIA NIM (multimodal)
   *   OPENAI_API_KEY     → OpenAI (text + reasoning)
   *   ANTHROPIC_API_KEY  → Anthropic Claude (reasoning)
   *   GOOGLE_API_KEY     → Google Gemini (multimodal)
   *   GROQ_API_KEY       → Groq (text, fast)
   *
   * Each non-empty key becomes a default entry. Operators can edit
   * priorities, models, or disable entries via the API.
   */
  defaults() {
    const out = [];
    const ts = () => this._now();
    const envConfigs = [
      {
        envKey: "NVIDIA_API_KEY",
        name: "NVIDIA NIM (env)",
        provider: "nvidia-direct",
        category: "multimodal",
        endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
        model: "moonshotai/kimi-k2-instruct-0905",
        priority: 100,
        metadata: { contextWindow: 128000, source: "env" },
      },
      {
        envKey: "OPENAI_API_KEY",
        name: "OpenAI (env)",
        provider: "openai-compatible",
        category: "text",
        endpoint: "https://api.openai.com/v1/chat/completions",
        model: "gpt-4o-mini",
        priority: 90,
        metadata: { contextWindow: 128000, source: "env" },
      },
      {
        envKey: "ANTHROPIC_API_KEY",
        name: "Anthropic Claude (env)",
        provider: "anthropic",
        category: "reasoning",
        endpoint: "https://api.anthropic.com/v1/messages",
        model: "claude-3-5-sonnet-latest",
        priority: 95,
        metadata: { contextWindow: 200000, source: "env" },
      },
      {
        envKey: "GOOGLE_API_KEY",
        name: "Google Gemini (env)",
        provider: "google-generative-ai",
        category: "multimodal",
        endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
        model: "gemini-1.5-flash",
        priority: 80,
        metadata: { contextWindow: 1000000, source: "env" },
      },
      {
        envKey: "GROQ_API_KEY",
        name: "Groq (env)",
        provider: "openai-compatible",
        category: "text",
        endpoint: "https://api.groq.com/openai/v1/chat/completions",
        model: "llama-3.1-70b-versatile",
        priority: 85,
        metadata: { contextWindow: 128000, source: "env", fastInference: true },
      },
    ];
    for (const cfg of envConfigs) {
      const key = process.env[cfg.envKey];
      if (typeof key === "string" && key.length > 0) {
        out.push({
          id: crypto.randomUUID(),
          name: cfg.name,
          provider: cfg.provider,
          category: cfg.category,
          endpoint: cfg.endpoint,
          apiKey: key,
          model: cfg.model,
          priority: cfg.priority,
          enabled: true,
          metadata: cfg.metadata,
          health: freshHealth(),
          createdAt: ts(),
          updatedAt: ts(),
        });
      }
    }
    return out;
  }

  // ─── CRUD ────────────────────────────────────────────────────────

  /**
   * @param {{
   *   name: string,
   *   provider: string,
   *   category: "text"|"reasoning"|"multimodal",
   *   endpoint: string,
   *   apiKey: string,
   *   model: string,
   *   priority?: number,
   *   enabled?: boolean,
   *   metadata?: Record<string, any>,
   *   id?: string,
   * }} config
   */
  async add(config) {
    if (!CATEGORIES.includes(config.category)) {
      throw new Error(`invalid category: ${config.category}. Must be one of ${CATEGORIES.join(", ")}`);
    }
    if (typeof config.endpoint !== "string" || config.endpoint.length === 0) {
      throw new Error("endpoint is required");
    }
    if (typeof config.apiKey !== "string" || config.apiKey.length === 0) {
      throw new Error("apiKey is required");
    }
    if (typeof config.model !== "string" || config.model.length === 0) {
      throw new Error("model is required");
    }
    const entry = {
      id: config.id ?? crypto.randomUUID(),
      name: config.name ?? "unnamed",
      provider: config.provider ?? "openai-compatible",
      category: config.category,
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      model: config.model,
      priority: Number.isFinite(config.priority) ? Number(config.priority) : 100,
      enabled: config.enabled !== false,
      metadata: config.metadata ?? {},
      health: freshHealth(),
      createdAt: this._now(),
      updatedAt: this._now(),
    };
    this.configs.push(entry);
    await this.save();
    this.notify("add", entry);
    return entry;
  }

  async update(id, patch) {
    const idx = this.configs.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error(`config not found: ${id}`);
    // Never overwrite health via update — that's the monitor's job.
    const { health: _h, id: _id, createdAt: _c, ...safe } = patch;
    this.configs[idx] = {
      ...this.configs[idx],
      ...safe,
      updatedAt: this._now(),
    };
    await this.save();
    this.notify("update", this.configs[idx]);
    return this.configs[idx];
  }

  async remove(id) {
    const idx = this.configs.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error(`config not found: ${id}`);
    const [removed] = this.configs.splice(idx, 1);
    await this.save();
    this.notify("remove", removed);
    return removed;
  }

  /**
   * Return a public view of the library — keys are masked, internal
   * fields are stripped. Use this for GET endpoints.
   */
  listPublic({ category, enabledOnly = false } = {}) {
    return this.configs
      .filter((c) => {
        if (category && c.category !== category) return false;
        if (enabledOnly && !c.enabled) return false;
        return true;
      })
      .map((c) => publicView(c));
  }

  /** Internal view — keeps the apiKey. Use this from the router. */
  list({ category, enabledOnly = false } = {}) {
    return this.configs.filter((c) => {
      if (category && c.category !== category) return false;
      if (enabledOnly && !c.enabled) return false;
      return true;
    });
  }

  get(id) {
    return this.configs.find((c) => c.id === id) ?? null;
  }

  getPublic(id) {
    const c = this.get(id);
    return c ? publicView(c) : null;
  }

  setHealth(id, patch) {
    const c = this.get(id);
    if (!c) return;
    c.health = { ...c.health, ...patch, lastCheck: new Date().toISOString() };
    this.notify("health", c);
    this.scheduleSave();
  }

  on(fn) {
    this.observers.add(fn);
    return () => this.observers.delete(fn);
  }

  notify(event, payload) {
    for (const fn of this.observers) {
      try { fn(event, payload); } catch { /* observer errors are not fatal */ }
    }
  }
}

function freshHealth() {
  return {
    status: "unknown",        // unknown | healthy | rate-limited | degraded | unhealthy
    lastCheck: null,
    lastError: null,
    latencyMs: null,
    cooldownUntil: null,
    successCount: 0,
    failureCount: 0,
  };
}

function publicView(c) {
  return {
    id: c.id,
    name: c.name,
    provider: c.provider,
    category: c.category,
    endpoint: c.endpoint,
    apiKey: maskKey(c.apiKey),
    apiKeySet: Boolean(c.apiKey),
    model: c.model,
    priority: c.priority,
    enabled: c.enabled,
    metadata: c.metadata,
    health: c.health,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function maskKey(k) {
  if (!k || k.length < 8) return "****";
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}
