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
   * have NVIDIA_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY,
   * GOOGLE_API_KEY, or GROQ_API_KEY set — we don't auto-add them
   * silently; we expose them as suggestions through /api/llm-library.
   * For now, we DO auto-add NVIDIA_API_KEY (single model, single
   * key) because the rest of the headless server already assumes it.
   */
  defaults() {
    const out = [];
    if (process.env.NVIDIA_API_KEY && process.env.NVIDIA_API_KEY.length > 0) {
      out.push({
        id: crypto.randomUUID(),
        name: "NVIDIA NIM (env)",
        provider: "nvidia-direct",
        category: "multimodal",
        endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
        apiKey: process.env.NVIDIA_API_KEY,
        model: "moonshotai/kimi-k3",
        priority: 100,
        enabled: true,
        metadata: { contextWindow: 128000, source: "env" },
        health: freshHealth(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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
      updatedAt: new Date().toISOString(),
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
