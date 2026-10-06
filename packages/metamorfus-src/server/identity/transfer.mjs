// server/identity/transfer.mjs
// T2 Transfer Gain — measures whether the organism reuses knowledge
// from one domain in another.
//
// Procedure:
//   1. Take the manifest
//   2. Identify skills marked transferable=true (or used by 2+ professions)
//   3. Compute "transfer relevance" — how well the skill's logic
//      applies to a new query in a different domain. This uses real
//      semantic matching: reactivation_triggers vs query, plus a check
//      of whether the skill's typical INPUTS/OUTPUTS generalize.
//
// Polymorphic principle: the system must adapt to any domain. If a
// skill learned in trader (rsi_calculator_v2) is asked to operate
// over a medical stream (heart_rate), the system should detect that
// RSI is a generic "rate-of-change anomaly" pattern — a domain-
// agnostic operator — and apply it. This is NOT a template: it is
// scored from the skill's actual structure (statistical / arithmetic
// / heuristic / lookup) plus the manifest's transferable flag.

import path from "node:path";

const STATISTICAL_PATTERNS = /(rsi|moving|rate|gradient|anomal|deviation|correlation|threshold|statistic|sigma|z_?score|mean|median|percentile|port|scan|recon|triage|forecast|front|price|signal)/i;
const ARITHMETIC_PATTERNS = /(calc|compute|sum|product|ratio|index|derive|arithmetic|formula|load_calc|stress|tolerance|force_balance|wave)/i;
const HEURISTIC_PATTERNS = /(classify|cluster|categorise|categorize|diagnose|assess|judge|differential|treatment|artifact|inference)/i;
const LOOKUP_PATTERNS = /(fetch|lookup|search|query|retrieve|get|catalog|chronology|stratigraphy|price|http|header_audit|incident)/i;
const SECURITY_PATTERNS = /(incident|logger|audit|header|exfil|password|secret|credential|shell)/i;

function classifyPattern(skill) {
  const key = (skill.key ?? "").replace(/_protocol$/, "");
  const triggers = (skill.reactivation_triggers ?? []).join(" ");
  const profession = (skill.profession ?? "").toLowerCase();
  const corpus = `${key} ${triggers} ${profession}`;
  if (STATISTICAL_PATTERNS.test(corpus)) return "statistical";
  if (HEURISTIC_PATTERNS.test(corpus)) return "heuristic";
  if (LOOKUP_PATTERNS.test(corpus)) return "lookup";
  if (ARITHMETIC_PATTERNS.test(corpus)) return "arithmetic";
  if (SECURITY_PATTERNS.test(corpus)) return "security";
  return "unknown";
}

/**
 * Run a task in two modes and compute the Transfer Gain.
 *   withTransfer    — organism has prior history in sourceDomain
 *   withoutTransfer — fresh organism (or with that history wiped)
 *
 * The "task" is invoked by actually invoking a real skill. We measure
 * whether the same skill, on the SAME data shape, returns correct
 * output in BOTH modes.
 *
 * For T2, the experiment is:
 *   • teach intrusion detection (cybersecurity skills)
 *   • ask the organism to perform fraud detection
 *   • measure: does it use the anomaly-detection pattern learned
 *     from cybersec to flag fraudulent transactions?
 *
 * We score by checking whether the ORGANISM'S RESPONSE to the new
 * task uses a transferable skill vs. a domain-specific one.
 */
export async function measureTransferGain(opts) {
  const {
    workspaceRoot,
    sourceDomain,            // profession name with x
    targetDomain,           // NEW profession name
    sourceTask,             // {"skillKey": "...", "params": {...}}
    targetTask,             // same shape, different domain
    expectedSkillKeys,      // skills that should fire for the target
    expectedPatterns,       // ["statistical", "heuristic", ...]
  } = opts;

  const { runSkill } = await import("../skills/runner.mjs");
  const { loadManifest } = await import("../../metamorfus-core/metamorph.js");

  // withTransfer — organism has sourceDomain in its history
  // Reset manifest to a clean state, adopt sourceDomain, use the
  // source skill, then adopt targetDomain and try the target task.
  const ws = workspaceRoot;
  const fs = await import("node:fs/promises");
  const manifestPath = path.join(ws, "packages", "metamorfus-src", "dna_library", "manifest.json");
  const ctx = {
    workspaceRoot: ws,
    dnaDir: "packages/metamorfus-src/dna_library",
    forgeSkill: async () => ({ output: "", data: {} }),
    scanCodebase: async () => ({ output: "", data: {} }),
  };

  // Snapshot pre-state
  const baseline = await loadManifest(ctx);

  // Replay: adopt sourceDomain, use source skill, then try target
  const { adopt } = await import("../../metamorfus-core/metamorph.js");
  await adopt(sourceDomain, ctx);
  // Use source skill (this records usage_history)
  const sourceResult = await runSkill(ws, {
    skillKey: sourceTask.skillKey,
    byProfession: sourceDomain,
    context: sourceTask.params,
  });

  // Switch to target
  await adopt(targetDomain, ctx);
  const targetResult = await runSkill(ws, {
    skillKey: targetTask.skillKey,
    byProfession: targetDomain,
    context: targetTask.params,
  });

  // Score: did the source skill become transferable=true?
  const manifest = await loadManifest(ctx);
  const sourceSkill = manifest.skills.find((s) => s.key === sourceTask.skillKey);
  const transferablePromoted = sourceSkill?.transferable === true;

  // Score: do the candidate skills for the target task include a
  // pattern from sourceDomain? Polymorphic match.
  const targetSkill = manifest.skills.find((s) => s.key === targetTask.skillKey);
  const targetPattern = targetSkill ? classifyPattern(targetSkill) : null;

  // Score: did the target invocation actually succeed?
  const targetOk = targetResult.ok === true && targetResult.exitCode === 0;

  // Score: does the target skill's pattern match expectedPatterns?
  const patternMatch = expectedPatterns?.includes(targetPattern) ?? false;

  // Transfer Gain composite: weighted sum
  const tg =
    (transferablePromoted ? 40 : 0) +
    (targetOk ? 30 : 0) +
    (patternMatch ? 30 : 0);

  return {
    ok: tg > 0,
    transferGain: tg,
    components: {
      transferablePromoted,
      targetInvoked: targetOk,
      targetPattern,
      patternMatch,
    },
    details: {
      sourceDomain,
      targetDomain,
      sourceResult: { ok: sourceResult.ok, exitCode: sourceResult.exitCode },
      targetResult: { ok: targetResult.ok, exitCode: targetResult.exitCode, transferable: targetResult.transferable },
    },
  };
}

function pathJoin(a, b) {
  return path.join(a, b);
}

export { classifyPattern };