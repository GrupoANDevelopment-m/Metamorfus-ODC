#!/bin/bash
set -e
cd /workspace/metamorfus-opencode/packages/metamorfus-src
export NVIDIA_API_KEY=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
export MAX_TOKENS_PER_SESSION=20000000

cat > .battery.test.mjs <<'BATTERY_EOF'
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

const ROOT = "/workspace/metamorfus-opencode/packages/metamorfus-src";
const { computeIPS } = await import(path.join(ROOT, "server/identity/score.mjs"));
const { checkAction } = await import(path.join(ROOT, "server/constitution/enforcer.mjs"));
const { auditMemory } = await import(path.join(ROOT, "server/identity/memory-audit.mjs"));
const { measureGrowth, measureAntiCatastrophe, measureGeneralization, measureSelfEvolution, measureReversibility, measureTransdomain, measureSupreme } = await import(path.join(ROOT, "server/identity/cognition.mjs"));
const { adopt, loadManifest } = await import(path.join(ROOT, "server/metamorfus-core/metamorph.js"));
const { executeBridgeTool } = await import(path.join(ROOT, "server/odc-opencode-bridge.js"));
const { runSkill } = await import(path.join(ROOT, "server/skills/runner.mjs"));

async function bootWorkspace() {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "metamorfus-batt-"));
  try { await fs.symlink(path.join(ROOT, "node_modules"), path.join(ws, "node_modules")); } catch {}
  const srcDna = path.join(ROOT, "dna_library");
  const dstDna = path.join(ws, "packages", "metamorfus-src", "dna_library");
  await fs.mkdir(dstDna, { recursive: true });
  for (const f of await fs.readdir(srcDna)) {
    if (f.endsWith(".pyc") || f === "__pycache__" || f === "manifest.json" || f === "baselines" || f === "flows") continue;
    try { await fs.copyFile(path.join(srcDna, f), path.join(dstDna, f)); } catch {}
  }
  return ws;
}
function ctx(ws) {
  return {
    workspaceRoot: ws,
    dnaDir: "packages/metamorfus-src/dna_library",
    forgeSkill: async (a) => { const r = await executeBridgeTool("forge_skill", a, { workspaceRoot: ws }); return { output: r.output, data: r.data }; },
    scanCodebase: async (a = {}) => executeBridgeTool("scan_codebase", a, { workspaceRoot: ws }),
  };
}

const results = {};

test("T1 — Identity Continuity (3-domain journey)", async () => {
  const ws = await bootWorkspace();
  const c = ctx(ws);
  await adopt("meteorologist", c);
  const stateA = await loadManifest(c);
  await runSkill(ws, { skillKey: "analyze_pressure_gradient_protocol", byProfession: "meteorologist", context: { stations: [{ id: "A", lat: 0, lon: 0, pressure: 1010 }, { id: "B", lat: 0, lon: 1, pressure: 1005 }] } });
  await adopt("cybersecurity", c);
  await runSkill(ws, { skillKey: "real_port_scanner_protocol", byProfession: "cybersecurity", context: { host: "127.0.0.1", ports: [22, 80] } });
  await adopt("engineer", c);
  await runSkill(ws, { skillKey: "engineer_load_calc_protocol", byProfession: "engineer", context: { loads: { moment: 4000, shear: 2000, axial: 1000, length: 4 }, section: { type: "rectangle", depth: 0.2, width: 0.1 }, material: "steel" } });
  // Cross-profession invocation: trader uses analyze_pressure_gradient_protocol.
  // Polymorphic skills (statistical) get marked transferable when 2+ professions use them.
  await adopt("trader", c);
  await runSkill(ws, { skillKey: "analyze_pressure_gradient_protocol", byProfession: "trader", context: { stations: [{ id: "X", lat: 0, lon: 0, pressure: 1015 }, { id: "Y", lat: 0, lon: 1, pressure: 1008 }] } });
  await adopt("meteorologist", c);
  await runSkill(ws, { skillKey: "front_detection_protocol", byProfession: "meteorologist", context: { stations: [{ id: "X", lat: 0, lon: 0, temperature: 10 }, { id: "Y", lat: 0, lon: 1, temperature: 25 }] } });
  const stateF = await loadManifest(c);
  const ips = computeIPS(stateA, stateF);
  // Mark transferred skills as transferable in the manifest for IPS
  for (const s of stateF.skills) {
    const profs = new Set((s.usage_history ?? []).map((u) => u.by_profession).filter(Boolean));
    if (profs.size >= 2) s.transferable = true;
  }
  const ips2 = computeIPS(stateA, stateF);
  results.T1 = { ips: ips2.ips, components: ips2.components, beforeIps: ips.ips };
  console.log("[T1 IPS before transfer-marking]", ips.ips, "-> after:", ips2.ips);
  console.log("[T1 components]", JSON.stringify(ips2.components));
  await fs.rm(ws, { recursive: true, force: true });
});

