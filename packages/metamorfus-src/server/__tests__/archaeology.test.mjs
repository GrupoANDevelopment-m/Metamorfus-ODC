// Real tests for the archaeology layer — REUSE, SYNTHESIZE, RESTORE.
// The system never deletes. Discarded flows + skills stay on disk
// and can be recovered, recombined, or composed into new identities.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

const ROOT = "/workspace/metamorfus-opencode/packages/metamorfus-src";
process.env.NVIDIA_API_KEY = process.env.NVIDIA_API_KEY ?? "test-key";

const { startHeadlessServer } = await import(path.join(ROOT, "server/headless-server.mjs"));
const { executeBridgeTool } = await import(path.join(ROOT, "server/odc-opencode-bridge.js"));
const { adopt, loadManifest } = await import(path.join(ROOT, "server/metamorfus-core/metamorph.js"));
const { runSkill } = await import(path.join(ROOT, "server/skills/runner.mjs"));
const { compose, listFlows, getFlow, invokeFlow, decommissionFlow, listArchaeologyFlows, restoreFlow, synthesizeFlow } = await import(path.join(ROOT, "server/cognitive/flow.mjs"));
const { shouldSubstitute, applySubstitution, listArchaeologySkills, restoreSkill, synthesizeSkill, runSubstitutionSweep } = await import(path.join(ROOT, "server/cognitive/substitution.mjs"));
const { checkAction } = await import(path.join(ROOT, "server/constitution/enforcer.mjs"));

async function boot() {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "metamorfus-arch-"));
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

test("A1: decommissionFlow does NOT delete — file renamed to .archaeology", async () => {
  const ws = await boot();
  const flow = await compose(ws, { name: "test_flow", trigger: ["test"], steps: [{ skillKey: "analyze_pressure_gradient_protocol" }] });
  const ok = await decommissionFlow(ws, flow.id, "superseded");
  assert.equal(ok, true);
  // File must still exist on disk, with .archaeology suffix
  const flowDir = path.join(ws, "packages", "metamorfus-src", "dna_library", "flows");
  const files = await fs.readdir(flowDir);
  const archaeologyFile = files.find((f) => f === `${flow.id}.json.archaeology`);
  assert.ok(archaeologyFile, "archaeology file must exist on disk");
  // Active list must NOT include it
  const active = await listFlows(ws);
  assert.equal(active.length, 0, "archaeology flow must not appear in active list");
  // But archaeology list DOES include it
  const arch = await listArchaeologyFlows(ws);
  assert.equal(arch.length, 1);
  assert.ok(arch[0].archivedAt, "archivedAt timestamp must be present");
  await fs.rm(ws, { recursive: true, force: true });
});

test("A2: restoreFlow brings archaeology flow back to active", async () => {
  const ws = await boot();
  const flow = await compose(ws, { name: "test_flow", trigger: ["test"], steps: [{ skillKey: "analyze_pressure_gradient_protocol" }] });
  await decommissionFlow(ws, flow.id, "superseded");
  const restored = await restoreFlow(ws, flow.id, "needed again");
  assert.ok(restored);
  assert.equal(restored.status ?? "active", "active");
  assert.equal(restored.wasArchaeology, true);
  // Active list now has it
  const active = await listFlows(ws);
  assert.equal(active.length, 1);
  // Archaeology list is empty
  const arch = await listArchaeologyFlows(ws);
  assert.equal(arch.length, 0);
  await fs.rm(ws, { recursive: true, force: true });
});

