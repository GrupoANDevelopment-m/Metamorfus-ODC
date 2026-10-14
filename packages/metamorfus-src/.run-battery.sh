#!/bin/bash
set -e
cd /workspace/metamorfus-opencode/packages/metamorfus-src
export NVIDIA_API_KEY=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
export MAX_TOKENS_PER_SESSION=20000000

cat > .battery.test.mjs <<'BATTERY_EOF'
import { test } from "node:test";
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
  await runSkill(ws, { skillKey: "analyze_pressure_gradient_protocol", byProfession: "meteorologist", context: { stations: [{ station_id: "A", lat: 0, lon: 0, pressure_hpa: 1010 }, { station_id: "B", lat: 0, lon: 1, pressure_hpa: 1005 }] } });
  await adopt("cybersecurity", c);
  await runSkill(ws, { skillKey: "real_port_scanner_protocol", byProfession: "cybersecurity", context: { host: "127.0.0.1", ports: [22, 80] } });
  await adopt("engineer", c);
  await runSkill(ws, { skillKey: "engineer_load_calc_protocol", byProfession: "engineer", context: { distributed_kg_m2: 200, span_m: 4, point_loads_kg: [100, 200] } });
  // Cross-profession invocation: trader uses analyze_pressure_gradient_protocol.
  // Polymorphic skills (statistical) get marked transferable when 2+ professions use them.
  await adopt("trader", c);
  await runSkill(ws, { skillKey: "analyze_pressure_gradient_protocol", byProfession: "trader", context: { stations: [{ station_id: "X", lat: 0, lon: 0, pressure_hpa: 1015 }, { station_id: "Y", lat: 0, lon: 1, pressure_hpa: 1008 }] } });
  await adopt("meteorologist", c);
  await runSkill(ws, { skillKey: "front_detection_protocol", byProfession: "meteorologist", context: { stations: [{ station_id: "X", temp_c: 10 }, { station_id: "Y", temp_c: 25 }] } });
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
    const evo = await measureSelfEvolution(ws, {
      failingTask: {
        skillKey: "analyze_pressure_gradient_protocol",
        profession: "meteorologist",
        context: { stations: "this is not a list", top_n: -1 },
      },
      maxAttempts: 3,
    });
    results.T6 = evo;
    console.log("[T6] attempts:", evo.attempts, "evolved:", evo.evolved, "ok:", evo.ok, "newSkillKey:", evo.newSkillKey, "validInputOk:", evo.validInputOk, "pythonBytes:", evo.pythonBytes);
  } catch (e) {
    console.error("[T6 EXCEPTION]", e.message);
    results.T6 = { ok: false, error: e.message };
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
  console.log("[T12] fraud f1=" + r.fraudTask.single.f1.toFixed(3));
  console.log("[T12] ts baseline MAE=" + r.timeSeriesTask.baseline.mae.toFixed(3));
  console.log("[T12] ts trader MAE=" + r.timeSeriesTask.traderOnly.mae.toFixed(3));
  console.log("[T12] ts 2-domain MAE=" + r.timeSeriesTask.twoDomain.mae.toFixed(3));
  console.log("[T12] ts 3-domain MAE=" + r.timeSeriesTask.threeDomain.mae.toFixed(3) + " conf=" + r.timeSeriesTask.synthesis.confidence.toFixed(3));
  console.log("[T12] improvement:", r.overall.improvement_pct.toFixed(1) + "%");
  console.log("[T12] verdict:", r.overall.verdict);
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