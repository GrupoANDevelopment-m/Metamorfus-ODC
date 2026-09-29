// Botnet Library — the operator's catalog of specialized botnet
// models. Each botnet is a fleet of swarm nodes with shared DNA
// (skills + dependencies + specialization). Models are stored as
// JSON files under `data/botnets/<id>.json` so they persist across
// restarts.
//
// Model schema:
//
//   {
//     id:        string (uuid)
//     name:      string   e.g. "vision-cluster-v1"
//     kind:      string   e.g. "vision" | "research" | "trading"
//     generation: number  1, 2, 3, ... (evolution lineage)
//     parent:    string|null  parent model id (for evolution tree)
//     skills:    string[]  skill keys the botnet uses
//     deps:      { pip?: string[], npm?: string[], system?: string[] }
//     endpoints: { host: string, port: number }
//     dna:       { specialization: string, fitness: number }
//     stats:     { tasksCompleted, successCount, failureCount, avgLatencyMs }
//     createdAt: ISO string
//     updatedAt: ISO string
//   }
//
// The library is append-only for the audit trail (mutations create
// new generations instead of overwriting). This is the same philosophy
// as the Metamorfus DNA library: we don't lose history.

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const KIND_PRESETS = {
  vision:    { skills: ["vision_describe_protocol", "image_resize_protocol"],     deps: { pip: ["Pillow"] } },
  research:  { skills: ["arxiv_search_protocol", "pdf_extract_protocol", "semantic_summarize_protocol"], deps: { pip: ["arxiv", "pypdf2"] } },
  trading:   { skills: ["market_data_protocol", "signal_gen_protocol", "risk_check_protocol"],          deps: { pip: ["ccxt", "pandas-ta"] } },
  scraping:  { skills: ["http_fetch_protocol", "html_parse_protocol", "rate_limit_protocol"],           deps: { pip: ["requests", "beautifulsoup4"] } },
  security:  { skills: ["port_scan_protocol", "service_detect_protocol", "vuln_check_protocol"],        deps: { pip: ["python-nmap"] } },
  generic:   { skills: [], deps: {} },
};

export class BotnetLibrary {
  /**
   * @param {string} dataDir  Directory where botnet JSON files live.
   *   Pass a tmp path in tests to keep them hermetic.
   */
  constructor(dataDir = "data/botnets") {
    this.dataDir = dataDir;
    /** @type {Map<string, any>} */
    this.bmodels = new Map();
    this.observers = new Set();
  }

  async load() {
    await fs.mkdir(this.dataDir, { recursive: true });
    const files = await fs.readdir(this.dataDir).catch(() => []);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(this.dataDir, f), "utf8");
        const model = JSON.parse(raw);
        this.bmodels.set(model.id, model);
      } catch {
        /* skip malformed */
      }
    }
    return this.bmodels;
  }

  async save(model) {
    await fs.mkdir(this.dataDir, { recursive: true });
    const file = path.join(this.dataDir, `${model.id}.json`);
    await fs.writeFile(file, JSON.stringify(model, null, 2));
    this.notify("save", model);
  }

  /**
   * Create a new botnet model from a kind + custom config. If `kind`
   * is a known preset, we pre-fill skills and deps. Otherwise we
   * accept whatever the operator passed.
   */
  async create({ name, kind = "generic", parent = null, skills, deps, specialization, ...rest }) {
    if (!name || typeof name !== "string") throw new Error("name is required");
    const preset = KIND_PRESETS[kind] ?? KIND_PRESETS.generic;
    const model = {
      id: crypto.randomUUID(),
      name,
      kind,
      generation: parent ? (this.get(parent)?.generation ?? 0) + 1 : 1,
      parent,
      skills: Array.isArray(skills) && skills.length > 0 ? skills : preset.skills,
      deps: { ...preset.deps, ...(deps ?? {}) },
      endpoints: rest.endpoints ?? { host: "127.0.0.1", port: 0 },
      dna: {
        specialization: specialization ?? `Botnet specialized in ${kind}`,
        fitness: 0.5, // unknown until we have signal
      },
      stats: {
        tasksCompleted: 0,
        successCount: 0,
        failureCount: 0,
        avgLatencyMs: 0,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.bmodels.set(model.id, model);
    await this.save(model);
    this.notify("create", model);
    return model;
  }

  /**
   * Mutate an existing botnet: clone to a new generation with adjusted
   * skills, deps, or specialization. Returns the new model. The parent
   * stays in the library — history is preserved.
   */
  async mutate(parentId, patch) {
    const parent = this.get(parentId);
    if (!parent) throw new Error(`parent not found: ${parentId}`);
    return await this.create({
      name: patch.name ?? `${parent.name}-g${parent.generation + 1}`,
      kind: parent.kind,
      parent: parent.id,
      skills: patch.skills ?? parent.skills,
      deps: patch.deps ?? parent.deps,
      specialization: patch.specialization ?? parent.dna.specialization,
    });
  }

  async remove(id) {
    const m = this.bmodels.get(id);
    if (!m) throw new Error(`not found: ${id}`);
    this.bmodels.delete(id);
    try {
      await fs.unlink(path.join(this.dataDir, `${id}.json`));
    } catch { /* may be missing */ }
    this.notify("remove", m);
    return m;
  }

  get(id) { return this.bmodels.get(id) ?? null; }
  list() { return Array.from(this.bmodels.values()); }
  listByKind(kind) { return this.list().filter((m) => m.kind === kind); }

  /** Update stats for a botnet after a task. Fitness is a moving
   *  average of success rate, normalized 0-1. */
  async recordTask(id, { success, latencyMs }) {
    const m = this.get(id);
    if (!m) return;
    m.stats.tasksCompleted += 1;
    if (success) m.stats.successCount += 1;
    else         m.stats.failureCount += 1;
    // Exponential moving average for latency (alpha = 0.1).
    const alpha = 0.1;
    m.stats.avgLatencyMs =
      m.stats.avgLatencyMs === 0
        ? latencyMs
        : Math.round(alpha * latencyMs + (1 - alpha) * m.stats.avgLatencyMs);
    // Fitness = success rate, floored at 0.05 so we never forget a botnet.
    const rate = m.stats.tasksCompleted > 0
      ? m.stats.successCount / m.stats.tasksCompleted
      : 0.5;
    m.dna.fitness = Math.max(0.05, Math.min(1.0, rate));
    m.updatedAt = new Date().toISOString();
    await this.save(m);
    this.notify("stats", m);
    return m;
  }

  /** Build a lineage tree (parents → children) for visualization. */
  lineage() {
    const all = this.list();
    const byParent = new Map();
    for (const m of all) {
      const key = m.parent ?? "__root__";
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(m.id);
    }
    const visit = (id, depth) => {
      const m = this.get(id);
      const children = (byParent.get(id) ?? []).flatMap((c) => visit(c, depth + 1));
      return [{ id, name: m?.name ?? id, generation: m?.generation ?? 0, depth }, ...children];
    };
    const roots = byParent.get("__root__") ?? [];
    return roots.flatMap((r) => visit(r, 0));
  }

  on(fn) {
    this.observers.add(fn);
    return () => this.observers.delete(fn);
  }
  notify(event, payload) {
    for (const fn of this.observers) {
      try { fn(event, payload); } catch { /* ignore */ }
    }
  }
}

export { KIND_PRESETS };