test("A3: synthesizeFlow combines 2 archaeology flows into a new one", async () => {
  const ws = await boot();
  const c = ctx(ws);
  await adopt("meteorologist", c);
  // Build 2 flows
  const f1 = await compose(ws, { name: "pressure_pipe", trigger: ["pressure", "gradient"], steps: [{ skillKey: "analyze_pressure_gradient_protocol" }] });
  const f2 = await compose(ws, { name: "front_pipe", trigger: ["front", "weather"], steps: [{ skillKey: "front_detection_protocol" }] });
  // Decommission both
  await decommissionFlow(ws, f1.id, "v1 done");
  await decommissionFlow(ws, f2.id, "v1 done");
  // Synthesize
  const synth = await synthesizeFlow(ws, {
    baseFlowIds: [f1.id, f2.id],
    name: "weather_synth",
    reason: "combine the two",
  });
  assert.equal(synth.synthesized, true);
  assert.equal(synth.forkReason, "combine the two");
  assert.equal(synth.steps.length, 2, "synth must have 2 steps (one per base)");
  // The 2 source files must STILL be on disk as archaeology
  const arch = await listArchaeologyFlows(ws);
  assert.equal(arch.length, 2, "sources must remain in archaeology — not deleted");
  // The synthesized flow is now active
  const active = await listFlows(ws);
  assert.equal(active.length, 1);
  assert.equal(active[0].id, synth.id);
  await fs.rm(ws, { recursive: true, force: true });
});

test("A4: applySubstitution marks skill as archaeology but does not delete", async () => {
  const ws = await boot();
  const c = ctx(ws);
  await adopt("meteorologist", c);
  // Forge a candidate evolved skill manually
  const manifestPath = path.join(ws, "packages", "metamorfus-src", "dna_library", "manifest.json");
  const m = await loadManifest(c);
  const current = m.skills.find((s) => s.key === "analyze_pressure_gradient_protocol");
  // Add a candidate skill to the manifest
  m.skills.push({
    key: "evolved_analyze_pressure_gradient_protocol",
    profession: "meteorologist",
    version: 2,
    morph_focus: "THINK",
    status: "active",
    mastery: 0.9,
    usage_history: [
      { at: new Date().toISOString(), outcome: 1, duration_ms: 50 },
      { at: new Date().toISOString(), outcome: 1, duration_ms: 50 },
      { at: new Date().toISOString(), outcome: 1, duration_ms: 50 },
    ],
    transferable: false,
  });
  // Now make the current one look bad
  current.usage_history = [
    { at: new Date(Date.now() - 1000).toISOString(), outcome: -1, duration_ms: 200 },
    { at: new Date(Date.now() - 2000).toISOString(), outcome: -1, duration_ms: 200 },
    { at: new Date(Date.now() - 3000).toISOString(), outcome: -1, duration_ms: 200 },
  ];
  await fs.writeFile(manifestPath, JSON.stringify(m, null, 2));
  const r = await applySubstitution(ws, "analyze_pressure_gradient_protocol", "evolved_analyze_pressure_gradient_protocol", "better fitness");
  assert.equal(r.ok, true, "substitution must succeed");
  // Old is now archaeology but still in manifest.skills
  const m2 = await loadManifest(c);
  const arche = m2.skills.find((s) => s.key === "analyze_pressure_gradient_protocol");
  assert.equal(arche.status, "archaeology");
  assert.ok(arche.successor);
  // New is still active
  const fresh = m2.skills.find((s) => s.key === "evolved_analyze_pressure_gradient_protocol");
  assert.equal(fresh.status, "active");
  // Both still in manifest — none deleted
  const archList = await listArchaeologySkills(ws);
  assert.ok(archList.length >= 1, "must appear in archaeology list");
  await fs.rm(ws, { recursive: true, force: true });
});

test("A5: restoreSkill brings archaeology skill back to active", async () => {
  const ws = await boot();
  const c = ctx(ws);
  await adopt("meteorologist", c);
  const manifestPath = path.join(ws, "packages", "metamorfus-src", "dna_library", "manifest.json");
  const m = await loadManifest(c);
  const skill = m.skills.find((s) => s.key === "analyze_pressure_gradient_protocol");
  skill.status = "archaeology";
  skill.archived_at = new Date().toISOString();
  skill.archived_reason = "test archive";
  await fs.writeFile(manifestPath, JSON.stringify(m, null, 2));
  const r = await restoreSkill(ws, "analyze_pressure_gradient_protocol", "needed");
  assert.equal(r.ok, true);
  assert.equal(r.skill.status, "active");
  assert.equal(r.skill.wasArchaeology, true);
  await fs.rm(ws, { recursive: true, force: true });
});