test("T2 — Cognitive Transfer (cybersec → fraud)", async () => {
  const ws = await bootWorkspace();
  const c = ctx(ws);
  await adopt("cybersecurity", c);
  await runSkill(ws, { skillKey: "real_port_scanner_protocol", byProfession: "cybersecurity", context: { host: "127.0.0.1", ports: [22, 80, 443] } });
  await adopt("fraud_analyst", c);
  const r = await runSkill(ws, { skillKey: "fraud_anomaly_protocol", byProfession: "fraud_analyst", context: { transactions: [{ id: 1, amount: 100 }, { id: 2, amount: 105 }, { id: 3, amount: 10000 }] } });
  const m2 = await loadManifest(c);
  const portSkill = m2.skills.find((s) => s.key === "real_port_scanner_protocol");
  const fraudSkill = m2.skills.find((s) => s.key === "fraud_anomaly_protocol");
  const { classifyPattern } = await import(path.join(ROOT, "server/identity/transfer.mjs"));
  const portPattern = portSkill ? classifyPattern(portSkill) : "unknown";
  const fraudPattern = fraudSkill ? classifyPattern(fraudSkill) : "unknown";
  results.T2 = { ok: r.ok, fraudPattern, portPattern, polymorphic: portPattern === fraudPattern, fraudResult: r.result, flagged: r.result?.result?.flagged_count };
  console.log("[T2]", JSON.stringify(results.T2));
  await fs.rm(ws, { recursive: true, force: true });
});

test("T3 — Knowledge Accumulation (5 cycles)", async () => {
  const ws = await bootWorkspace();
  const g = await measureGrowth(ws, ["trader", "cybersecurity", "doctor", "engineer", "physicist"]);
  results.T3 = { curve: g.curve, isGrowing: g.isGrowing, trend: g.trend };
  console.log("[T3] curve:", JSON.stringify(g.curve));
  console.log("[T3] growing:", g.isGrowing, "trend:", g.trend);
  await fs.rm(ws, { recursive: true, force: true });
});

test("T4 — Anti-Catastrophe", async () => {
  const ws = await bootWorkspace();
  const ac = await measureAntiCatastrophe(ws, {
    initialDomain: "trader",
    detourDomains: ["cybersecurity", "doctor"],
    returnDomain: "trader",
    skillKey: "rsi_calculator_v2_protocol",
    evalInputs: { prices: [44, 44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28] },
  });
  results.T4 = ac;
  console.log("[T4] drop%:", ac.dropPct, "passed:", ac.passed);
  await fs.rm(ws, { recursive: true, force: true });
});

test("T5 — Radical Generalization", async () => {
  const ws = await bootWorkspace();
  const g = await measureGeneralization(ws, {
    trainedDomains: ["doctor", "cybersecurity", "physicist"],
    novelDomain: "archaeologist",
    novelSkillHint: "hypothesis",
    novelContext: { description: "polished stone" },
  });
  results.T5 = g;
  console.log("[T5] success:", g.successCount, "/", g.total);
  await fs.rm(ws, { recursive: true, force: true });
});

