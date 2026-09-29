// Action Router — takes the (intent, args) produced by IntentParser
// and dispatches it to the right backend. Each action returns a
// result that the chat handler renders to the user.
//
// The router is the place where natural-language intent becomes
// real side effects: forging a skill, mutating a botnet, spawning
// nodes, running metamorphosis, etc.

import crypto from "node:crypto";

export class ActionRouter {
  /**
   * @param {{
   *   llmRouter: import("../llm-library/router.mjs").LlmRouter,
   *   botnetLibrary: import("../botnet/library.mjs").BotnetLibrary,
   *   swarmManager: import("../swarm/swarm-manager.mjs").SwarmManager,
   *   orchestrator: import("../metamorfose/orchestrator.mjs").MetamorphoseOrchestrator,
   *   planner: import("../metamorfose/prompt-planner.mjs").PromptPlanner,
   *   forgeSkill: Function,
   *   dnaDir: string,
   *   forgeSkillFromTemplate?: Function,
   * }} deps
   */
  constructor(deps) {
    this.deps = deps;
    /** @type {Map<string, {modelId: string, nodes: Array<{id: string, pid: number|null, alive: boolean}>}>} */
    this.runs = new Map();
    this.runObservers = new Set();
  }

  onRunChange(fn) { this.runObservers.add(fn); return () => this.runObservers.delete(fn); }
  notifyRun(run) { for (const fn of this.runObservers) try { fn(run); } catch { /* */ } }

  listRuns() {
    return Array.from(this.runs.entries()).map(([runId, run]) => ({ runId, ...run }));
  }

  getRun(runId) {
    const r = this.runs.get(runId);
    if (!r) return null;
    return { runId, ...r };
  }

  async resolveModelId(arg) {
    if (!arg) throw new Error("modelId or modelName required");
    if (typeof arg === "string") {
      // Try UUID first.
      const m = this.deps.botnetLibrary.get(arg);
      if (m) return m.id;
    }
    if (arg.modelId) {
      const m = this.deps.botnetLibrary.get(arg.modelId);
      if (m) return m.id;
    }
    if (arg.modelName) {
      const all = this.deps.botnetLibrary.list();
      const hit = all.find((m) => m.name.toLowerCase() === String(arg.modelName).toLowerCase());
      if (hit) return hit.id;
    }
    throw new Error(`botnet model not found: ${JSON.stringify(arg)}`);
  }

  async dispatch(intent, args) {
    switch (intent) {
      case "chat":                  return { kind: "chat", payload: null };
      case "system_status":         return await this._status();
      case "list_botnet_models":    return await this._listModels(args);
      case "forge_botnet_model":    return await this._forgeModel(args);
      case "mutate_botnet_model":   return await this._mutateModel(args);
      case "spawn_botnet":          return await this._spawn(args);
      case "broadcast_botnet":      return await this._broadcast(args);
      case "list_botnet_runs":      return await this._listRuns();
      case "kill_botnet":           return await this._killRun(args);
      case "forge_skill":           return await this._forgeSkill(args);
      case "metamorphose":          return await this._metamorphose(args);
      default:
        return { kind: "unknown", payload: { intent } };
    }
  }

  async _status() {
    const models = this.deps.botnetLibrary.list();
    const runs = this.listRuns();
    return {
      kind: "system_status",
      payload: {
        models: models.length,
        runs: runs.length,
        liveNodes: runs.reduce((acc, r) => acc + r.nodes.filter((n) => n.alive).length, 0),
      },
    };
  }

  async _listModels(args) {
    const all = this.deps.botnetLibrary.list();
    const filtered = args.kind ? all.filter((m) => m.kind === args.kind) : all;
    return { kind: "list_botnet_models", payload: { models: filtered } };
  }

  async _forgeModel(args) {
    if (!args.name) throw new Error("forge_botnet_model: name is required");
    if (!args.kind) args.kind = "generic";
    const m = await this.deps.botnetLibrary.create(args);
    return { kind: "forge_botnet_model", payload: { model: m } };
  }

  async _mutateModel(args) {
    // Allow the LLM to pass either parentId OR modelName. We resolve
    // modelName → parentId when needed.
    let parentId = args.parentId;
    if (!parentId && args.modelName) {
      const hit = this.deps.botnetLibrary.list().find((m) => m.name.toLowerCase() === String(args.modelName).toLowerCase());
      if (hit) parentId = hit.id;
    }
    if (!parentId) throw new Error("mutate_botnet_model: parentId or modelName required");
    // Drop modelName from the patch so it doesn't pollute the new model.
    const { modelName: _mn, parentId: _pid, ...patch } = args;
    const child = await this.deps.botnetLibrary.mutate(parentId, patch);
    return { kind: "mutate_botnet_model", payload: { model: child } };
  }