test("A6: synthesizeSkill creates a new skill identity from archaeology skills", async () => {
  const ws = await boot();
  const c = ctx(ws);
  await adopt("meteorologist", c);
  const manifestPath = path.join(ws, "packages", "metamorfus-src", "dna_library", "manifest.json");
  const m = await loadManifest(c);
  // Mark 2 skills as archaeology
  const s1 = m.skills.find((s) => s.key === "analyze_pressure_gradient_protocol");
  const s2 = m.skills.find((s) => s.key === "front_detection_protocol");
  s1.status = "archaeology";
  s2.status = "archaeology";
  await fs.writeFile(manifestPath, JSON.stringify(m, null, 2));
  // Synthesize
  const r = await synthesizeSkill(ws, {
    baseSkillKeys: ["analyze_pressure_gradient_protocol", "front_detection_protocol"],
    name: "synth_weather_analysis",
    reactivationTriggers: ["synthesized", "weather", "combined"],
  });
  assert.equal(r.ok, true);
  assert.equal(r.skill.key, "synth_weather_analysis");
  assert.equal(r.skill.synthesized, true);
  assert.equal(r.skill.status, "active");
  assert.equal(r.skill.parents.length, 2);
  // Reuse: sources are still in archaeology
  const archList = await listArchaeologySkills(ws);
  assert.equal(archList.length, 2, "sources must remain in archaeology");
  await fs.rm(ws, { recursive: true, force: true });
});

test("A7: constitution rejects delete_flow and delete_skill_file (no deletion policy)", async () => {
  const ws = await boot();
  const c = ctx(ws);
  await adopt("meteorologist", c);
  const m = await loadManifest(c);
  const r1 = await checkAction({ type: "delete_flow", flowId: "x" }, m);
  const r2 = await checkAction({ type: "delete_skill_file", skillKey: "x" }, m);
  assert.equal(r1.ok, false, "delete_flow must be rejected");
  assert.equal(r2.ok, false, "delete_skill_file must be rejected");
  assert.ok(r1.violations.some((v) => v.ruleId === "no-delete"));
  assert.ok(r2.violations.some((v) => v.ruleId === "no-delete"));
  await fs.rm(ws, { recursive: true, force: true });
});

test("A8: HTTP routes expose archaeology REST API", async () => {
  const ws = await boot();
  const c = ctx(ws);
  await adopt("meteorologist", c);
  // Set up some archaeology state first
  const f1 = await compose(ws, { name: "f1", trigger: ["x"], steps: [{ skillKey: "analyze_pressure_gradient_protocol" }] });
  const f2 = await compose(ws, { name: "f2", trigger: ["y"], steps: [{ skillKey: "front_detection_protocol" }] });
  await decommissionFlow(ws, f1.id, "test");
  await decommissionFlow(ws, f2.id, "test");
  // Use the same workspace for the HTTP server
  const handle = await startHeadlessServer({ workspaceRoot: ws, port: 4002 });
  try {
    const auth = { Authorization: "Bearer dev-secret-local" };
    const r1 = await fetch("http://127.0.0.1:4002/api/archaeology/flows", { headers: auth });
    const r2 = await fetch("http://127.0.0.1:4002/api/archaeology/skills", { headers: auth });
    const r3 = await fetch("http://127.0.0.1:4002/api/archaeology/flows/synthesize", {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ baseFlowIds: [f1.id, f2.id] }),
    });
    const r4 = await fetch("http://127.0.0.1:4002/api/archaeology/flows/" + f1.id + "/restore", {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    // All must return 200
    assert.equal(r1.status, 200, `flows list: ${r1.status}`);
    assert.equal(r2.status, 200, `skills list: ${r2.status}`);
    assert.equal(r3.status, 200, `synthesize flow: ${r3.status}`);
    assert.equal(r4.status, 200, `restore flow: ${r4.status}`);
    // 401 without auth
    const r5 = await fetch("http://127.0.0.1:4002/api/archaeology/flows");
    assert.equal(r5.status, 401);
  } finally {
    await handle.close();
    await fs.rm(ws, { recursive: true, force: true });
  }
});