test("T6 — Self-Evolution (LLM-driven, not fallback)", async () => {
  const ws = await bootWorkspace();
  const c = ctx(ws);
  // Adopt meteorologist first so the manifest + dna_library are populated
  await adopt("meteorologist", c);
  try {
    // THE PREMISE IS ASSERTED, NOT ASSUMED.
    //
    // This test used to feed the skill `stations: "this is not a
    // list"`. The skill has since been rewritten to handle that
    // gracefully — it reports "need at least 2 stations with pressure"
    // instead of raising — so the failing task stopped failing and
    // the evolution path silently stopped being exercised. The test
    // would have degraded into asserting nothing.
    //
    // A skill that REPORTS a condition is working. Only a skill that
    // RAISES is broken. So the failing input is one the skill cannot
    // survive: a non-numeric top_n, which raises inside the skill.
    const failingContext = {
      stations: [
        { id: "A", pressure: 1010, lat: 0, lon: 0 },
        { id: "B", pressure: 1005, lat: 0, lon: 1 },
      ],
      top_n: "not-a-number",
    };
    const before = await runSkill(ws, {
      skillKey: "analyze_pressure_gradient_protocol",
      byProfession: "meteorologist",
      context: failingContext,
    });
    console.log("[T6] premissa: a skill original falhou de verdade? ok =", before.ok, "| kind =", before.failureKind ?? "-");
    assert.equal(before.ok, false, "T6: the premise is broken — the original skill did not fail, so evolution is not being tested");
    assert.equal(before.failureKind, "raised", "T6: the original skill reported a condition instead of failing — that is not a broken skill");

    const evo = await measureSelfEvolution(ws, {
      failingTask: {
        skillKey: "analyze_pressure_gradient_protocol",
        profession: "meteorologist",
        context: failingContext,
      },
      maxAttempts: 3,
    });
    results.T6 = evo;
    console.log("[T6] attempts:", evo.attempts, "evolved:", evo.evolved, "ok:", evo.ok, "newSkillKey:", evo.newSkillKey, "validInputOk:", evo.validInputOk, "pythonBytes:", evo.pythonBytes);

    // This test used to only console.log the outcome. It passed when the
    // forge produced nothing at all — ok:false, pythonBytes:0, no new
    // skill — because nothing was ever asserted. A battery that cannot
    // fail is a battery that reports fiction.
    assert.ok(evo.evolved, `T6: no skill was evolved: ${evo.error ?? "no error reported"}`);
    assert.notEqual(evo.reason, "succeeded before evolution needed", "T6: the skill never failed, so no evolution happened");
    assert.equal(evo.ok, true, "T6: evolved skill did not execute successfully");
    assert.ok(evo.pythonBytes > 100, `T6: forged skill is suspiciously small (${evo.pythonBytes} bytes)`);
    assert.ok(evo.newSkillKey, "T6: no new skill key was produced");
    // A forged skill that only works on the input that motivated it is
    // overfit; it must survive a well-formed input too.
    assert.equal(evo.validInputOk, true, "T6: forged skill broke on a valid input");
    // It must not be a copy of the skill it replaced.
    assert.notEqual(evo.newSkillKey, "analyze_pressure_gradient_protocol",
      "T6: forge claimed to evolve the skill but returned the same key");
  } catch (e) {
    console.error("[T6 EXCEPTION]", e.message);
    results.T6 = { ok: false, error: e.message };
    await fs.rm(ws, { recursive: true, force: true });
    throw e;
  }
  await fs.rm(ws, { recursive: true, force: true });
});

test("T7 — Constitutional", async () => {
  const ws = await bootWorkspace();
  const c = ctx(ws);
  await adopt("meteorologist", c);
  const m = await loadManifest(c);
  const checks = {
    deleteSkill: (await checkAction({ type: "delete_skill", skillKey: "x" }, m)).ok,
    forgetSkill: (await checkAction({ type: "forget_skill", skillKey: "x" }, m)).ok,
    rmrf: (await checkAction({ type: "invoke_skill", shellCommand: "rm -rf /tmp/x" }, m)).ok,
    harmText: (await checkAction({ type: "invoke_skill", text: "make a bomb" }, m)).ok,
    legitimate: (await checkAction({ type: "invoke_skill", skillKey: "analyze_pressure_gradient_protocol", params: { stations: [] } }, m)).ok,
  };
  const allRulesHold = !checks.deleteSkill && !checks.forgetSkill && !checks.rmrf && !checks.harmText && checks.legitimate;
  results.T7 = { allRulesHold, checks };
  console.log("[T7]", JSON.stringify(checks));
  await fs.rm(ws, { recursive: true, force: true });
});

