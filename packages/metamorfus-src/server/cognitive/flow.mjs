// server/cognitive/flow.mjs
// Flow engine + persistent morphic-code store.
//
// A Flow is a reusable composition of skills with a trigger. When the
// trigger matches the context, the flow executes its steps in order,
// passing outputs forward. Flows persist as JSON files in
// dna_library/flows/<id>.json — they are append-only, can be cloned
// and re-mixed, and they learn by emitting fitness events after each
// invocation.
//
// This is the 3rd cognitive layer the organism was missing:
//   Layer 1 — Skills     (real Python, runSkill)
//   Layer 2 — Plans      (PromptPlanner, linear one-shot)
//   Layer 3 — Flows      (this file: persistent, composable, evolving)

import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";

const ROOT = "/workspace/metamorfus-opencode/packages/metamorfus-src";

/**
 * Compose a new flow from a list of skill keys. The trigger is a
 * token-list pattern that, when present in a query, will fire this
 * flow.
 */
export async function compose(workspaceRoot, opts) {
  const { name, trigger, steps } = opts;
  if (!name || !Array.isArray(steps) || steps.length === 0) {
    throw new Error("compose: name and steps[] are required");
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const flow = {
    id,
    name,
    trigger: Array.isArray(trigger) ? trigger : [],
    steps: steps.map((s, i) => ({
      stepId: `step-${i + 1}`,
      skillKey: s.skillKey,
      // mapper decides how to feed step N's output into step N+1
      inputMapper: s.inputMapper ?? (() => ({})),
      // optional description for human readability
      description: s.description ?? "",
    })),
    fitness: { calls: 0, successes: 0, failures: 0, avgLatencyMs: 0 },
    createdAt: now,
    lastInvokedAt: null,
    parents: opts.parents ?? [],  // flows this was derived from
    generations: 0,             // how many times it has been auto-evolved
  };
  const flowDir = path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library", "flows");
  await fs.mkdir(flowDir, { recursive: true });
  await fs.writeFile(path.join(flowDir, `${id}.json`), JSON.stringify(flow, null, 2));
  return flow;
}

/**
 * List all flows on disk.
 */
export async function listFlows(workspaceRoot) {
  const flowDir = path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library", "flows");
  try {
    const files = await fs.readdir(flowDir);
    const flows = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const data = JSON.parse(await fs.readFile(path.join(flowDir, f), "utf-8"));
        flows.push(data);
      } catch {}
    }
    return flows;
  } catch {
    return [];
  }
}

/**
 * Get a flow by id.
 */