  async _spawn(args) {
    const modelId = await this.resolveModelId(args);
    const model = this.deps.botnetLibrary.get(modelId);
    if (!model) throw new Error(`model ${modelId} not found`);
    const count = Math.max(1, Math.min(32, Number(args.count) || 1));
    const runId = `run-${crypto.randomUUID().slice(0, 8)}`;
    const nodes = [];
    for (let i = 0; i < count; i++) {
      try {
        // SwarmManager.spawn() returns {id, pid, alive, ...}
        const info = await this.deps.swarmManager.spawn();
        nodes.push({ id: info.id, pid: info.pid, alive: info.alive });
      } catch (e) {
        nodes.push({ id: `${model.name}-${runId}-${i + 1}`, pid: null, alive: false, error: e.message });
      }
    }
    this.runs.set(runId, { modelId, modelName: model.name, startedAt: new Date().toISOString(), nodes });
    const run = this.getRun(runId);
    this.notifyRun(run);
    return { kind: "spawn_botnet", payload: { run } };
  }

  async _broadcast(args) {
    const modelId = await this.resolveModelId(args);
    if (!args.pythonSource) throw new Error("broadcast_botnet: pythonSource is required");
    const runs = this.listRuns().filter((r) => r.modelId === modelId);
    if (runs.length === 0) throw new Error("no live runs for this botnet model — spawn it first");
    const results = [];
    for (const run of runs) {
      const aliveNodes = run.nodes.filter((n) => n.alive);
      for (const node of aliveNodes) {
        try {
          const r = await this.deps.swarmManager.execOnNode(node.id, args.pythonSource, args.timeoutMs ?? 15_000);
          await this.deps.botnetLibrary.recordTask(modelId, { success: r.ok, latencyMs: r.durationMs });
          results.push({
            runId: run.runId, nodeId: node.id, ok: r.ok,
            stdout: r.stdout?.slice(0, 500),
            stderr: r.stderr?.slice(0, 200),
            durationMs: r.durationMs,
          });
        } catch (e) {
          await this.deps.botnetLibrary.recordTask(modelId, { success: false, latencyMs: 0 });
          results.push({ runId: run.runId, nodeId: node.id, ok: false, error: e.message });
        }
      }
    }
    return { kind: "broadcast_botnet", payload: { results } };
  }

  async _listRuns() {
    return { kind: "list_botnet_runs", payload: { runs: this.listRuns() } };
  }

  async _killRun(args) {
    // Accept runId OR "all" (or no arg at all when the user says
    // "kill all" / "kill everything"). Resolve modelName → that
    // botnet's run if provided.
    const killed = [];
    if (!args.runId || args.runId === "all" || args.modelName) {
      let targets = Array.from(this.runs.entries());
      if (args.modelName) {
        const hit = this.deps.botnetLibrary.list().find((m) => m.name.toLowerCase() === String(args.modelName).toLowerCase());
        if (!hit) throw new Error(`botnet model not found: ${args.modelName}`);
        targets = targets.filter(([, r]) => r.modelId === hit.id);
      }
      for (const [runId, run] of targets) {
        for (const n of run.nodes) {
          try { this.deps.swarmManager.killNode(n.id); } catch { /* */ }
        }
        this.runs.delete(runId);
        killed.push(runId);
      }
      this.notifyRun({ killedAll: true, runIds: killed });
      return { kind: "kill_botnet", payload: { killedAll: true, runIds: killed } };
    }
    const run = this.runs.get(args.runId);
    if (!run) throw new Error(`run not found: ${args.runId}`);
    for (const n of run.nodes) {
      try { this.deps.swarmManager.killNode(n.id); } catch { /* ignore */ }
    }
    this.runs.delete(args.runId);
    this.notifyRun({ runId: args.runId, removed: true });
    return { kind: "kill_botnet", payload: { runId: args.runId } };
  }

  async _forgeSkill(args) {
    if (!args.skillKey || !args.pythonSource) {
      throw new Error("forge_skill: skillKey + pythonSource required");
    }
    const r = await this.deps.forgeSkill({ skillKey: args.skillKey, pythonSource: args.pythonSource });
    return { kind: "forge_skill", payload: r };
  }

  async _metamorphose(args) {
    if (!args.systemPrompt) throw new Error("metamorphose: systemPrompt required");
    // 1. Plan via LLM.
    const planResult = await this.deps.planner.plan(args.systemPrompt);
    // 2. Execute the plan. The orchestrator expects plan.steps directly,
    // but the planner returns planResult.plan which is the LLM's outer
    // shape {id, domain, plan: {steps: [...]}, ...}. Drill in.
    const innerPlan = planResult.plan?.plan ?? planResult.plan;
    const report = await this.deps.orchestrator.run({
      id: planResult.id,
      systemPrompt: args.systemPrompt,
      plan: innerPlan,
    });
    return { kind: "metamorphose", payload: { plan: planResult, report } };
  }
}