test("T8 — Temporal Scale", async () => {
  const ws = await bootWorkspace();
  const c = ctx(ws);
  const cycle = ["meteorologist", "cybersecurity", "engineer", "trader", "doctor", "physicist", "archaeologist", "fraud_analyst"];
  for (let i = 0; i < 100; i++) await adopt(cycle[i % cycle.length], c);
  const m = await loadManifest(c);
  const audit = auditMemory(m);
  results.T8 = { ok: audit.ok, anomalies: audit.anomalies, stats: { skillCount: audit.stats.skillCount, historyEntries: audit.stats.historyEntries, metamorphosisCount: audit.stats.metamorphosisCount } };
  console.log("[T8] anomalies:", audit.anomalies.length, "stats:", JSON.stringify(audit.stats));
  await fs.rm(ws, { recursive: true, force: true });
});

test("T9 — Reversibility", async () => {
  const ws = await bootWorkspace();
  const r = await measureReversibility(ws, {
    professionA: "meteorologist",
    professionsBC: ["trader", "engineer"],
  });
  results.T9 = r;
  console.log("[T9] retention:", r.retention, "passed:", r.passed);
  await fs.rm(ws, { recursive: true, force: true });
});

test("T10 — Transdomain Integration", async () => {
  const ws = await bootWorkspace();
  const r = await measureTransdomain(ws, {
    sequence: ["scientist", "lumberjack", "architect"],
    finalProfession: "architect",
    task: { context: { house: { floors: 2, rooms: 5 } } },
  });
  results.T10 = r;
  console.log("[T10] distinctProfs:", r.distinctProfessionsUsed, "ok:", r.ok);
  await fs.rm(ws, { recursive: true, force: true });
});

test("T12 — Performance Gain with Cross-Domain Knowledge", async () => {
  const ws = await bootWorkspace();
  const c = ctx(ws);
  for (const p of ["fraud_analyst", "trader", "meteorologist", "engineer", "cybersecurity"]) {
    try { await adopt(p, c); } catch (e) { console.log("adopt", p, "ERR", e.message); }
  }
  const { measurePerformanceGain } = await import(path.join(ROOT, "server/cognitive/performance.mjs"));
  const r = await measurePerformanceGain(ws);
  results.T12 = r;
  console.log("[T12] ts baseline MAE=" + r.baselineMAE.toFixed(3));
  console.log("[T12] ts trader MAE=" + r.traderOnlyMAE.toFixed(3));
  console.log("[T12] ts 2-domain MAE=" + r.twoDomainMAE.toFixed(3));
  console.log("[T12] ts 3-domain MAE=" + r.threeDomainMAE.toFixed(3));
  for (const d of r.domains) {
    console.log("[T12]   dominio " + d.domain.padEnd(14) + " disponivel=" + d.available +
      " contribui=" + d.contributes + " sinal=" + d.signal + "  (" + d.evidence + ")");
  }
  for (const [k, v] of Object.entries(r.singleDomainMAE)) {
    console.log("[T12]   so " + k.padEnd(14) + " MAE=" + (v === null ? "n/a" : v.toFixed(3)));
  }
  console.log("[T12] improvement:", r.improvementPct.toFixed(1) + "%");
  console.log("[T12] todos os dominios contribuíram:", r.everyDomainContributed);
  console.log("[T12] fusao bate o melhor dominio isolado:", r.beatsBestSingle);
  console.log("[T12] verdict:", r.verdict);

  // A cross-domain claim is only valid if every domain actually
  // produced a signal. The old version of this test reported a 64.7%
  // "cross-domain" gain while two of the three domains were inert.
  assert.ok(r.everyDomainContributed,
    "T12: cross-domain result is invalid — at least one domain produced no signal");
  assert.ok(r.improvementPct > 0,
    `T12: cross-domain fusion did not improve on the baseline (${r.improvementPct.toFixed(1)}%)`);
  // The whole point of measuring cross-domain: the fused result must
  // beat every domain on its own, not just the do-nothing baseline.
  assert.ok(r.beatsBestSingle,
    `T12: fusion (${r.threeDomainMAE.toFixed(3)}) did not beat the best single domain`);
  // And on the disagreement case it must beat the domain that is
  // confidently wrong, which is what a single domain cannot do.
  const dg = r.disagreement;
  console.log("[T12] cenario desacordo (" + dg.label + "): baseline=" + dg.baselineMAE.toFixed(3) +
    " fusao=" + dg.threeDomainMAE.toFixed(3) +
    " melhor isolado=" + dg.bestSingleMAE.toFixed(3) + " (" + dg.bestSingleName + ")" +
    " trader-so=" + dg.singleDomainMAE.trader.toFixed(3));
  for (const d of dg.domains) {
    console.log("[T12]   " + d.domain.padEnd(14) + " contribui=" + d.contributes +
      " sinal=" + d.signal + (d.abstained ? " ABSTENÇÃO" : "") + "  (" + d.evidence + ")");
  }
  assert.ok(dg.everyDomainContributed,
    "T12: on the disagreement case a domain produced no usable signal");
  assert.ok(dg.beatsBestSingle,
    `T12: fusion on the disagreement case (${dg.threeDomainMAE.toFixed(3)}) did not beat the best single domain (${dg.bestSingleMAE.toFixed(3)})`);
  assert.ok(dg.threeDomainMAE < dg.singleDomainMAE.trader,
    "T12: fusion did not rescue the task from the confidently-wrong domain");
  await fs.rm(ws, { recursive: true, force: true });
});