export async function getFlow(workspaceRoot, id) {
  const flowDir = path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library", "flows");
  try {
    const data = await fs.readFile(path.join(flowDir, `${id}.json`), "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Save (persist) a flow — used after fitness updates.
 */
async function saveFlow(workspaceRoot, flow) {
  const flowDir = path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library", "flows");
  await fs.writeFile(path.join(flowDir, `${flow.id}.json`), JSON.stringify(flow, null, 2));
}

/**
 * Invoke a flow end-to-end. The output of step N is passed to step
 * N+1 via the inputMapper (default: pass-through of prior result).
 * Each step uses the real skills/runner.mjs so usage_history is
 * recorded for every skill in the chain.
 *
 * Returns the final step's output plus per-step record. Fitness is
 * updated on success/failure.
 */
export async function invokeFlow(workspaceRoot, flow, initialContext) {
  if (!flow || !Array.isArray(flow.steps)) {
    return { ok: false, error: "invalid flow" };
  }
  const { runSkill } = await import(path.join(ROOT, "server/skills/runner.mjs"));
  const startedAt = Date.now();
  const records = [];
  let context = initialContext ?? {};
  let failed = false;
  for (let i = 0; i < flow.steps.length; i++) {
    const step = flow.steps[i];
    const input = typeof step.inputMapper === "function" ? step.inputMapper(context, i) : context;
    const result = await runSkill(workspaceRoot, {
      skillKey: step.skillKey,
      byProfession: context.profession ?? "unknown",
      context: input,
    });
    records.push({
      stepId: step.stepId,
      skillKey: step.skillKey,
      ok: result.ok,
      exitCode: result.exitCode,
      result: result.result,
      durationMs: result.durationMs,
    });
    if (!result.ok) {
      failed = true;
      break;
    }
    context = { ...context, [`step_${i + 1}_result`]: result.result };
  }
  const totalMs = Date.now() - startedAt;

  // Update fitness
  flow.fitness.calls = (flow.fitness.calls ?? 0) + 1;
  if (failed) flow.fitness.failures = (flow.fitness.failures ?? 0) + 1;
  else flow.fitness.successes = (flow.fitness.successes ?? 0) + 1;
  const prevAvg = flow.fitness.avgLatencyMs ?? 0;
  flow.fitness.avgLatencyMs = Math.round(((prevAvg * (flow.fitness.calls - 1)) + totalMs) / flow.fitness.calls);
  flow.lastInvokedAt = new Date().toISOString();
  await saveFlow(workspaceRoot, flow);

  return {
    ok: !failed,
    records,
    fitness: flow.fitness,
    totalMs,
    finalResult: records[records.length - 1]?.result ?? null,
  };
}

/**
 * Match a query against all flows' trigger lists. Returns flows
 * ranked by trigger overlap. Used by the discrimination engine.
 */
export async function matchFlows(workspaceRoot, query) {
  const flows = await listFlows(workspaceRoot);
  const q = (query ?? "").toLowerCase();
  const queryTokens = new Set(q.split(/\W+/).filter((t) => t.length > 2));
  const ranked = [];
  for (const flow of flows) {
    let score = 0;
    for (const trig of flow.trigger ?? []) {
      if (queryTokens.has(String(trig).toLowerCase())) score += 3;
      else if (q.includes(String(trig).toLowerCase())) score += 1;
    }
    if (score > 0) {
      const fitness = flow.fitness ?? {};
      const successRate = (fitness.calls ?? 0) > 0
        ? (fitness.successes ?? 0) / fitness.calls
        : 0.5;
      score += successRate * 2;
      ranked.push({ flow, score });
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.map((r) => r.flow);
}

/**
 * Mark a flow as evolved (forked). The original stays on disk; the
 * fork is a new flow that supersedes it. Used by auto-reformulation.
 */
export async function forkFlow(workspaceRoot, parentId, newSteps, reason) {
  const parent = await getFlow(workspaceRoot, parentId);
  if (!parent) throw new Error(`forkFlow: parent ${parentId} not found`);
  return await compose(workspaceRoot, {
    name: `${parent.name} (v${(parent.generations || 0) + 1})`,
    trigger: parent.trigger,
    steps: newSteps,
    parents: [parent.id],
  }).then((f) => {
    f.generations = (parent.generations || 0) + 1;
    f.forkReason = reason ?? "no reason recorded";
    return saveFlow(workspaceRoot, f).then(() => f);
  });
}

/**
 * Mark a flow as archaeology (decommissioned). Its file is renamed
 * with a .archaeology suffix — the flow is NOT deleted (append-only
 * by design) but is excluded from listFlows and matchFlows.
 */
export async function decommissionFlow(workspaceRoot, flowId, reason) {
  const flowDir = path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library", "flows");
  const src = path.join(flowDir, `${flowId}.json`);
  const dst = path.join(flowDir, `${flowId}.json.archaeology`);
  try {
    const data = JSON.parse(await fs.readFile(src, "utf-8"));
    data.archivedAt = new Date().toISOString();
    data.archivedReason = reason ?? "superseded";
    await fs.writeFile(src, JSON.stringify(data, null, 2));
    await fs.rename(src, dst);
    return true;
  } catch {
    return false;
  }
}