// server/cognitive/substitution.mjs
// Substitution engine — when a new skill version consistently
// outperforms its parent, mark the parent as archaeology. The
// system preserves functional integrity by:
//   • NOT deleting old skills (append-only)
//   • Marking them as archaeology with a reference to the successor
//   • Re-routing new invocations to the successor automatically
//
// This closes the "recombine / improve / discard" loop the organism
// was missing.

import path from "node:path";
import fs from "node:fs/promises";

const ROOT = "/workspace/metamorfus-opencode/packages/metamorfus-src";

/**
 * Evaluate whether `candidate` should replace `current`. The candidate
 * wins only if it has equal or better fitness and at least 2
 * invocations recorded. Returns a decision with reason.
 */
export function shouldSubstitute(current, candidate) {
  if (!current || !candidate) return { substitute: false, reason: "missing one" };
  if (current.key === candidate.key) return { substitute: false, reason: "same key" };
  // candidate must be related to current (same skill name family)
  const baseCurrent = current.key.replace(/^evolved_/, "").replace(/_v\d+$/, "");
  const baseCandidate = candidate.key.replace(/^evolved_/, "").replace(/_v\d+$/, "");
  if (baseCurrent !== baseCandidate) return { substitute: false, reason: "not same skill family" };
  const curF = currentFitness(current);
  const candF = currentFitness(candidate);
  if (candF.calls < 2) return { substitute: false, reason: "candidate has too few invocations" };
  if (candF.successRate < curF.successRate) {
    return { substitute: false, reason: "candidate success rate lower", current: curF, candidate: candF };
  }
  if (candF.avgLatencyMs > curF.avgLatencyMs * 1.5) {
    return { substitute: false, reason: "candidate latency too high", current: curF, candidate: candF };
  }
  return { substitute: true, reason: "candidate wins on success rate and latency", current: curF, candidate: candF };
}

function currentFitness(skill) {
  const uh = Array.isArray(skill.usage_history) ? skill.usage_history : [];
  const total = uh.length;
  const successes = uh.filter((u) => (u.outcome ?? 0) > 0).length;
  const avgLatency = total > 0 ? uh.reduce((a, u) => a + (u.duration_ms ?? 0), 0) / total : 0;
  return {
    calls: total,
    successes,
    failures: total - successes,
    successRate: total > 0 ? successes / total : 0,
    avgLatencyMs: Math.round(avgLatency),
  };
}

/**
 * Apply substitution: mark `current` as archaeology, write a pointer
 * to `candidate` in the manifest so future candidates() and recall()
 * routes to the new version.
 */
export async function applySubstitution(workspaceRoot, currentKey, candidateKey, reason) {
  const manifestPath = path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library", "manifest.json");
  const m = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
  const current = (m.skills ?? []).find((s) => s.key === currentKey);
  const candidate = (m.skills ?? []).find((s) => s.key === candidateKey);
  if (!current || !candidate) return { ok: false, error: "skill not found" };
  const decision = shouldSubstitute(current, candidate);
  if (!decision.substitute) return { ok: false, reason: decision.reason };
  current.status = "archaeology";
  current.archived_at = new Date().toISOString();
  current.archived_reason = reason ?? decision.reason;
  current.successor = candidateKey;
  candidate.predecessor = currentKey;
  candidate.promoted_at = new Date().toISOString();
  await fs.writeFile(manifestPath, JSON.stringify(m, null, 2));
  return { ok: true, decision };
}

/**
 * Walk the manifest, find all skill families that have multiple
 * versions, and substitute the older with the newer when justified.
 */
export async function runSubstitutionSweep(workspaceRoot) {
  const manifestPath = path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library", "manifest.json");
  const m = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
  const skills = m.skills ?? [];
  const byFamily = {};
  for (const s of skills) {
    const base = s.key.replace(/^evolved_/, "").replace(/_v\d+$/, "").replace(/_protocol$/, "");
    if (!byFamily[base]) byFamily[base] = [];
    byFamily[base].push(s);
  }
  const actions = [];
  for (const [base, list] of Object.entries(byFamily)) {
    if (list.length < 2) continue;
    list.sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
    const oldest = list[0];
    const newest = list[list.length - 1];
    if (oldest.key === newest.key) continue;
    if (oldest.status === "archaeology") continue;
    const r = await applySubstitution(workspaceRoot, oldest.key, newest.key, "auto-sweep");
    actions.push({ family: base, from: oldest.key, to: newest.key, ...r });
  }
  return { ok: true, actions };
}