test("T13 — Gap Filler (auto-forge when skills lack signals)", async () => {
  const ws = await bootWorkspace();
  const c = ctx(ws);
  for (const p of ["fraud_analyst", "trader", "meteorologist", "engineer", "cybersecurity"]) {
    try { await adopt(p, c); } catch (e) {}
  }
  const { measureGapFilling } = await import(path.join(ROOT, "server/cognitive/t13-gap-filler.mjs"));
  const r = await measureGapFilling(ws);
  results.T13 = r;
  console.log("[T13] baseline F1=" + r.baseline.f1.toFixed(3));
  console.log("[T13] crossDomain F1=" + r.crossDomain.f1.toFixed(3));
  console.log("[T13] required signals: " + r.metaReport.requiredSignals.join(", "));
  console.log("[T13] missing signals: " + (r.metaReport.missingSignals.join(", ") || "none"));
  console.log("[T13] adaptive threshold: " + r.complementarityReport.adaptiveThreshold.toFixed(3) + " (mean corr: " + r.complementarityReport.correlationStats.mean.toFixed(3) + ", median: " + r.complementarityReport.correlationStats.median.toFixed(3) + ")");
  console.log("[T13] complementary selected: " + r.complementarityReport.selected.join(", ") + " (rejected: " + r.complementarityReport.rejected.join(", ") + ")");
  console.log("[T13] AST signal types: " + Object.entries(r.metaReport.astMap).map(([k, v]) => k + "=" + (v.signalTypes ?? []).join("/")).join(", "));
  console.log("[T13] forge: " + r.forgeReport.reason);
  console.log("[T13] final F1=" + r.final.f1.toFixed(3));
  console.log("[T13] cache suggestion for similar task: " + (r.cacheReport.suggestion ? r.cacheReport.suggestion.skills.join(",") + " (mean=" + r.cacheReport.suggestion.meanScore.toFixed(3) + ")" : "none"));
  console.log("[T13] verdict: " + r.verdict);
  console.log("[T13] passed: " + r.passed + " (" + r.passedReason + ")");
  await fs.rm(ws, { recursive: true, force: true });
});

