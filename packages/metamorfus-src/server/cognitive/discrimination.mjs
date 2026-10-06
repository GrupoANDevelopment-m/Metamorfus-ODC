// server/cognitive/discrimination.mjs
// Discrimination engine — given an arbitrary context, rank the
// candidate [skill|flow] to invoke. Combines:
//   1. Trigger overlap (token match)
//   2. Cross-profession usage (transferable=true gets a boost)
//   3. Historical fitness (success rate, latency)
//   4. Chain affinity (if a skill was just used, weight its frequent
//      partners higher)
//   5. Recency (skills used recently are warmer)
//
// The user's spirit: implicit, not explicit. The user does NOT have to
// know which skill to call — the system picks it from context.

import path from "node:path";
import fs from "node:fs/promises";

const ROOT = "/workspace/metamorfus-opencode/packages/metamorfus-src";

export async function discriminate(workspaceRoot, query, opts = {}) {
  const manifestPath = path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library", "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));

  const q = (query ?? "").toLowerCase();
  const tokens = new Set(q.split(/\W+/).filter((t) => t.length > 2));
  const lastUsedKey = opts.lastUsedKey ?? null;

  // Reflect on the manifest to get fitness data
  const { reflect } = await import("./reflection.mjs");
  const reflection = await reflect(workspaceRoot);
  const fitnessByKey = Object.fromEntries((reflection.fitness ?? []).map((f) => [f.key, f]));

  // Chain affinity: which skills are commonly used right after `lastUsedKey`?
  const chainPartners = {};
  for (const c of reflection.chains ?? []) {
    if (c.from === lastUsedKey) chainPartners[c.to] = (chainPartners[c.to] ?? 0) + c.count;
    if (c.to === lastUsedKey) chainPartners[c.from] = (chainPartners[c.from] ?? 0) + c.count;
  }

  const scored = [];
  for (const skill of manifest.skills ?? []) {
    let score = 0;
    const triggers = (skill.reactivation_triggers ?? []).map((t) => t.toLowerCase());

    // (1) Trigger overlap
    for (const trig of triggers) {
      if (tokens.has(trig)) score += 4;
      else if (q.includes(trig)) score += 2;
    }

    // (2) Transferable boost
    if (skill.transferable) score += 2;

    // (3) Historical fitness
    const fit = fitnessByKey[skill.key];
    if (fit) {
      score += fit.successRate * 3;
      if (fit.successRate > 0.9) score += 1;
      if (fit.avgLatencyMs < 200) score += 0.5;  // fast is good
    }

    // (4) Chain affinity with last-used skill
    if (chainPartners[skill.key]) {
      score += Math.min(3, chainPartners[skill.key]);
    }

    // (5) Recency (last_used_at)
    if (skill.last_used_at) {
      const ageMin = (Date.now() - new Date(skill.last_used_at).getTime()) / 60000;
      if (ageMin < 5) score += 1.5;
      else if (ageMin < 60) score += 0.5;
    }

    if (score > 0) {
      scored.push({
        kind: "skill",
        key: skill.key,
        profession: skill.profession,
        transferable: !!skill.transferable,
        score,
        reason: componentsString({ triggers, hasFitness: !!fit, hasChain: !!chainPartners[skill.key], transferable: !!skill.transferable }),
      });
    }
  }

  // Also consider flows (from morphic-code store)
  const { matchFlows } = await import("./flow.mjs");
  const flows = await matchFlows(workspaceRoot, query);
  for (const flow of flows.slice(0, 5)) {
    scored.push({
      kind: "flow",
      key: flow.id,
      name: flow.name,
      score: 8 + (flow.fitness?.successes ?? 0) / Math.max(1, flow.fitness?.calls ?? 1),
      reason: `flow ${flow.steps.length} steps, fitness ${(flow.fitness?.successes ?? 0)}/${(flow.fitness?.calls ?? 0)}`,
      flow,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return {
    query,
    lastUsedKey,
    candidates: scored.slice(0, 10),
    reflection: {
      chains: reflection.chains?.slice(0, 5),
      underperformers: reflection.underperformers,
      suggestedFlows: reflection.suggestedFlows,
    },
  };
}

function componentsString(parts) {
  const out = [];
  if (parts.triggers.length) out.push(`triggers=${parts.triggers.join(",")}`);
  if (parts.transferable) out.push("transferable");
  if (parts.hasFitness) out.push("has-fitness");
  if (parts.hasChain) out.push("chain-affinity");
  return out.join(" | ");
}