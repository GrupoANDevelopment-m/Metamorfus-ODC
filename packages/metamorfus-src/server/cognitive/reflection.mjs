// server/cognitive/reflection.mjs
// Reflection engine — reads usage_history, identifies patterns, and
// suggests new morphic code. This is the step the organism was
// missing: after skills run, the system reflects on what happened
// and proposes compositions, reformulations, or decommissions.
//
// What reflection produces:
//   • per-skill fitness (success rate, avg latency, lastUsedAt)
//   • chain detection — skills that always run together become flow candidates
//   • underperformers — skills with low success rate that should be
//     re-forged or decommissioned
//   • high-performers — skills that should be promoted to "preferred"
//   • suggested flows — ready to feed into compose()

import path from "node:path";
import fs from "node:fs/promises";

const ROOT = "/workspace/metamorfus-opencode/packages/metamorfus-src";

export async function reflect(workspaceRoot) {
  const manifestPath = path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library", "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
  } catch (e) {
    return { ok: false, reason: `cannot read manifest: ${e.message}` };
  }

  // 1. Per-skill fitness
  const fitness = [];
  for (const skill of manifest.skills ?? []) {
    const uh = Array.isArray(skill.usage_history) ? skill.usage_history : [];
    if (uh.length === 0) continue;
    const total = uh.length;
    const successes = uh.filter((u) => (u.outcome ?? 0) > 0).length;
    const failures = uh.filter((u) => (u.outcome ?? 0) < 0).length;
    const avgLatency = uh.reduce((a, u) => a + (u.duration_ms ?? 0), 0) / total;
    const lastUsedAt = uh[uh.length - 1]?.at ?? null;
    fitness.push({
      key: skill.key,
      profession: skill.profession,
      total,
      successes,
      failures,
      successRate: successes / total,
      avgLatencyMs: Math.round(avgLatency),
      lastUsedAt,
      transferable: !!skill.transferable,
    });
  }

  // 2. Chain detection — co-occurrence of skills in the same minute
  // of usage_history. A "chain" is two skills whose last-used
  // timestamps are within 60 seconds of each other (i.e. used in
  // the same session by the same caller). Strong chains become flow
  // candidates.
  const chains = [];
  const recent = (manifest.skills ?? [])
    .flatMap((s) => (s.usage_history ?? []).map((u) => ({ skillKey: s.key, profession: s.profession, at: u.at, outcome: u.outcome })))
    .filter((e) => e.at)
    .sort((a, b) => a.at.localeCompare(b.at));
  for (let i = 1; i < recent.length; i++) {
    const a = recent[i - 1];
    const b = recent[i];
    if (a.skillKey === b.skillKey) continue;
    const gapSec = (new Date(b.at) - new Date(a.at)) / 1000;
    if (gapSec >= 0 && gapSec < 60) {
      // Co-occurrence — check if this pair appears repeatedly
      const key = `${a.skillKey}->${b.skillKey}`;
      const existing = chains.find((c) => c.pair === key);
      if (existing) {
        existing.count += 1;
      } else {
        chains.push({ pair: key, from: a.skillKey, to: b.skillKey, count: 1, lastAt: b.at });
      }
    }
  }
  chains.sort((a, b) => b.count - a.count);

  // 3. Underperformers (success rate < 0.4 with at least 3 invocations)
  const underperformers = fitness.filter((f) => f.total >= 3 && f.successRate < 0.4);
  // 4. High-performers (success rate > 0.9 with at least 3 invocations)
  const highPerformers = fitness.filter((f) => f.total >= 3 && f.successRate > 0.9);

  // 5. Dormant skills (no usage in last 24h of test, but have history)
  //    Useful for detecting skills that should be re-prompted or retired.
  const dormant = fitness.filter((f) => {
    if (!f.lastUsedAt) return false;
    return Date.now() - new Date(f.lastUsedAt).getTime() > 24 * 60 * 60 * 1000;
  });

  // 6. Suggested flows — top 3 chains become morphic-code candidates
  const suggestedFlows = chains.slice(0, 3).map((c, i) => ({
    suggestedId: `auto-flow-${Date.now()}-${i}`,
    trigger: [c.from.replace(/_protocol$/, "").replace(/_/g, " ")],
    steps: [
      { skillKey: c.from, description: "first in observed chain" },
      { skillKey: c.to, description: "second in observed chain" },
    ],
    evidence: { coOccurrences: c.count, lastAt: c.lastAt },
  }));

  return {
    ok: true,
    manifestSkills: manifest.skills?.length ?? 0,
    totalInvocations: fitness.reduce((a, f) => a + f.total, 0),
    fitness,
    chains,
    underperformers,
    highPerformers,
    dormant,
    suggestedFlows,
  };
}