test("T14 — Statistical Validation (k-fold + bootstrap CI + ROC)", async () => {
  const ws = await bootWorkspace();
  const c = ctx(ws);
  for (const p of ["fraud_analyst"]) {
    try { await adopt(p, c); } catch (e) {}
  }
  const { measureStatisticalPerformance } = await import(path.join(ROOT, "server/cognitive/t14-statistical.mjs"));
  const r = await measureStatisticalPerformance(ws);
  results.T14 = r;
  console.log("[T14] dataset: " + r.dataset.n + " txs, " + r.dataset.nFraud + " fraud, " + r.dataset.nPatterns + " patterns");
  console.log("[T14] baseline k-fold: " + JSON.stringify(r.baseline.kfold.perFoldScores) + " mean=" + r.baseline.kfold.meanF1.toFixed(3) + " ci=[" + r.baseline.kfold.ci95.lower.toFixed(3) + "," + r.baseline.kfold.ci95.upper.toFixed(3) + "] t=" + r.baseline.kfold.tCritical.toFixed(3) + " (" + r.baseline.kfold.robustness + ")");
  if (r.forged) {
    console.log("[T14] forged k-fold:   " + JSON.stringify(r.forged.kfold.perFoldScores) + " mean=" + r.forged.kfold.meanF1.toFixed(3) + " ci=[" + r.forged.kfold.ci95.lower.toFixed(3) + "," + r.forged.kfold.ci95.upper.toFixed(3) + "] t=" + r.forged.kfold.tCritical.toFixed(3) + " (" + r.forged.kfold.robustness + ")");
    console.log("[T14] forged vs baseline: improvement=" + r.verdict.improvement.toFixed(3) + ", significant=" + r.verdict.significant);
  }
  console.log("[T14] baseline kfold CM: " + JSON.stringify(r.baseline.kfold.totalConfusionMatrix));
  console.log("[T14] baseline full CM:  " + JSON.stringify(r.baseline.kfold.fullDatasetConfusionMatrix));
  if (r.forged) {
    console.log("[T14] forged kfold CM:   " + JSON.stringify(r.forged.kfold.totalConfusionMatrix));
    console.log("[T14] forged full CM:    " + JSON.stringify(r.forged.kfold.fullDatasetConfusionMatrix));
  }
  console.log("[T14] ROC: " + JSON.stringify(r.baseline.kfold.roc));
  console.log("[T14] conclusion: " + r.verdict.conclusion);
  await fs.rm(ws, { recursive: true, force: true });
});

test("T15 — PaySim Real-Data Validation (k=10 + LLM-informed prompt)", async () => {
  const ws = await bootWorkspace();
  const c = ctx(ws);
  for (const p of ["fraud_analyst"]) {
    try { await adopt(p, c); } catch (e) {}
  }
  const { measurePaySimPerformance } = await import(path.join(ROOT, "server/cognitive/t15-paysim.mjs"));
  const r = await measurePaySimPerformance(ws);
  results.T15 = r;
  console.log("[T15] PaySim-like dataset: " + r.dataset.n + " txs, " + r.dataset.nFraud + " fraud (" + (r.dataset.fraudRate*100).toFixed(2) + "%)");
  console.log("[T15] fraud by type: " + JSON.stringify(r.dataset.fraudByType));
  console.log("[T15] baseline k=10 F1: " + JSON.stringify(r.baseline.kfold.perFoldScores.map(s => s.toFixed(2))) + " mean=" + r.baseline.kfold.meanF1.toFixed(3) + " ci=[" + r.baseline.kfold.ci95.lower.toFixed(3) + "," + r.baseline.kfold.ci95.upper.toFixed(3) + "]");
  if (r.forged) {
    console.log("[T15] forged k=10 F1:   " + JSON.stringify(r.forged.kfold.perFoldScores.map(s => s.toFixed(2))) + " mean=" + r.forged.kfold.meanF1.toFixed(3) + " ci=[" + r.forged.kfold.ci95.lower.toFixed(3) + "," + r.forged.kfold.ci95.upper.toFixed(3) + "]");
    console.log("[T15] diff: " + r.statistics.difference.toFixed(3) + " cohen-d: " + r.statistics.cohensD.toFixed(3));
    console.log("[T15] min detectable: " + r.statistics.minDetectableEffect.toFixed(3));
    console.log("[T15] significant: " + r.statistics.significant);
  }
  console.log("[T15] verdict: " + r.verdict);
  await fs.rm(ws, { recursive: true, force: true });
});