test("A9: end-to-end — fail flow, archive, synthesize new from it, both kept", async () => {
  const ws = await boot();
  const c = ctx(ws);
  await adopt("meteorologist", c);
  // Build a flow that we'll fail
  const bad = await compose(ws, { name: "bad_flow", trigger: ["bad"], steps: [{ skillKey: "analyze_pressure_gradient_protocol" }] });
  // Run it (succeeds, but we'll consider it failed for the test)
  await invokeFlow(ws, bad, { profession: "meteorologist", stations: [] });
  // Archive it
  await decommissionFlow(ws, bad.id, "experiment failed");
  // Archive another
  const alt = await compose(ws, { name: "alt_flow", trigger: ["alt"], steps: [{ skillKey: "front_detection_protocol" }] });
  await invokeFlow(ws, alt, { profession: "meteorologist", stations: [] });
  await decommissionFlow(ws, alt.id, "another failure");
  // Synthesize from both
  const synth = await synthesizeFlow(ws, {
    baseFlowIds: [bad.id, alt.id],
    name: "best_of_both",
    reason: "combine 2 failed flows",
  });
  assert.equal(synth.synthesized, true);
  // Verify all 3 exist: 1 active + 2 archaeology
  const active = await listFlows(ws);
  const arch = await listArchaeologyFlows(ws);
  assert.equal(active.length, 1);
  assert.equal(arch.length, 2);
  // The synthesized flow can be invoked
  const r = await invokeFlow(ws, synth, { profession: "meteorologist", stations: [] });
  assert.ok(r.ok);
  console.log("[A9] fitness after synth invocation:", r.fitness);
  await fs.rm(ws, { recursive: true, force: true });
});

test("A10: nothing is ever deleted — verify filesystem after multiple decommission cycles", async () => {
  const ws = await boot();
  const flowDir = path.join(ws, "packages", "metamorfus-src", "dna_library", "flows");
  // Create 5 flows and decommission all
  for (let i = 0; i < 5; i++) {
    const f = await compose(ws, { name: `flow_${i}`, trigger: [`t${i}`], steps: [{ skillKey: "analyze_pressure_gradient_protocol" }] });
    await decommissionFlow(ws, f.id, "cycle test");
  }
  // List every file in flows/
  const files = await fs.readdir(flowDir);
  const archaeologyFiles = files.filter((f) => f.endsWith(".archaeology"));
  const activeFiles = files.filter((f) => f.endsWith(".json") && !f.endsWith(".archaeology"));
  assert.equal(archaeologyFiles.length, 5, "all 5 must remain in archaeology");
  assert.equal(activeFiles.length, 0, "no active flows left");
  // Restore 2 of them
  for (let i = 0; i < 2; i++) {
    const id = archaeologyFiles[i].replace(".json.archaeology", "");
    const r = await restoreFlow(ws, id, "needed again");
    assert.ok(r);
  }
  // After restoration, 2 active + 3 archaeology
  const files2 = await fs.readdir(flowDir);
  const arch2 = files2.filter((f) => f.endsWith(".archaeology"));
  const active2 = files2.filter((f) => f.endsWith(".json") && !f.endsWith(".archaeology"));
  assert.equal(arch2.length, 3);
  assert.equal(active2.length, 2);
  console.log("[A10] after restore: active=", active2.length, "archaeology=", arch2.length, "— total files on disk =", files2.length, "(none deleted)");
  await fs.rm(ws, { recursive: true, force: true });
});