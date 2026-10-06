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

/**
 * List all archaeology skills. They are NOT deleted — they live in
 * the manifest with status="archaeology" so the organism can REUSE,
 * RECOMBINE, or SYNTHESIZE new skills from them.
 */
export async function listArchaeologySkills(workspaceRoot) {
  const manifestPath = path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library", "manifest.json");
  try {
    const m = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
    return (m.skills ?? []).filter((s) => s.status === "archaeology");
  } catch {
    return [];
  }
}

/**
 * Restore a skill from archaeology. Sets status back to "active"
 * and clears the archived metadata. The skill returns to the
 * active skill set and is available for candidates() again.
 */
export async function restoreSkill(workspaceRoot, skillKey, reason) {
  const manifestPath = path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library", "manifest.json");
  try {
    const m = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
    const skill = (m.skills ?? []).find((s) => s.key === skillKey);
    if (!skill) return { ok: false, reason: "skill not found" };
    if (skill.status !== "archaeology") return { ok: false, reason: "skill is not in archaeology" };
    skill.wasArchaeology = true;
    skill.restoredAt = new Date().toISOString();
    skill.restoredReason = reason ?? "explicit restore";
    skill.status = "active";
    delete skill.archived_at;
    delete skill.archived_reason;
    await fs.writeFile(manifestPath, JSON.stringify(m, null, 2));
    return { ok: true, skill };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * Synthesize a new skill from one or more archaeology skills. The
 * new skill's name = "synth_" + base family, and its version is
 * bumped. Its reactivation_triggers are the union of the base
 * triggers. The base skills remain in archaeology — nothing is
 * deleted.
 *
 * Note: this writes the manifest record but does NOT write a new
 * .py file. The orchestrator (auto-reform) is the right tool to
 * actually generate the Python body; synthesizeSkill here is the
 * cognitive step that registers the synthesis as a new identity.
 */
export async function synthesizeSkill(workspaceRoot, opts) {
  const { baseSkillKeys, name, reactivationTriggers } = opts;
  if (!Array.isArray(baseSkillKeys) || baseSkillKeys.length === 0) {
    throw new Error("synthesizeSkill: baseSkillKeys[] is required");
  }
  const manifestPath = path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library", "manifest.json");
  const m = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
  const bases = (m.skills ?? []).filter((s) => baseSkillKeys.includes(s.key));
  if (bases.length === 0) throw new Error("synthesizeSkill: no base skills found");
  const family = bases[0].key.replace(/^evolved_/, "").replace(/_v\d+$/, "").replace(/_protocol$/, "");
  const newKey = name ?? `synth_${family}`;
  if ((m.skills ?? []).some((s) => s.key === newKey)) {
    return { ok: false, reason: `skill '${newKey}' already exists` };
  }
  const triggers = Array.isArray(reactivationTriggers) && reactivationTriggers.length > 0
    ? reactivationTriggers
    : Array.from(new Set(bases.flatMap((b) => b.reactivation_triggers ?? [])));
  const newSkill = {
    key: newKey,
    profession: bases[0].profession,
    version: 1,
    morph_focus: bases[0].morph_focus,
    status: "active",
    mastery: Math.max(...bases.map((b) => b.mastery ?? 0), 0),
    transferable: true,
    reactivation_triggers: triggers,
    usage_history: [],
    synthesized: true,
    parents: bases.map((b) => b.key),
    createdAt: new Date().toISOString(),
  };
  m.skills.push(newSkill);
  await fs.writeFile(manifestPath, JSON.stringify(m, null, 2));
  return { ok: true, skill: newSkill, baseCount: bases.length };
}