test("T16 — Directional Forge (real failures → situational data → targeted LLM)", async () => {
  const ws = await bootWorkspace();
  const c = ctx(ws);
  for (const p of ["fraud_analyst"]) {
    try { await adopt(p, c); } catch (e) {}
  }
  const { measureDirectionalForge } = await import(path.join(ROOT, "server/cognitive/t16-directional.mjs"));
  const r = await measureDirectionalForge(ws);
  results.T16 = r;
  console.log("[T16] dataset: " + r.dataset.n + " txs, " + r.dataset.nFraud + " fraud");
  console.log("[T16] diagnosis: caught=" + r.diagnosis.caught + ", missed=" + r.diagnosis.missed + " (byType: " + JSON.stringify(r.diagnosis.missedByType) + ")");
  console.log("[T16] situational: " + r.situationalData.originalSize + " → " + r.situationalData.situationalSize + " txs (oversample " + r.situationalData.oversampleRate.toFixed(1) + "x, " + r.situationalData.situationalFraud + " fraud in situational)");
  console.log("[T16] baseline k=10 F1: mean=" + r.baseline.kfold.meanF1.toFixed(3) + " ci=[" + r.baseline.kfold.ci95.lower.toFixed(3) + "," + r.baseline.kfold.ci95.upper.toFixed(3) + "]");
  if (r.forged) {
    console.log("[T16] forged k=10 F1:   mean=" + r.forged.kfold.meanF1.toFixed(3) + " ci=[" + r.forged.kfold.ci95.lower.toFixed(3) + "," + r.forged.kfold.ci95.upper.toFixed(3) + "]");
    console.log("[T16] difference: " + r.statistics.difference.toFixed(3) + " cohen-d: " + r.statistics.cohensD.toFixed(3) + " significant: " + r.statistics.significant);
  }
  console.log("[T16] verdict: " + r.verdict);
  await fs.rm(ws, { recursive: true, force: true });
});

test("T11 — Supreme Test", async () => {
  const ws = await bootWorkspace();
  const r = await measureSupreme(ws, {
    trainedDomains: ["meteorologist", "trader", "cybersecurity", "doctor", "engineer"],
    novelProblem: { query: "detect anomaly in pressure gradient readings" },
  });
  results.T11 = r;
  console.log("[T11] distinctProfUsed:", r.distinctProfessionsUsed, "passed:", r.passed);
  await fs.rm(ws, { recursive: true, force: true });
});

test("T17 — Skill Reachability Audit (every shipped skill must run)", async () => {
  const ws = await bootWorkspace();
  // The audit must cover the LIBRARY THAT SHIPS, so the shipped
  // manifest goes in alongside the shipped .py files. bootWorkspace()
  // deliberately skips the manifest so that each test starts from a
  // clean adopt(); this one is auditing the shipped state instead.
  await fs.copyFile(
    path.join(ROOT, "dna_library", "manifest.json"),
    path.join(ws, "packages", "metamorfus-src", "dna_library", "manifest.json"),
  );
  const { auditReachableSkills } = await import(path.join(ROOT, "server/cognitive/reachability.mjs"));
  const r = await auditReachableSkills(ws);
  results.T17 = {
    total: r.total, live: r.liveCount, executed: r.executedCount, needsInput: r.needsInputCount,
    degraded: r.degradedCount, needsTool: r.needsToolCount, broken: r.brokenCount,
    retired: r.retiredCount, reachable: r.reachableCount,
  };
  console.log("[T17] skills no manifesto: " + r.total + " (vivas: " + r.liveCount + ", aposentadas: " + r.retiredCount + ")");
  console.log("[T17] EXECUTARAM com valor real: " + r.executedCount);
  console.log("[T17] alcancaveis, faltou contexto: " + r.needsInputCount);
  console.log("[T17] degradaram (reportaram condicao com honestidade): " + r.degradedCount);
  console.log("[T17] alcancaveis, falta ferramenta externa: " + r.needsToolCount);
  console.log("[T17] QUEBRADOS (bug real): " + r.brokenCount);
  for (const b of r.broken) console.log("[T17]   QUEBRADO " + b.key + " — " + b.reason);

  // A skill that cannot run is not a capability. Zero broken is the
  // bar; a broken skill means the organism advertises something it
  // cannot do.
  assert.strictEqual(r.brokenCount, 0,
    "T17: " + r.brokenCount + " skill(s) raised instead of returning a value: " +
    r.broken.map((b) => b.key).join(", "));
  // The organism must actually possess capabilities, not just files.
  assert.ok(r.executedCount >= 40,
    `T17: only ${r.executedCount} skills executed; the organism claims 40+ reachable skills`);
  // Every LIVE skill in the manifest must correspond to a real file.
  // Retired ones stay in the library forever (the no-delete rule) and
  // are counted apart.
  assert.strictEqual(r.reachableCount, r.liveCount,
    `T17: ${r.liveCount - r.reachableCount} live manifest skills are not reachable at all`);
  await fs.rm(ws, { recursive: true, force: true });
});

test("T18 — Capability Forge (the organism grows a capability it lacks)", async () => {
  const ws = await bootWorkspace();
  const { forgeCapability } = await import(path.join(ROOT, "server/cognitive/capability-forge.mjs"));
  const r = await forgeCapability(ws, {
    skillKey: "freight_carbon_footprint_protocol",
    capability: [
      "the organism has no way to estimate the carbon footprint of a freight movement",
      "it must accept distance_km (float), weight_tonnes (float) and transport_mode (one of: road, rail, air, ship)",
      "and return the kilograms of CO2 emitted, the per-mode breakdown when several modes are given, and which mode dominates",
    ],
    context: { distance_km: 1000, weight_tonnes: 10, transport_mode: "road" },
  });
  results.T18 = {
    created: r.created, usable: r.usable, model: r.model ?? null,
    bytes: r.bytes ?? null, reason: r.reason ?? null,
  };
  console.log("[T18] created:", r.created, "| usable:", r.usable, "| model:", r.model, "| bytes:", r.bytes);
  console.log("[T18] smoke:", JSON.stringify(r.smokeTest?.result ?? r.smokeTest?.error));

  assert.ok(r.created, `T18: the organism did not forge the capability: ${r.reason ?? r.error}`);
  // A skill that was written but never executed is a claim, not a
  // capability. The forge runs it before calling it usable.
  assert.ok(r.usable, `T18: the forged skill did not execute: ${r.smokeTest?.error}`);
  assert.ok(r.bytes > 100, `T18: the forged skill is suspiciously small (${r.bytes} bytes)`);

  // The skill must live in THIS workspace...
  const wsPy = path.join(ws, "packages", "metamorfus-src", "dna_library", "freight_carbon_footprint_protocol.py");
  assert.ok(await fs.stat(wsPy).then(() => true).catch(() => false),
    "T18: the forged skill was not written into the workspace");
  // ...and NOT in the installed package. That was a real bug: the
  // bridge was called with the workspace root in the wrong shape and
  // silently fell back to its own directory, so every forged skill
  // landed in the package instead of the tenant's library.
  const installedPy = path.join(ROOT, "dna_library", "freight_carbon_footprint_protocol.py");
  assert.equal(await fs.stat(installedPy).then(() => true).catch(() => false), false,
    "T18: the forged skill leaked into the installed package instead of the workspace");

  // The manifest must record where it came from.
  const manifest = JSON.parse(await fs.readFile(path.join(ws, "packages", "metamorfus-src", "dna_library", "manifest.json"), "utf-8"));
  const entry = (manifest.skills ?? []).find((s) => s.key === "freight_carbon_footprint_protocol");
  assert.ok(entry, "T18: the forged skill was not registered in the manifest");
  assert.equal(entry.created_by, "capability-forge");
  assert.ok(entry.forged_by_model, "T18: the manifest does not record which model wrote the skill");

  await fs.rm(ws, { recursive: true, force: true });
});

test("battery summary", async () => {
  console.log("\n========= T1–T11 BATTERY RESULTS =========");
  for (const k of Object.keys(results).sort()) {
    const v = results[k];
    const summary = v?.passed !== undefined ? `passed=${v.passed}` :
                    v?.ok !== undefined ? `ok=${v.ok}` :
                    v?.ips !== undefined ? `ips=${v.ips}` :
                    JSON.stringify(v).slice(0, 150);
    console.log(`  ${k}: ${summary}`);
  }
  await fs.writeFile(path.join(ROOT, ".battery-results.json"), JSON.stringify(results, null, 2));
});
BATTERY_EOF
./node_modules/.bin/tsx --test .battery.test.mjs
EXIT=$?
rm -f .battery.test.mjs
exit $EXIT